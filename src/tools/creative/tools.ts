import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { extname } from "node:path";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";
import { AppError } from "../../utils/errors.js";

const paid = { allow_paid: z.boolean().default(false), allow_unknown_cost: z.boolean().default(false) };
const modelParameters = z.record(z.string(), z.unknown());

export function registerCreativeTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "generate_image",
    "Queue an ElevenCreative image generation. Pass model-specific parameters; the checked-in OpenAPI discriminator schema validates the model and its fields before any remote call. Disabled by default.",
    z
      .object({
        model_id: z.string().min(1).max(100),
        prompt: z.string().min(1).max(20_000),
        parameters: modelParameters.default({}),
        allow_paid: paid.allow_paid,
        allow_unknown_cost: paid.allow_unknown_cost,
      })
      .strict(),
    async ({ model_id, prompt, parameters, allow_paid, allow_unknown_cost }) => {
      if (!ctx.config.ENABLE_IMAGE_API)
        throw new AppError(
          "Image API is disabled by local policy. Set ENABLE_IMAGE_API=true to enable it.",
          "feature_disabled",
        );
      return ctx.generation.execute({
        operation: "generate_image",
        category: "image",
        endpoint: "/v1/flows/image",
        modelId: model_id,
        request: { ...parameters, model_id, prompt },
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
    "generate_video",
    "Queue an ElevenCreative video generation. Pass model-specific text, image, video or audio references; the official OpenAPI discriminator validates fields. Disabled by default.",
    z
      .object({
        model_id: z.string().min(1).max(100),
        prompt: z.string().min(1).max(20_000),
        parameters: modelParameters.default({}),
        allow_paid: paid.allow_paid,
        allow_unknown_cost: paid.allow_unknown_cost,
      })
      .strict(),
    async ({ model_id, prompt, parameters, allow_paid, allow_unknown_cost }) => {
      if (!ctx.config.ENABLE_VIDEO_API)
        throw new AppError(
          "Video API is disabled by local policy. Set ENABLE_VIDEO_API=true to enable it.",
          "feature_disabled",
        );
      return ctx.generation.execute({
        operation: "generate_video",
        category: "video",
        endpoint: "/v1/flows/video",
        modelId: model_id,
        request: { ...parameters, model_id, prompt },
        outputFilename: "unused.json",
        response: "json",
        asyncRemote: true,
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  for (const kind of ["image", "video"] as const) {
    const endpoint = `/v1/flows/${kind}`;
    const flagEnabled = kind === "image" ? ctx.config.ENABLE_IMAGE_API : ctx.config.ENABLE_VIDEO_API;
    registerTool(
      server,
      ctx.logger,
      `list_${kind}_generations`,
      `List ${kind} generations from the ElevenCreative API.`,
      z.object({ cursor: z.string().optional(), page_size: z.number().int().min(1).max(100).optional() }).strict(),
      async (query) => ({
        success: true,
        call_remote: true,
        data: (await ctx.eleven.http.json("GET", endpoint, { query })).data,
      }),
    );
    registerTool(
      server,
      ctx.logger,
      `get_${kind}_generation`,
      `Read the status of one ${kind} generation.`,
      z.object({ generation_id: z.string().min(1).max(150) }).strict(),
      async ({ generation_id }) => ({
        success: true,
        call_remote: true,
        data: (await ctx.eleven.http.json("GET", `${endpoint}/${encodeURIComponent(generation_id)}`)).data,
      }),
    );
    registerTool(
      server,
      ctx.logger,
      `download_${kind}`,
      `Download completed ${kind} output from the official signed generation URL, validate the URL host and file signature, then save it locally.`,
      z.object({ generation_id: z.string().min(1).max(150), filename: z.string().min(1).max(200) }).strict(),
      async ({ generation_id, filename }) => {
        if (!flagEnabled) throw new AppError(`${kind} API is disabled by local policy`, "feature_disabled");
        const statusResponse = await ctx.eleven.http.json("GET", `${endpoint}/${encodeURIComponent(generation_id)}`);
        const data = statusResponse.data as Record<string, unknown>;
        if (data.status !== "completed") {
          ctx.budget.reconcileRemote(generation_id, data.status);
          return {
            success: true,
            operation: `download_${kind}`,
            call_remote: true,
            status: data.status ?? "unknown",
            downloaded: false,
            result: data,
          };
        }
        if (typeof data.content_url !== "string" || typeof data.content_mime_type !== "string")
          throw new AppError("Completed generation has no documented media URL or MIME type", "missing_media_url");
        const extension = extensionForMime(data.content_mime_type);
        const finalName = extname(filename) ? filename : `${filename}${extension}`;
        if (extname(finalName).toLowerCase() !== extension)
          throw new AppError("Filename extension must match the remote MIME type", "format_extension_mismatch");
        const binary = await ctx.eleven.http.downloadGeneratedMedia(data.content_url);
        const saved = await ctx.media.save(binary.data, finalName, kind, {
          generation_id,
          content_mime_type: data.content_mime_type,
        });
        ctx.budget.reconcileRemote(generation_id, "completed", saved.path);
        return {
          success: true,
          operation: `download_${kind}`,
          call_remote: true,
          status: "completed",
          downloaded: true,
          file: { path: saved.path, mime_type: saved.mimeType, sha256: saved.sha256, bytes: saved.bytes },
          request_id: binary.requestId,
        };
      },
    );
  }
}

function extensionForMime(mime: string): string {
  const value = mime.split(";")[0]?.trim().toLowerCase();
  if (value === "image/png") return ".png";
  if (value === "image/jpeg") return ".jpg";
  if (value === "image/webp") return ".webp";
  if (value === "video/mp4") return ".mp4";
  if (value === "video/webm") return ".webm";
  throw new AppError(`Unsupported generated media MIME type: ${mime}`, "unsupported_media_type");
}
