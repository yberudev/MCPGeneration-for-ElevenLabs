import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";
import { AppError } from "../../utils/errors.js";

const payment = { allow_paid: z.boolean().default(false), allow_unknown_cost: z.boolean().default(false) };

export function registerTranscriptionTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "change_voice",
    "Transform a local recording into a target voice through the documented speech-to-speech endpoint.",
    z
      .object({
        voice_id: z.string().min(1).max(100),
        input_path: z.string().min(1),
        model_id: z.string().max(100).default("eleven_english_sts_v2"),
        output_format: z.string().max(50).default("mp3_44100_128"),
        remove_background_noise: z.boolean().default(false),
        filename: z.string().min(1).max(200),
        allow_paid: payment.allow_paid,
        allow_unknown_cost: payment.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const { input_path, voice_id, filename, allow_paid, allow_unknown_cost, output_format, ...fields } = input;
      return ctx.generation.execute({
        operation: "change_voice",
        category: "voice_conversion",
        endpoint: `/v1/voice-changer/${encodeURIComponent(voice_id)}`,
        request: fields,
        filePath: input_path,
        fileField: "audio",
        outputFilename: filename,
        query: { output_format },
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  registerTool(
    server,
    ctx.logger,
    "transcribe_audio",
    "Transcribe a local audio or video file. Supports the API's model, diarization and timestamp controls. Cost is not estimated locally.",
    z
      .object({
        input_path: z.string().min(1),
        model_id: z.string().min(1).max(100).default("scribe_v2"),
        language_code: z.string().max(20).optional(),
        tag_audio_events: z.boolean().optional(),
        num_speakers: z.number().int().min(1).max(32).optional(),
        timestamps_granularity: z.enum(["none", "word", "character"]).default("word"),
        diarize: z.boolean().optional(),
        filename: z.string().min(1).max(200).default("transcript.json"),
        allow_paid: payment.allow_paid,
        allow_unknown_cost: payment.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const { input_path, filename, allow_paid, allow_unknown_cost, ...fields } = input;
      return ctx.generation.execute({
        operation: "transcribe_audio",
        category: "transcription",
        endpoint: "/v1/speech-to-text",
        request: fields,
        filePath: input_path,
        fileField: "file",
        outputFilename: filename,
        response: "json",
        jsonSaveFilename: true,
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  registerTool(
    server,
    ctx.logger,
    "get_transcription",
    "Read an existing transcription job/result by its remote transcription ID.",
    z.object({ transcription_id: z.string().min(1).max(150) }).strict(),
    async ({ transcription_id }) => ({
      success: true,
      call_remote: true,
      data: (
        await ctx.eleven.http.json("GET", `/v1/speech-to-text/transcripts/${encodeURIComponent(transcription_id)}`)
      ).data,
    }),
  );

  registerTool(
    server,
    ctx.logger,
    "align_audio_to_text",
    "Align supplied text to a local audio file using the documented forced-alignment endpoint.",
    z
      .object({
        input_path: z.string().min(1),
        text: z.string().min(1).max(100_000),
        filename: z.string().min(1).max(200).default("alignment.json"),
        allow_paid: payment.allow_paid,
        allow_unknown_cost: payment.allow_unknown_cost,
      })
      .strict(),
    async (input) => {
      const { input_path, filename, allow_paid, allow_unknown_cost, ...fields } = input;
      return ctx.generation.execute({
        operation: "align_audio_to_text",
        category: "alignment",
        endpoint: "/v1/forced-alignment",
        request: fields,
        filePath: input_path,
        fileField: "file",
        outputFilename: filename,
        response: "json",
        jsonSaveFilename: true,
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    },
  );

  registerTool(
    server,
    ctx.logger,
    "isolate_voice",
    "Isolate speech from a local audio recording. This is not a music stem separator.",
    z
      .object({
        input_path: z.string().min(1),
        filename: z.string().min(1).max(200),
        allow_paid: payment.allow_paid,
        allow_unknown_cost: payment.allow_unknown_cost,
      })
      .strict(),
    async ({ input_path, filename, allow_paid, allow_unknown_cost }) =>
      ctx.generation.execute({
        operation: "isolate_voice",
        category: "audio_isolation",
        endpoint: "/v1/audio-isolation",
        request: {},
        filePath: input_path,
        fileField: "audio",
        outputFilename: filename,
        expectedExtension: ".mp3",
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      }),
  );

  registerTool(
    server,
    ctx.logger,
    "transcript_to_subtitles",
    "Convert a local JSON transcript with word timestamps into SRT or WebVTT. Writes one caption per timed word to preserve source alignment.",
    z
      .object({ input_path: z.string().min(1), format: z.enum(["srt", "vtt"]), filename: z.string().min(1).max(200) })
      .strict(),
    async ({ input_path, format, filename }) => {
      const path = await ctx.media.resolveAllowed(input_path);
      const { readFile } = await import("node:fs/promises");
      const data = JSON.parse(await readFile(path, "utf8")) as {
        words?: Array<{ text?: string; start?: number | null; end?: number | null; type?: string }>;
      };
      if (!Array.isArray(data.words))
        throw new AppError("Transcript has no word-level timestamp array", "timestamps_missing");
      const words = data.words.filter(
        (word) => typeof word.text === "string" && typeof word.start === "number" && typeof word.end === "number",
      );
      if (words.length === 0) throw new AppError("Transcript contains no usable word timestamps", "timestamps_missing");
      const timestamp = (seconds: number) => {
        const ms = Math.max(0, Math.round(seconds * 1000));
        const h = Math.floor(ms / 3_600_000);
        const m = Math.floor((ms % 3_600_000) / 60_000);
        const s = Math.floor((ms % 60_000) / 1000);
        const milli = ms % 1000;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${format === "srt" ? "," : "."}${String(milli).padStart(3, "0")}`;
      };
      const content = `${format === "vtt" ? "WEBVTT\n\n" : ""}${words.map((word, index) => `${format === "srt" ? `${index + 1}\n` : ""}${timestamp(word.start!)} --> ${timestamp(word.end!)}\n${word.text}\n`).join("\n")}`;
      const saved = await ctx.media.save(Buffer.from(content), filename, "subtitle", { format, source: path });
      return {
        success: true,
        operation: "transcript_to_subtitles",
        call_remote: false,
        file: saved.path,
        sha256: saved.sha256,
      };
    },
  );
}
