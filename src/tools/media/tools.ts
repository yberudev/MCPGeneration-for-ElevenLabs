import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";

const format = z.enum(["wav", "ogg", "mp3", "flac"]);

export function registerMediaTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "inspect_media",
    "Inspect one local media file's size, hash, container, codec and duration when locally available.",
    z.object({ path: z.string().min(1) }).strict(),
    async ({ path }) => ({
      success: true,
      operation: "inspect_media",
      call_remote: false,
      data: await ctx.mediaService.inspect(path),
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "convert_audio",
    "Convert a local audio file with FFmpeg. The requested output format is encoded and verified; changing an extension alone is not used.",
    z
      .object({
        input_path: z.string().min(1),
        filename: z.string().min(1).max(200),
        format,
        overwrite: z.boolean().default(false),
      })
      .strict(),
    async (input) => ctx.mediaService.convert(input.input_path, input.filename, input.format, input.overwrite),
  );
  registerTool(
    server,
    ctx.logger,
    "normalize_audio",
    "Normalize local audio loudness using the FFmpeg loudnorm filter.",
    z
      .object({
        input_path: z.string().min(1),
        filename: z.string().min(1).max(200),
        format: format.default("wav"),
        overwrite: z.boolean().default(false),
      })
      .strict(),
    async (input) => ctx.mediaService.normalize(input.input_path, input.filename, input.format, input.overwrite),
  );
  registerTool(
    server,
    ctx.logger,
    "trim_audio",
    "Trim local audio using a start offset and duration in seconds.",
    z
      .object({
        input_path: z.string().min(1),
        filename: z.string().min(1).max(200),
        start_seconds: z.number().nonnegative(),
        duration_seconds: z.number().positive(),
        format: format.default("wav"),
        overwrite: z.boolean().default(false),
      })
      .strict(),
    async (input) =>
      ctx.mediaService.trim(
        input.input_path,
        input.filename,
        input.start_seconds,
        input.duration_seconds,
        input.format,
        input.overwrite,
      ),
  );
  registerTool(
    server,
    ctx.logger,
    "create_audio_loop",
    "Repeat an audio file to a requested duration. The output is not claimed to have a seamless boundary.",
    z
      .object({
        input_path: z.string().min(1),
        filename: z.string().min(1).max(200),
        duration_seconds: z.number().positive().max(3600),
        format: z.enum(["wav", "ogg", "mp3"]).default("ogg"),
        overwrite: z.boolean().default(false),
      })
      .strict(),
    async (input) =>
      ctx.mediaService.loop(input.input_path, input.filename, input.duration_seconds, input.format, input.overwrite),
  );
  registerTool(
    server,
    ctx.logger,
    "split_audio",
    "Split local audio into segments of the requested maximum duration using FFmpeg.",
    z
      .object({
        input_path: z.string().min(1),
        segment_seconds: z.number().positive().max(3600),
        filename_prefix: z.string().min(1).max(120),
      })
      .strict(),
    async ({ input_path, segment_seconds, filename_prefix }) =>
      ctx.mediaService.split(input_path, segment_seconds, filename_prefix),
  );
  registerTool(
    server,
    ctx.logger,
    "merge_audio",
    "Concatenate local audio files through FFmpeg's audio concat filter.",
    z
      .object({
        input_paths: z.array(z.string().min(1)).min(2).max(20),
        filename: z.string().min(1).max(200),
        format,
        overwrite: z.boolean().default(false),
      })
      .strict(),
    async (input) => ctx.mediaService.merge(input.input_paths, input.filename, input.format, input.overwrite),
  );
  registerTool(
    server,
    ctx.logger,
    "export_to_godot",
    "Export one local audio asset to an explicitly supplied and authorized Godot project root. Requires that project root to be within ALLOWED_ROOTS.",
    z
      .object({
        input_path: z.string().min(1),
        project_root: z.string().min(1),
        relative_path: z.string().min(1).max(300),
        profile: z.enum(["godot_sfx", "godot_music", "godot_dialogue", "godot_ambient", "trailer_audio"]),
        overwrite: z.boolean().default(false),
      })
      .strict(),
    async (input) =>
      ctx.mediaService.exportGodot(
        input.input_path,
        input.project_root,
        input.relative_path,
        input.profile,
        input.overwrite,
      ),
  );
  registerTool(
    server,
    ctx.logger,
    "list_generated_assets",
    "List local files recorded in the asset registry.",
    z.object({}).strict(),
    async () => ({
      success: true,
      operation: "list_generated_assets",
      call_remote: false,
      assets: ctx.media.listAssets(),
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "extract_music_stems",
    "Safely extract supported audio tracks from a generated ZIP. Rejects traversal, symlinks, non-audio entries, and oversized expansions.",
    z.object({ zip_path: z.string().min(1), filename_prefix: z.string().min(1).max(120) }).strict(),
    async ({ zip_path, filename_prefix }) => ctx.mediaService.extractStems(zip_path, filename_prefix),
  );
}
