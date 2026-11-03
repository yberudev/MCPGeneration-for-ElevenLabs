import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";
import { AppError } from "../../utils/errors.js";

export function registerHistoryTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "list_generation_history",
    "List ElevenLabs speech generation history with documented filters.",
    z
      .object({
        page_size: z.number().int().min(1).max(100).optional(),
        start_after_history_item_id: z.string().optional(),
        voice_id: z.string().optional(),
        model_id: z.string().optional(),
        date_before_unix: z.number().int().optional(),
        date_after_unix: z.number().int().optional(),
        sort_direction: z.enum(["asc", "desc"]).optional(),
        search: z.string().max(200).optional(),
        source: z.string().optional(),
      })
      .strict(),
    async (query) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("GET", "/v1/history", { query })).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_generation_history_item",
    "Read metadata for one ElevenLabs history item.",
    z.object({ history_item_id: z.string().min(1).max(150) }).strict(),
    async ({ history_item_id }) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("GET", `/v1/history/${encodeURIComponent(history_item_id)}`)).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "download_history_audio",
    "Download the audio for one history item to local storage.",
    z.object({ history_item_id: z.string().min(1).max(150), filename: z.string().min(1).max(200) }).strict(),
    async ({ history_item_id, filename }) => {
      const result = await ctx.eleven.http.binary("GET", `/v1/history/${encodeURIComponent(history_item_id)}/audio`);
      const saved = await ctx.media.save(result.data, filename, "history_audio", { history_item_id });
      return {
        success: true,
        operation: "download_history_audio",
        call_remote: true,
        file: { path: saved.path, mime_type: saved.mimeType, sha256: saved.sha256, bytes: saved.bytes },
        request_id: result.requestId,
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "get_api_request_history",
    "Query the workspace API request log. This is a read-only analytics query despite using POST.",
    z
      .object({
        start_time: z.number().int().min(1577836800000).optional(),
        end_time: z.number().int().min(1577836800000).optional(),
        limit: z.number().int().min(1).max(1000).default(100),
        sort: z.enum(["asc", "desc"]).optional(),
        search: z.string().max(500).optional(),
      })
      .strict(),
    async (body) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("POST", "/v1/workspace/analytics/requests", { body })).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_remote_usage_report",
    "Query official workspace product usage between Unix millisecond timestamps. The endpoint may require workspace permissions.",
    z
      .object({
        start_time: z.number().int().min(1577836800000),
        end_time: z.number().int().min(1577836800000),
        interval_seconds: z.number().int().positive().default(86400),
        group_by: z
          .array(z.enum(["product_type", "model", "voice_id", "user_id", "fiat_currency", "request_id"]))
          .optional(),
      })
      .strict(),
    async (body) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("POST", "/v1/workspace/analytics/query/usage-by-product-over-time", { body }))
        .data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "delete_history_item",
    "Permanently delete one ElevenLabs history item. Requires explicit confirm_delete=true.",
    z.object({ history_item_id: z.string().min(1).max(150), confirm_delete: z.boolean().default(false) }).strict(),
    async ({ history_item_id, confirm_delete }) => {
      if (!confirm_delete)
        throw new AppError("Deleting remote generation history requires confirm_delete=true", "confirmation_required");
      return {
        success: true,
        operation: "delete_history_item",
        call_remote: true,
        data: (await ctx.eleven.http.json("DELETE", `/v1/history/${encodeURIComponent(history_item_id)}`)).data,
      };
    },
  );
}
