import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { loadConfig } from "../../src/config/env.js";
import { BudgetManager } from "../../src/services/budget/budget-manager.js";

const databases: ReturnType<typeof openDatabase>[] = [];
function setup(env: NodeJS.ProcessEnv = {}) {
  const db = openDatabase(":memory:");
  databases.push(db);
  const config = loadConfig({
    ...env,
    MAX_CONCURRENT_GENERATIONS: env.MAX_CONCURRENT_GENERATIONS ?? "1",
    MAX_CREDITS_PER_REQUEST: env.MAX_CREDITS_PER_REQUEST ?? "20",
    MAX_MONTHLY_CREDITS: env.MAX_MONTHLY_CREDITS ?? "50",
  });
  return { db, config, budget: new BudgetManager(db, config) };
}
const request = (generationId: string, estimatedCredits: number | null = null) => ({
  generationId,
  category: "speech",
  endpoint: "/v1/text-to-speech/test",
  requestHash: generationId,
  estimatedCredits,
  authorization: { allowPaid: true, allowUnknownCost: true },
});

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("BudgetManager", () => {
  it("blocks every generation in dry-run without writing a reservation", () => {
    const { budget, db } = setup();
    expect(() => budget.reserve(request("dry"))).toThrowError(/Dry run is enabled/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM generations").get()).toMatchObject({ count: 0 });
  });

  it("requires explicit gates when costs are unknown", () => {
    const { budget } = setup({ DRY_RUN: "false", ALLOW_PAID_GENERATIONS: "true" });
    expect(() => budget.reserve({ ...request("unknown"), authorization: { allowPaid: true } })).toThrowError(
      /Official cost is unavailable/,
    );
  });

  it("enforces the concurrency limit and releases it on completion", () => {
    const { budget } = setup({ DRY_RUN: "false", ALLOW_PAID_GENERATIONS: "true" });
    const first = budget.reserve(request("first"));
    expect(() => budget.reserve(request("second"))).toThrowError(/concurrent generation limit/);
    budget.markSubmitted(first, "remote-1");
    budget.complete(first, null);
    expect(budget.reserve(request("second"))).toMatchObject({ policy: "paid_unknown", estimatedCredits: null });
  });

  it("rejects requests above the configured per-request ceiling", () => {
    const { budget } = setup({ DRY_RUN: "false", ALLOW_PAID_GENERATIONS: "true" });
    expect(() => budget.reserve({ ...request("large", 21), authorization: { allowPaid: true } })).toThrowError(
      /MAX_CREDITS_PER_REQUEST/,
    );
  });

  it("applies estimated monthly reservations and supports documented-free calls without a paid gate", () => {
    const { budget } = setup({
      DRY_RUN: "false",
      ALLOW_PAID_GENERATIONS: "true",
      MAX_CONCURRENT_GENERATIONS: "3",
      MAX_MONTHLY_CREDITS: "10",
    });
    const first = budget.reserve({ ...request("estimated-1", 7), authorization: { allowPaid: true } });
    expect(() => budget.reserve({ ...request("estimated-2", 4), authorization: { allowPaid: true } })).toThrowError(
      /MAX_MONTHLY_CREDITS/,
    );
    budget.fail(first, "failed", "simulated");
    const free = budget.reserve({ ...request("plan", 0), documentedFree: true });
    expect(free).toMatchObject({ policy: "documented_free", estimatedCredits: 0 });
  });

  it("reconciles a remote terminal state using the reservation ID rather than the local generation ID", () => {
    const { budget, db } = setup({ DRY_RUN: "false", ALLOW_PAID_GENERATIONS: "true" });
    const reservation = budget.reserve(request("local-generation"));
    budget.markSubmitted(reservation, "remote-asset");
    expect(reservation.id).not.toBe(reservation.generationId);
    expect(budget.reconcileRemote("remote-asset", "completed", "/tmp/result.mp3")).toBe(true);
    expect(db.prepare("SELECT state FROM credit_reservations").get()).toMatchObject({ state: "completed" });
    expect(budget.reconcileRemote("remote-asset", "completed")).toBe(false);
    expect(budget.reconcileRemote("remote-asset", "running")).toBe(false);
  });

  it("persists policy changes and reports unknown outcomes and usage", () => {
    const { budget, db, config } = setup({ DRY_RUN: "false", ALLOW_PAID_GENERATIONS: "true" });
    const reservation = budget.reserve(request("unknown-outcome"));
    budget.fail(reservation, "unknown", "timeout");
    budget.setLocalBudget({ MAX_CREDITS_PER_REQUEST: 12 });
    budget.setLocalBudget({ MAX_MONTHLY_CREDITS: 33, MAX_CONCURRENT_GENERATIONS: 2 });
    expect(config.MAX_CREDITS_PER_REQUEST).toBe(12);
    expect(budget.getStatus()).toMatchObject({
      max_monthly_credits: 33,
      unknown_outcomes_this_month: 1,
      active_reservations: 0,
    });
    expect(budget.getUsageReport()).toMatchObject({ local_generation_history: expect.any(Array) });
    expect(() => budget.setLocalBudget({ MAX_CONCURRENT_GENERATIONS: 0 })).toThrowError(/non-negative integers/);
    expect(() => budget.setLocalBudget({ INVALID_SETTING: 1 } as never)).toThrowError(/Unsupported local budget field/);
    const loadedConfig = loadConfig({});
    new BudgetManager(db, loadedConfig);
    expect(loadedConfig.MAX_CREDITS_PER_REQUEST).toBe(12);
  });
});
