import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";
import { AppError } from "../../utils/errors.js";

const paid = { allow_paid: z.boolean().default(false), allow_unknown_cost: z.boolean().default(false) };
const keyValues = z.record(z.string(), z.unknown());

export function registerFlowTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "create_async_speech",
    "Create speech through the separate ElevenCreative async flow API. The request is validated against the checked-in current OpenAPI contract.",
    z
      .object({ parameters: keyValues, allow_paid: paid.allow_paid, allow_unknown_cost: paid.allow_unknown_cost })
      .strict(),
    async ({ parameters, allow_paid, allow_unknown_cost }) =>
      ctx.generation.execute({
        operation: "create_async_speech",
        category: "flow_speech",
        endpoint: "/v1/flows/text-to-speech",
        request: parameters,
        outputFilename: "unused.json",
        response: "json",
        asyncRemote: true,
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_async_speech",
    "Read the status and result of one ElevenCreative async speech generation and reconcile terminal state locally.",
    z.object({ generation_id: z.string().min(1).max(150) }).strict(),
    async ({ generation_id }) => {
      const data = (await ctx.eleven.http.json("GET", `/v1/flows/text-to-speech/${encodeURIComponent(generation_id)}`))
        .data;
      ctx.budget.reconcileRemote(generation_id, (data as Record<string, unknown> | null)?.status);
      return { success: true, call_remote: true, data };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "list_flow_templates",
    "List published ElevenCreative templates.",
    z.object({ cursor: z.string().optional(), page_size: z.number().int().min(1).max(100).optional() }).strict(),
    async (query) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("GET", "/v1/flows/templates", { query })).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_flow_template",
    "Read a template definition and its input schema.",
    z.object({ template_id: z.string().min(1).max(150) }).strict(),
    async ({ template_id }) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("GET", `/v1/flows/templates/${encodeURIComponent(template_id)}`)).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "run_flow_template",
    "Run a published template. Because its internal steps can generate media, cost is treated as unknown and both paid-operation gates are required.",
    z
      .object({
        template_id: z.string().min(1).max(150),
        inputs: z.record(z.string(), z.unknown()),
        version_id: z.string().min(1).max(150).optional(),
        allow_paid: paid.allow_paid,
        allow_unknown_cost: paid.allow_unknown_cost,
      })
      .strict(),
    async ({ template_id, inputs, version_id, allow_paid, allow_unknown_cost }) =>
      ctx.generation.execute({
        operation: "run_flow_template",
        category: "flow_template",
        endpoint: `/v1/flows/templates/${encodeURIComponent(template_id)}/runs`,
        request: { inputs, version_id },
        outputFilename: "unused.json",
        response: "json",
        asyncRemote: true,
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_flow_run",
    "Read a template run's status and reconcile its terminal state locally.",
    z.object({ template_id: z.string().min(1).max(150), run_id: z.string().min(1).max(150) }).strict(),
    async ({ template_id, run_id }) => {
      const data = (
        await ctx.eleven.http.json(
          "GET",
          `/v1/flows/templates/${encodeURIComponent(template_id)}/runs/${encodeURIComponent(run_id)}`,
        )
      ).data;
      ctx.budget.reconcileRemote(run_id, (data as Record<string, unknown> | null)?.status);
      return { success: true, call_remote: true, data };
    },
  );

  registerTool(
    server,
    ctx.logger,
    "upload_asset",
    "Upload a local media file to the ElevenLabs Assets API. Requires rights confirmation and unknown-cost authorization because asset pricing is not estimated here.",
    z
      .object({
        input_path: z.string().min(1),
        name: z.string().min(1).max(200),
        rights_confirmed: z.boolean().default(false),
        allow_paid: paid.allow_paid,
        allow_unknown_cost: paid.allow_unknown_cost,
      })
      .strict(),
    async ({ input_path, name, rights_confirmed, allow_paid, allow_unknown_cost }) => {
      if (!rights_confirmed)
        throw new AppError(
          "Uploading an asset requires confirmation that you have rights to the content",
          "rights_confirmation_required",
        );
      return ctx.generation.execute({
        operation: "upload_asset",
        category: "remote_asset",
        endpoint: "/v1/assets",
        request: { name },
        filePath: input_path,
        fileField: "asset",
        outputFilename: "unused.json",
        response: "json",
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );
  registerTool(
    server,
    ctx.logger,
    "list_assets",
    "List uploaded assets in the authenticated ElevenLabs workspace.",
    z.object({ page_size: z.number().int().min(1).max(100).optional(), cursor: z.string().optional() }).strict(),
    async (query) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("GET", "/v1/assets", { query })).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_asset",
    "Read metadata for one remote asset.",
    z.object({ asset_id: z.string().min(1).max(150) }).strict(),
    async ({ asset_id }) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("GET", `/v1/assets/${encodeURIComponent(asset_id)}`)).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "delete_asset",
    "Permanently delete an asset from the ElevenLabs workspace. Requires explicit confirm_delete=true.",
    z.object({ asset_id: z.string().min(1).max(150), confirm_delete: z.boolean().default(false) }).strict(),
    async ({ asset_id, confirm_delete }) => {
      if (!confirm_delete)
        throw new AppError("Deleting a remote asset requires confirm_delete=true", "confirmation_required");
      return {
        success: true,
        call_remote: true,
        data: (await ctx.eleven.http.json("DELETE", `/v1/assets/${encodeURIComponent(asset_id)}`)).data,
      };
    },
  );
}
