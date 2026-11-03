import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";
import { AppError } from "../../utils/errors.js";

const policy = { allow_paid: z.boolean().default(false), allow_unknown_cost: z.boolean().default(false) };

export function registerVoiceTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "design_voice",
    "Generate voice previews from a description. The API returns multiple sample audios; they are saved to local files and omitted from the tool response. This may consume credits.",
    z
      .object({
        voice_description: z.string().min(20).max(1000),
        model_id: z.enum(["eleven_multilingual_ttv_v2", "eleven_ttv_v3"]).default("eleven_multilingual_ttv_v2"),
        text: z.string().min(100).max(1000).optional(),
        auto_generate_text: z.boolean().default(false),
        loudness: z.number().min(-1).max(1).optional(),
        seed: z.number().int().min(0).max(2147483647).optional(),
        guidance_scale: z.number().min(0).max(100).optional(),
        filename_prefix: z.string().min(1).max(150).default("voice-preview"),
        allow_paid: policy.allow_paid,
        allow_unknown_cost: policy.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const { filename_prefix, allow_paid, allow_unknown_cost, ...body } = input;
      return ctx.generation.execute({
        operation: "design_voice",
        category: "voice_preview",
        endpoint: "/v1/text-to-voice/design",
        modelId: input.model_id,
        request: body,
        outputFilename: `${filename_prefix}.mp3`,
        response: "json",
        jsonAudioArray: { arrayField: "previews", audioField: "audio_base_64", filenamePrefix: filename_prefix },
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  registerTool(
    server,
    ctx.logger,
    "create_voice_from_preview",
    "Save one previously generated preview as a reusable voice. Requires confirm_save=true and both paid-operation gates.",
    z
      .object({
        voice_name: z.string().min(1).max(100),
        voice_description: z.string().min(20).max(1000),
        generated_voice_id: z.string().min(1).max(100),
        confirm_save: z.boolean().default(false),
        allow_paid: policy.allow_paid,
        allow_unknown_cost: policy.allow_unknown_cost,
      })
      .strict(),
    async ({ confirm_save, allow_paid, allow_unknown_cost, ...body }) => {
      if (!confirm_save)
        throw new AppError("Creating a saved voice requires confirm_save=true", "confirmation_required");
      return ctx.generation.execute({
        operation: "create_voice_from_preview",
        category: "voice",
        endpoint: "/v1/text-to-voice",
        request: body,
        outputFilename: "unused.json",
        response: "json",
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  registerTool(
    server,
    ctx.logger,
    "remix_voice",
    "Create new voice previews from one of your saved voices. Preview generation may consume credits and requires both paid-operation gates.",
    z
      .object({
        voice_id: z.string().min(1).max(100),
        voice_description: z.string().min(20).max(1000),
        text: z.string().min(100).max(1000).optional(),
        auto_generate_text: z.boolean().default(false),
        loudness: z.number().min(0).max(1).default(0.5),
        seed: z.number().int().min(0).optional(),
        guidance_scale: z.number().min(0).max(100).default(2),
        stream_previews: z.boolean().default(false),
        remixing_session_id: z.string().optional(),
        remixing_session_iteration_id: z.string().optional(),
        prompt_strength: z.number().min(0).max(1).optional(),
        output_format: z.string().max(50).default("mp3_44100_128"),
        filename_prefix: z.string().min(1).max(150).default("voice-remix"),
        allow_paid: policy.allow_paid,
        allow_unknown_cost: policy.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const { voice_id, output_format, filename_prefix, allow_paid, allow_unknown_cost, ...body } = input;
      return ctx.generation.execute({
        operation: "remix_voice",
        category: "voice_preview",
        endpoint: `/v1/text-to-voice/${encodeURIComponent(voice_id)}/remix`,
        modelId: "voice_remix",
        request: body,
        outputFilename: `${filename_prefix}.mp3`,
        response: "json",
        query: { output_format },
        jsonAudioArray: { arrayField: "previews", audioField: "audio_base_64", filenamePrefix: filename_prefix },
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  registerTool(
    server,
    ctx.logger,
    "get_voice_preview",
    "Download an existing generated voice preview to a local MP3 file without generating a new sample.",
    z.object({ generated_voice_id: z.string().min(1).max(100), filename: z.string().min(1).max(200) }).strict(),
    async ({ generated_voice_id, filename }) => {
      const result = await ctx.eleven.http.binary(
        "GET",
        `/v1/text-to-voice/${encodeURIComponent(generated_voice_id)}/stream`,
      );
      const saved = await ctx.media.save(result.data, filename, "voice_preview", { generated_voice_id });
      return {
        success: true,
        operation: "get_voice_preview",
        call_remote: true,
        file: { path: saved.path, mime_type: saved.mimeType, bytes: saved.bytes, sha256: saved.sha256 },
        request_id: result.requestId,
      };
    },
  );

  registerTool(
    server,
    ctx.logger,
    "clone_voice",
    "Create an instant voice clone from local audio samples. Requires explicit rights/consent confirmation, up to three sample files, and both paid authorization gates.",
    z
      .object({
        name: z.string().min(1).max(100),
        sample_paths: z.array(z.string().min(1)).min(1).max(3),
        description: z.string().max(1000).optional(),
        labels: z.record(z.string(), z.string()).optional(),
        remove_background_noise: z.boolean().default(false),
        rights_and_consent_confirmed: z.boolean().default(false),
        allow_paid: policy.allow_paid,
        allow_unknown_cost: policy.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      if (!input.rights_and_consent_confirmed)
        throw new AppError(
          "Voice cloning requires confirmation that you own or are authorized to use every recording",
          "voice_consent_required",
        );
      const { sample_paths, rights_and_consent_confirmed, allow_paid, allow_unknown_cost, ...fields } = input;
      void rights_and_consent_confirmed;
      return ctx.generation.execute({
        operation: "clone_voice",
        category: "voice_clone",
        endpoint: "/v1/voices/add",
        request: fields,
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
    "update_voice_settings",
    "Update stored settings for one voice using the documented voice settings endpoint.",
    z
      .object({
        voice_id: z.string().min(1).max(100),
        settings: z
          .object({
            stability: z.number().min(0).max(1).optional(),
            similarity_boost: z.number().min(0).max(1).optional(),
            style: z.number().min(0).max(1).optional(),
            use_speaker_boost: z.boolean().optional(),
            speed: z.number().min(0.5).max(2).optional(),
          })
          .strict(),
      })
      .strict(),
    async ({ voice_id, settings }) => ({
      success: true,
      call_remote: true,
      data: await ctx.eleven.http.json("POST", `/v1/voices/${encodeURIComponent(voice_id)}/settings/edit`, {
        body: settings,
      }),
    }),
  );

  registerTool(
    server,
    ctx.logger,
    "delete_voice",
    "Permanently delete a voice from the account. Requires explicit confirm_delete=true.",
    z.object({ voice_id: z.string().min(1).max(100), confirm_delete: z.boolean().default(false) }).strict(),
    async ({ voice_id, confirm_delete }) => {
      if (!confirm_delete)
        throw new AppError("Deleting a remote voice requires confirm_delete=true", "confirmation_required");
      const result = await ctx.eleven.http.json("DELETE", `/v1/voices/${encodeURIComponent(voice_id)}`);
      return { success: true, operation: "delete_voice", call_remote: true, data: result.data };
    },
  );
}
