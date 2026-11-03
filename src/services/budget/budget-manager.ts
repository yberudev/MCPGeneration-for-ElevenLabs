import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";

export interface Authorization {
  allowPaid: boolean;
  allowUnknownCost?: boolean;
}

export interface Reservation {
  id: string;
  generationId: string;
  estimatedCredits: number | null;
  policy: "documented_free" | "paid_unknown" | "paid_estimated";
}

export class BudgetManager {
  constructor(
    private readonly db: Database.Database,
    private readonly config: AppConfig,
  ) {
    const rows = db.prepare("SELECT key,value_json FROM local_settings").all() as Array<{
      key: string;
      value_json: string;
    }>;
    for (const row of rows) {
      if (["MAX_CREDITS_PER_REQUEST", "MAX_MONTHLY_CREDITS", "MAX_CONCURRENT_GENERATIONS"].includes(row.key)) {
        (config as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value_json);
      }
    }
  }

  reserve(input: {
    generationId: string;
    category: string;
    endpoint: string;
    requestHash: string;
    modelId?: string;
    estimatedCredits: number | null;
    documentedFree?: boolean;
    authorization?: Authorization;
  }): Reservation {
    const { documentedFree = false, authorization = { allowPaid: false } } = input;
    if (!documentedFree) {
      if (this.config.DRY_RUN) throw new AppError("Dry run is enabled; no generation request was sent", "dry_run");
      if (!this.config.ALLOW_PAID_GENERATIONS || !authorization.allowPaid) {
        throw new AppError(
          "Paid generation requires ALLOW_PAID_GENERATIONS=true and allow_paid=true for this request",
          "paid_generation_not_authorized",
        );
      }
      if (input.estimatedCredits === null && !authorization.allowUnknownCost) {
        throw new AppError(
          "Official cost is unavailable; set allow_unknown_cost=true for this specific request to continue",
          "cost_unknown",
        );
      }
      if (input.estimatedCredits !== null && input.estimatedCredits > this.config.MAX_CREDITS_PER_REQUEST) {
        throw new AppError("The estimated cost exceeds MAX_CREDITS_PER_REQUEST", "request_budget_exceeded");
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const policy = documentedFree
      ? "documented_free"
      : input.estimatedCredits === null
        ? "paid_unknown"
        : "paid_estimated";
    const reserveTransaction = this.db.transaction(() => {
      const activeResult = this.db
        .prepare("SELECT COUNT(*) AS count FROM credit_reservations WHERE state IN ('reserved','submitted')")
        .get() as { count?: number } | undefined;
      const active = Number(activeResult?.count ?? 0);
      if (!documentedFree && active >= this.config.MAX_CONCURRENT_GENERATIONS)
        throw new AppError("The configured concurrent generation limit has been reached", "concurrency_limit");
      if (!documentedFree && input.estimatedCredits !== null) {
        const monthStart = new Date();
        monthStart.setUTCDate(1);
        monthStart.setUTCHours(0, 0, 0, 0);
        const usage = this.db
          .prepare("SELECT COALESCE(SUM(cost_observed), 0) AS used FROM generations WHERE created_at >= ?")
          .get(monthStart.toISOString()) as { used: number };
        const reserved = this.db
          .prepare(
            "SELECT COALESCE(SUM(amount), 0) AS amount FROM credit_reservations WHERE state IN ('reserved','submitted')",
          )
          .get() as { amount: number };
        if (usage.used + reserved.amount + input.estimatedCredits > this.config.MAX_MONTHLY_CREDITS) {
          throw new AppError("The request would exceed MAX_MONTHLY_CREDITS", "monthly_budget_exceeded");
        }
      }
      this.db
        .prepare(
          `INSERT INTO generations(id,category,endpoint,model_id,request_hash,status,cost_estimate,created_at,updated_at)
        VALUES (@generation_id,@category,@endpoint,@model_id,@request_hash,'reserved',@estimated_credits,@now,@now)`,
        )
        .run({
          generation_id: input.generationId,
          category: input.category,
          endpoint: input.endpoint,
          model_id: input.modelId ?? null,
          request_hash: input.requestHash,
          estimated_credits: input.estimatedCredits,
          now,
        });
      this.db
        .prepare("INSERT INTO generation_events(generation_id,state,details_json,created_at) VALUES (?,?,?,?)")
        .run(input.generationId, "reserved", JSON.stringify({ policy }), now);
      this.db
        .prepare(
          "INSERT INTO credit_reservations(id,generation_id,amount,state,created_at,updated_at) VALUES (?,?,?,'reserved',?,?)",
        )
        .run(id, input.generationId, input.estimatedCredits, now, now);
    });
    reserveTransaction.immediate();
    return { id, generationId: input.generationId, estimatedCredits: input.estimatedCredits, policy };
  }

  markSubmitted(reservation: Reservation, remoteId: string | null = null): void {
    this.transition(reservation, "submitted", { remoteId });
    this.db
      .prepare("UPDATE credit_reservations SET state='submitted',updated_at=? WHERE id=?")
      .run(new Date().toISOString(), reservation.id);
    this.db
      .prepare("UPDATE generations SET status='submitted',remote_id=?,updated_at=? WHERE id=?")
      .run(remoteId, new Date().toISOString(), reservation.generationId);
  }

  complete(reservation: Reservation, filePath: string | null, usage: string | null = null): void {
    this.transition(reservation, "completed", { filePath, usageHeader: usage });
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE generations SET status='completed',file_path=?,updated_at=? WHERE id=?")
      .run(filePath, now, reservation.generationId);
    this.db
      .prepare("UPDATE credit_reservations SET state='completed',updated_at=? WHERE id=?")
      .run(now, reservation.id);
  }

  fail(reservation: Reservation, status: "failed" | "unknown", code: string): void {
    this.transition(reservation, status, { errorCode: code });
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE generations SET status=?,error_code=?,updated_at=? WHERE id=?")
      .run(status, code, now, reservation.generationId);
    this.db.prepare("UPDATE credit_reservations SET state=?,updated_at=? WHERE id=?").run(status, now, reservation.id);
  }

  reconcileRemote(remoteId: string, remoteStatus: unknown, filePath: string | null = null): boolean {
    const status = typeof remoteStatus === "string" ? remoteStatus.toLowerCase() : "";
    const outcome = ["completed", "succeeded", "success", "done"].includes(status)
      ? "completed"
      : ["failed", "error", "cancelled", "canceled"].includes(status)
        ? "failed"
        : null;
    if (!outcome) return false;
    const row = this.db
      .prepare(
        `SELECT g.id AS generation_id,r.id AS reservation_id,r.amount,g.cost_estimate
      FROM generations g JOIN credit_reservations r ON r.generation_id=g.id
      WHERE g.remote_id=? AND r.state IN ('reserved','submitted') ORDER BY g.created_at DESC LIMIT 1`,
      )
      .get(remoteId) as
      | { generation_id: string; reservation_id: string; amount: number | null; cost_estimate: number | null }
      | undefined;
    if (!row) return false;
    const reservation: Reservation = {
      id: row.reservation_id,
      generationId: row.generation_id,
      estimatedCredits: row.amount ?? row.cost_estimate,
      policy: row.amount === 0 ? "documented_free" : row.amount === null ? "paid_unknown" : "paid_estimated",
    };
    if (outcome === "completed") this.complete(reservation, filePath);
    else this.fail(reservation, "failed", "remote_job_failed");
    this.db
      .prepare("UPDATE remote_jobs SET status=?,updated_at=? WHERE remote_id=? OR id=?")
      .run(outcome, new Date().toISOString(), remoteId, remoteId);
    return true;
  }

  getStatus(): Record<string, unknown> {
    const now = new Date();
    now.setUTCDate(1);
    now.setUTCHours(0, 0, 0, 0);
    const used = this.db
      .prepare("SELECT COALESCE(SUM(cost_observed),0) AS used FROM generations WHERE created_at >= ?")
      .get(now.toISOString()) as { used: number };
    const active = this.db
      .prepare("SELECT COUNT(*) AS count FROM credit_reservations WHERE state IN ('reserved','submitted')")
      .get() as { count: number };
    const unknown = this.db
      .prepare("SELECT COUNT(*) AS count FROM generations WHERE status='unknown' AND created_at >= ?")
      .get(now.toISOString()) as { count: number };
    return {
      dry_run: this.config.DRY_RUN,
      paid_generations_enabled: this.config.ALLOW_PAID_GENERATIONS,
      max_credits_per_request: this.config.MAX_CREDITS_PER_REQUEST,
      max_monthly_credits: this.config.MAX_MONTHLY_CREDITS,
      observed_monthly_credits: used.used,
      active_reservations: active.count,
      unknown_outcomes_this_month: unknown.count,
      note: "The API does not expose reliable preflight costs for every product; unknown costs are never treated as zero.",
    };
  }

  getUsageReport(): Record<string, unknown> {
    const rows = this.db
      .prepare(
        `SELECT category,COUNT(*) AS requests,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) AS unknown,
      SUM(cost_observed) AS observed_credits
      FROM generations GROUP BY category ORDER BY category`,
      )
      .all();
    return {
      local_generation_history: rows,
      billing_note:
        "Observed credits are only reported when the remote API provides an explicit credit value. Character-cost headers are not converted to credits.",
    };
  }

  setLocalBudget(
    values: Partial<Pick<AppConfig, "MAX_CREDITS_PER_REQUEST" | "MAX_MONTHLY_CREDITS" | "MAX_CONCURRENT_GENERATIONS">>,
  ): void {
    const allowed = ["MAX_CREDITS_PER_REQUEST", "MAX_MONTHLY_CREDITS", "MAX_CONCURRENT_GENERATIONS"] as const;
    const entries = Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined);
    for (const [key, value] of entries) {
      if (!allowed.includes(key as (typeof allowed)[number]))
        throw new AppError(`Unsupported local budget field: ${key}`, "invalid_budget_field");
      const minimum = key === "MAX_CONCURRENT_GENERATIONS" ? 1 : 0;
      if (value === undefined || !Number.isInteger(value) || value < minimum)
        throw new AppError("Local budget values must be non-negative integers", "invalid_budget_value");
    }
    const now = new Date().toISOString();
    for (const [key, value] of entries) {
      this.db
        .prepare(
          "INSERT INTO local_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        )
        .run(key, JSON.stringify(value), now);
      (this.config as unknown as Record<string, unknown>)[key] = value;
    }
  }

  private transition(reservation: Reservation, state: string, details: Record<string, unknown>): void {
    this.db
      .prepare("INSERT INTO generation_events(generation_id,state,details_json,created_at) VALUES (?,?,?,?)")
      .run(reservation.generationId, state, JSON.stringify(details), new Date().toISOString());
  }
}
