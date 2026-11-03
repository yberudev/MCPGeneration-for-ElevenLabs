import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";
import { AppError } from "../../utils/errors.js";

const paid = { allow_paid: z.boolean().default(false), allow_unknown_cost: z.boolean().default(false) };

export function registerDubbingTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "create_dubbing_project",
    "Create a dubbing project from a local audio/video file. This operation may charge before an output is produced and requires both paid authorization gates.",
    z
      .object({
        input_path: z.string().min(1),
        source_language: z.string().max(30).optional(),
        target_language: z.string().max(30).optional(),
        model_id: z.enum(["dubbing_v1", "dubbing_v2"]).optional(),
        reference: z.string().max(500).optional(),
        allow_paid: paid.allow_paid,
        allow_unknown_cost: paid.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const { input_path, allow_paid, allow_unknown_cost, ...fields } = input;
      return ctx.generation.execute({
        operation: "create_dubbing_project",
        category: "dubbing",
        endpoint: "/v1/dubbing/project",
        request: fields,
        filePath: input_path,
        fileField: "file",
        outputFilename: "unused.json",
        response: "json",
        asyncRemote: true,
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );
  registerTool(
    server,
    ctx.logger,
    "add_dubbing_language",
    "Add one target-language job to a dubbing project. A language target may incur separate charges.",
    z
      .object({
        project_id: z.string().min(1).max(150),
        target_language: z.string().min(2).max(30),
        allow_paid: paid.allow_paid,
        allow_unknown_cost: paid.allow_unknown_cost,
      })
      .strict(),
    async ({ project_id, target_language, allow_paid, allow_unknown_cost }) =>
      ctx.generation.execute({
        operation: "add_dubbing_language",
        category: "dubbing",
        endpoint: `/v1/dubbing/project/${encodeURIComponent(project_id)}/language`,
        request: { target_language },
        outputFilename: "unused.json",
        response: "json",
        asyncRemote: true,
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      }),
  );
  registerTool(
    server,
    ctx.logger,
    "list_dubbing_projects",
    "List dubbing projects using the documented page-size, cursor and status filters.",
    z
      .object({
        page_size: z.number().int().min(1).max(100).optional(),
        cursor: z.string().max(300).optional(),
        status: z.string().max(50).optional(),
        sort_direction: z.enum(["asc", "desc"]).optional(),
      })
      .strict(),
    async (query) => ({
      success: true,
      call_remote: true,
      data: (await ctx.eleven.http.json("GET", "/v1/dubbing/project", { query })).data,
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_dubbing_status",
    "Read the current state and metadata of a dubbing project, reconciling a terminal job state with the local budget reservation.",
    z.object({ project_id: z.string().min(1).max(150) }).strict(),
    async ({ project_id }) => {
      const data = (await ctx.eleven.http.json("GET", `/v1/dubbing/project/${encodeURIComponent(project_id)}`)).data;
      ctx.budget.reconcileRemote(project_id, (data as Record<string, unknown> | null)?.status);
      return { success: true, call_remote: true, data };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "download_dubbed_media",
    "Download one completed dubbing language output to a local file. The output is saved only after the API responds successfully and its audio signature is checked.",
    z
      .object({
        project_id: z.string().min(1).max(150),
        language_id: z.string().min(1).max(100),
        filename: z.string().min(1).max(200),
      })
      .strict(),
    async ({ project_id, language_id, filename }) => {
      const result = await ctx.eleven.http.binary(
        "GET",
        `/v1/dubbing/${encodeURIComponent(project_id)}/audio/${encodeURIComponent(language_id)}`,
      );
      const saved = await ctx.media.save(result.data, filename, "dubbing", { project_id, language_id });
      ctx.budget.reconcileRemote(project_id, "completed", saved.path);
      return {
        success: true,
        operation: "download_dubbed_media",
        call_remote: true,
        file: { path: saved.path, mime_type: saved.mimeType, sha256: saved.sha256, bytes: saved.bytes },
        request_id: result.requestId,
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "delete_dubbing_project",
    "Permanently delete a dubbing project. Requires explicit confirm_delete=true.",
    z.object({ project_id: z.string().min(1).max(150), confirm_delete: z.boolean().default(false) }).strict(),
    async ({ project_id, confirm_delete }) => {
      if (!confirm_delete)
        throw new AppError("Deleting a remote dubbing project requires confirm_delete=true", "confirmation_required");
      return {
        success: true,
        operation: "delete_dubbing_project",
        call_remote: true,
        data: (await ctx.eleven.http.json("DELETE", `/v1/dubbing/project/${encodeURIComponent(project_id)}`)).data,
      };
    },
  );
}
