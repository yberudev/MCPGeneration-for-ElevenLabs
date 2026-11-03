import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";
import { AppError } from "../../utils/errors.js";

const authorization = { allow_paid: z.boolean().default(false), allow_unknown_cost: z.boolean().default(false) };
const compositionPlan = z
  .object({
    chunks: z
      .array(
        z
          .object({
            text: z.string().min(1).max(4000),
            duration_ms: z.number().int().min(3000).max(120000),
            positive_styles: z.array(z.string().max(200)).max(50).optional(),
            negative_styles: z.array(z.string().max(200)).max(50).optional(),
            context_adherence: z.enum(["low", "medium", "high"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export function registerMusicTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "create_composition_plan",
    "Ask the documented music planning endpoint to produce a structured plan. Official docs state this endpoint consumes no credits, but rate limits apply.",
    z
      .object({
        prompt: z.string().min(1).max(4100),
        music_length_ms: z.number().int().min(3000).max(600000).optional(),
        model_id: z.enum(["music_v1", "music_v2", "music_v2_5"]).default("music_v2_5"),
      })
      .strict(),
    async (input) =>
      ctx.generation.execute({
        operation: "create_composition_plan",
        category: "music_plan",
        endpoint: "/v1/music/plan",
        request: { prompt: input.prompt, music_length_ms: input.music_length_ms, model_id: input.model_id },
        outputFilename: "unused.json",
        response: "json",
        documentedFree: true,
      }),
  );

  const generateSchema = z
    .object({
      prompt: z.string().min(1).max(4100).optional(),
      composition_plan: compositionPlan.optional(),
      music_length_ms: z.number().int().min(3000).max(600000).optional(),
      model_id: z.enum(["music_v1", "music_v2", "music_v2_5"]).default("music_v2_5"),
      seed: z.number().int().min(0).max(2147483647).optional(),
      force_instrumental: z.boolean().optional(),
      filename: z.string().min(1).max(200),
      allow_paid: authorization.allow_paid,
      allow_unknown_cost: authorization.allow_unknown_cost,
    })
    .strict()
    .superRefine((value, issue) => {
      if ((value.prompt === undefined) === (value.composition_plan === undefined))
        issue.addIssue({
          code: "custom",
          message: "Provide exactly one of prompt or composition_plan",
          path: ["prompt"],
        });
      if (value.composition_plan && !["music_v2", "music_v2_5"].includes(value.model_id))
        issue.addIssue({
          code: "custom",
          message: "Chunk composition plans require music_v2 or music_v2_5 per current documentation",
          path: ["model_id"],
        });
      if (value.prompt && value.seed !== undefined)
        issue.addIssue({ code: "custom", message: "seed cannot be sent with prompt mode", path: ["seed"] });
      if (value.composition_plan && value.force_instrumental)
        issue.addIssue({
          code: "custom",
          message: "force_instrumental is only supported with prompt mode",
          path: ["force_instrumental"],
        });
      if (value.composition_plan && value.music_length_ms !== undefined)
        issue.addIssue({
          code: "custom",
          message: "music_length_ms is only supported with prompt mode",
          path: ["music_length_ms"],
        });
    });
  const generateMusic = (stream: boolean) => async (input: z.infer<typeof generateSchema>) => {
    const { filename, allow_paid, allow_unknown_cost, ...body } = input;
    return ctx.generation.execute({
      operation: stream ? "generate_music_stream" : "generate_music",
      category: "music",
      endpoint: stream ? "/v1/music/stream" : "/v1/music",
      modelId: input.model_id,
      request: body,
      outputFilename: filename,
      query: { output_format: "mp3_44100_128" },
      authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
    });
  };
  registerTool(
    server,
    ctx.logger,
    "generate_music",
    "Compose music from either a prompt or a chunk-based plan. The request is checked against current documented constraints and remains behind both paid-operation gates.",
    generateSchema,
    generateMusic(false),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_music_stream",
    "Call the documented streaming music endpoint, then save the completed result locally behind both paid-operation gates.",
    generateSchema,
    generateMusic(true),
  );

  const detailedMusic = z
    .object({
      prompt: z.string().max(4100).optional(),
      generation_mode: z.enum(["track", "loop", "ambience", "video_to_music"]).optional(),
      lyrics_text: z.string().max(4000).optional(),
      composition_plan: z.record(z.string(), z.unknown()).optional(),
      music_length_ms: z.number().int().min(3000).max(600000).optional(),
      model_id: z.enum(["music_v1", "music_v2", "music_v2_5"]).default("music_v1"),
      seed: z.number().int().min(0).max(2147483647).optional(),
      force_instrumental: z.boolean().default(false),
      finetune_id: z.string().max(100).optional(),
      finetune_strength: z.number().gt(0).max(2).default(1),
      use_phonetic_names: z.boolean().default(false),
      respect_sections_durations: z.boolean().default(true),
      store_for_inpainting: z.boolean().default(false),
      with_timestamps: z.boolean().default(false),
      with_waveform_visual: z.boolean().default(false),
      sign_with_c2pa: z.boolean().default(false),
      model_style_prefix: z.enum(["music", "sfx"]).default("music"),
      output_format: z.string().max(50).default("mp3_44100_128"),
      filename: z.string().min(1).max(200),
      allow_paid: authorization.allow_paid,
      allow_unknown_cost: authorization.allow_unknown_cost,
    })
    .strict()
    .superRefine((value, issue) => {
      if ((value.prompt === undefined) === (value.composition_plan === undefined))
        issue.addIssue({
          code: "custom",
          message: "Provide exactly one of prompt or composition_plan",
          path: ["prompt"],
        });
      if (value.prompt && value.seed !== undefined)
        issue.addIssue({ code: "custom", message: "seed cannot be sent with prompt mode", path: ["seed"] });
      if (value.generation_mode && !value.prompt)
        issue.addIssue({
          code: "custom",
          message: "generation_mode is only supported with prompt mode",
          path: ["generation_mode"],
        });
      if (value.composition_plan && value.music_length_ms !== undefined)
        issue.addIssue({
          code: "custom",
          message: "music_length_ms is only supported with prompt mode",
          path: ["music_length_ms"],
        });
      if (value.composition_plan && value.force_instrumental)
        issue.addIssue({
          code: "custom",
          message: "force_instrumental is only supported with prompt mode",
          path: ["force_instrumental"],
        });
    });
  const generateDetailed = (stream: boolean) => async (input: z.infer<typeof detailedMusic>) => {
    const { filename, output_format, allow_paid, allow_unknown_cost, ...body } = input;
    return ctx.generation.execute({
      operation: stream ? "generate_music_detailed_stream" : "generate_music_detailed",
      category: "music",
      endpoint: stream ? "/v1/music/detailed/stream" : "/v1/music/detailed",
      modelId: input.model_id,
      request: body,
      outputFilename: filename,
      response: "multipart_mixed",
      query: { output_format },
      authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
    });
  };
  registerTool(
    server,
    ctx.logger,
    "generate_music_detailed",
    "Generate music using the detailed endpoint, which returns audio and structured JSON metadata in a multipart response.",
    detailedMusic,
    generateDetailed(false),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_music_detailed_stream",
    "Call the detailed streaming music endpoint and save its multipart audio and metadata result locally.",
    detailedMusic,
    generateDetailed(true),
  );

  registerTool(
    server,
    ctx.logger,
    "generate_music_from_video",
    "Generate music from one or more local videos using the documented video-to-music endpoint. Paid authorization is required.",
    z
      .object({
        video_paths: z.array(z.string().min(1)).min(1).max(10),
        description: z.string().min(1).max(4100).optional(),
        tags: z.array(z.string()).max(10).default([]),
        model_id: z.enum(["music_v1", "music_v2", "music_v2_5"]).default("music_v1"),
        add_sfx: z.boolean().default(false),
        separate_tracks: z.boolean().default(false),
        use_audio_as_reference: z.boolean().default(false),
        sign_with_c2pa: z.boolean().default(false),
        filename: z.string().min(1).max(200),
        allow_paid: authorization.allow_paid,
        allow_unknown_cost: authorization.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const { video_paths, filename, allow_paid, allow_unknown_cost, ...fields } = input;
      const suffix = input.separate_tracks ? ".zip" : ".mp3";
      return ctx.generation.execute({
        operation: "generate_music_from_video",
        category: "music",
        endpoint: "/v1/music/video-to-music",
        modelId: input.model_id,
        request: fields,
        filePaths: video_paths,
        fileField: "videos",
        outputFilename: filename,
        responseFilename: withSuffix(filename, suffix),
        response: "binary",
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  registerTool(
    server,
    ctx.logger,
    "separate_music_stems",
    "Separate an uploaded music file, retain the returned ZIP, and extract each verified audio stem into GENERATED_DIR.",
    z
      .object({
        input_path: z.string().min(1),
        filename: z.string().min(1).max(200),
        stem_variation_id: z.enum(["two_stems_v1", "six_stems_v1"]).default("six_stems_v1"),
        allow_paid: authorization.allow_paid,
        allow_unknown_cost: authorization.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const result = await ctx.generation.execute({
        operation: "separate_music_stems",
        category: "music_stems",
        endpoint: "/v1/music/stem-separation",
        request: { stem_variation_id: input.stem_variation_id },
        filePath: input.input_path,
        fileField: "file",
        outputFilename: withSuffix(input.filename, ".zip"),
        response: "binary",
        authorization: { allowPaid: input.allow_paid, allowUnknownCost: input.allow_unknown_cost },
      });
      const zipPath = (result.files as Array<{ path: string }> | undefined)?.[0]?.path;
      if (!zipPath) return result;
      try {
        const extracted = await ctx.mediaService.extractStems(zipPath, input.filename.replace(/\.[^.]+$/, ""));
        return { ...result, extracted_stems: extracted };
      } catch (error) {
        return { ...result, stem_extraction_error: error instanceof Error ? error.message : "Stem extraction failed" };
      }
    },
  );

  const finetunesEnabled = () => {
    if (!ctx.config.ENABLE_MUSIC_FINETUNES)
      throw new AppError(
        "Music finetunes are disabled by local policy. Set ENABLE_MUSIC_FINETUNES=true to enable this optional module.",
        "feature_disabled",
      );
  };
  registerTool(
    server,
    ctx.logger,
    "list_music_finetunes",
    "List music finetunes in the workspace. This optional module is disabled by default.",
    z
      .object({
        cursor: z.string().optional(),
        page_size: z.number().int().min(1).max(100).optional(),
        visibility: z.string().optional(),
        created_by: z.string().optional(),
        sort: z.enum(["created_at", "name"]).optional(),
        sort_direction: z.enum(["asc", "desc"]).optional(),
      })
      .strict(),
    async (query) => {
      finetunesEnabled();
      return {
        success: true,
        call_remote: true,
        data: (await ctx.eleven.http.json("GET", "/v1/music/finetunes", { query })).data,
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "create_music_finetune",
    "Create an optional music finetune from audio samples. Requires local enablement, rights confirmation, and both paid-operation gates.",
    z
      .object({
        name: z.string().min(1).max(100),
        primary_genre: z.string().min(1).max(100),
        sample_paths: z.array(z.string().min(1)).min(1).max(100),
        tags: z.array(z.string()).max(50).default([]),
        visibility: z.string().optional(),
        model_id: z.enum(["music_v1", "music_v2", "music_v2_5"]).default("music_v1"),
        rights_confirmed: z.boolean().default(false),
        allow_paid: authorization.allow_paid,
        allow_unknown_cost: authorization.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      finetunesEnabled();
      if (!input.rights_confirmed)
        throw new AppError(
          "Creating a finetune requires confirmation that you have rights to the submitted music",
          "rights_confirmation_required",
        );
      const { sample_paths, rights_confirmed, allow_paid, allow_unknown_cost, ...body } = input;
      void rights_confirmed;
      return ctx.generation.execute({
        operation: "create_music_finetune",
        category: "music_finetune",
        endpoint: "/v1/music/finetunes",
        request: body,
        filePaths: sample_paths,
        fileField: "files",
        outputFilename: "unused.json",
        response: "json",
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );
  registerTool(
    server,
    ctx.logger,
    "get_music_finetune",
    "Get metadata for one music finetune. The optional finetune module is disabled by default.",
    z.object({ finetune_id: z.string().min(1).max(150) }).strict(),
    async ({ finetune_id }) => {
      finetunesEnabled();
      return {
        success: true,
        call_remote: true,
        data: (await ctx.eleven.http.json("GET", `/v1/music/finetunes/${encodeURIComponent(finetune_id)}`)).data,
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "update_music_finetune",
    "Update documented metadata fields for a music finetune. The optional module is disabled by default.",
    z
      .object({
        finetune_id: z.string().min(1).max(150),
        name: z.string().max(100).optional(),
        tags: z.array(z.string()).max(50).optional(),
        primary_genre: z.string().max(100).optional(),
        visibility: z.string().optional(),
      })
      .strict(),
    async ({ finetune_id, ...body }) => {
      finetunesEnabled();
      return {
        success: true,
        call_remote: true,
        data: (await ctx.eleven.http.json("PATCH", `/v1/music/finetunes/${encodeURIComponent(finetune_id)}`, { body }))
          .data,
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "delete_music_finetune",
    "Permanently delete one music finetune. Requires explicit confirmation and local module enablement.",
    z.object({ finetune_id: z.string().min(1).max(150), confirm_delete: z.boolean().default(false) }).strict(),
    async ({ finetune_id, confirm_delete }) => {
      finetunesEnabled();
      if (!confirm_delete)
        throw new AppError("Deleting a finetune requires confirm_delete=true", "confirmation_required");
      return {
        success: true,
        call_remote: true,
        data: (await ctx.eleven.http.json("DELETE", `/v1/music/finetunes/${encodeURIComponent(finetune_id)}`)).data,
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "upload_music",
    "Upload music for the documented later inpainting workflow. The official endpoint charges the same as song generation, so both paid gates apply.",
    z
      .object({
        input_path: z.string().min(1),
        extract_composition_plan: z.boolean().default(false),
        allow_paid: authorization.allow_paid,
        allow_unknown_cost: authorization.allow_unknown_cost,
      })
      .strict(),
    async (input) =>
      ctx.generation.execute({
        operation: "upload_music",
        category: "music_upload",
        endpoint: "/v1/music/upload",
        request: { extract_composition_plan: input.extract_composition_plan },
        filePath: input.input_path,
        fileField: "file",
        outputFilename: "unused.json",
        response: "json",
        authorization: { allowPaid: input.allow_paid, allowUnknownCost: input.allow_unknown_cost },
      }),
  );
}

function withSuffix(filename: string, suffix: string): string {
  return `${filename.replace(/\.[^.]+$/, "")}${suffix}`;
}
