import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";

const auth = { allow_paid: z.boolean().default(false), allow_unknown_cost: z.boolean().default(false) };
const voiceSettings = z
  .object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    use_speaker_boost: z.boolean().optional(),
    speed: z.number().min(0.5).max(2).optional(),
  })
  .strict();

export function registerSpeechTools(server: McpServer, ctx: AppContext): void {
  const speechInput = z
    .object({
      voice_id: z.string().min(1).max(100),
      text: z.string().min(1).max(20_000),
      model_id: z.string().max(100).optional(),
      language_code: z.string().max(20).optional(),
      output_format: z.string().max(50).default("mp3_44100_128"),
      voice_settings: voiceSettings.optional(),
      filename: z.string().min(1).max(200),
      allow_paid: auth.allow_paid,
      allow_unknown_cost: auth.allow_unknown_cost,
    })
    .strict();
  const speechHandler = (withTimestamps: boolean, stream: boolean) => async (input: z.infer<typeof speechInput>) => {
    const { voice_id, text, filename, output_format, allow_paid, allow_unknown_cost, ...options } = input;
    return ctx.generation.execute({
      operation: stream
        ? "generate_speech_stream"
        : withTimestamps
          ? "generate_speech_with_timestamps"
          : "generate_speech",
      category: "speech",
      endpoint: `/v1/text-to-speech/${encodeURIComponent(voice_id)}${stream ? `/stream${withTimestamps ? "/with-timestamps" : ""}` : withTimestamps ? "/with-timestamps" : ""}`,
      modelId: options.model_id,
      request: { text, ...options },
      outputFilename: filename,
      response: withTimestamps ? "json" : "binary",
      jsonAudioField: withTimestamps ? "audio_base64" : undefined,
      query: { output_format },
      authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
    });
  };
  registerTool(
    server,
    ctx.logger,
    "generate_speech",
    "Generate and save speech audio. This may consume credits and is blocked by dry_run or either missing paid authorization gate.",
    speechInput,
    speechHandler(false, false),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_speech_stream",
    "Call the documented streaming TTS endpoint and save its resulting audio. Streaming does not bypass the paid-operation gates.",
    speechInput,
    speechHandler(false, true),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_speech_with_timestamps",
    "Generate speech with the documented alignment response. Audio and timing metadata are saved separately.",
    speechInput,
    speechHandler(true, false),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_speech_stream_with_timestamps",
    "Call streaming TTS with the documented alignment response. Audio and timing metadata are saved separately behind paid-operation gates.",
    speechInput,
    speechHandler(true, true),
  );

  const dialogue = z
    .object({
      inputs: z
        .array(z.object({ text: z.string().min(1).max(2000), voice_id: z.string().min(1).max(100) }).strict())
        .min(1)
        .max(100),
      model_id: z.string().max(100).optional(),
      language_code: z.string().max(20).optional(),
      output_format: z.string().max(50).default("mp3_44100_128"),
      previous_text: z.string().max(100).optional(),
      future_text: z.string().max(100).optional(),
      filename: z.string().min(1).max(200),
      allow_paid: auth.allow_paid,
      allow_unknown_cost: auth.allow_unknown_cost,
    })
    .strict()
    .superRefine((value, issue) => {
      const chars = value.inputs.reduce((total, item) => total + item.text.length, 0);
      if (chars > 2000)
        issue.addIssue({
          code: "custom",
          message: "The official dialogue guide recommends no more than 2,000 total characters per request",
          path: ["inputs"],
        });
      if (new Set(value.inputs.map((item) => item.voice_id)).size > 10)
        issue.addIssue({ code: "custom", message: "At most 10 unique voice IDs are supported", path: ["inputs"] });
    });
  const dialogueHandler =
    (timestamp: boolean, stream = false) =>
    async (input: z.infer<typeof dialogue>) => {
      const { filename, output_format, allow_paid, allow_unknown_cost, ...body } = input;
      const suffix = stream ? `/stream${timestamp ? "/with-timestamps" : ""}` : timestamp ? "/with-timestamps" : "";
      return ctx.generation.execute({
        operation: stream
          ? timestamp
            ? "generate_dialogue_stream_with_timestamps"
            : "generate_dialogue_stream"
          : timestamp
            ? "generate_dialogue_with_timestamps"
            : "generate_dialogue",
        category: "dialogue",
        endpoint: `/v1/text-to-dialogue${suffix}`,
        modelId: input.model_id,
        request: body,
        outputFilename: filename,
        response: timestamp ? "json" : "binary",
        jsonAudioField: timestamp ? "audio_base64" : undefined,
        query: { output_format },
        authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
      });
    };
  registerTool(
    server,
    ctx.logger,
    "generate_dialogue",
    "Generate a multi-voice dialogue in input order. Enforces the documented unique voice and length limits. Paid authorization is required.",
    dialogue,
    dialogueHandler(false),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_dialogue_stream",
    "Call the documented streaming endpoint for a multi-voice dialogue and save the completed response locally.",
    dialogue,
    dialogueHandler(false, true),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_dialogue_with_timestamps",
    "Generate multi-voice dialogue with segment timing data. Paid authorization is required.",
    dialogue,
    dialogueHandler(true),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_dialogue_stream_with_timestamps",
    "Call the streaming dialogue endpoint with the documented alignment response and save audio plus timing metadata.",
    dialogue,
    dialogueHandler(true, true),
  );
}
