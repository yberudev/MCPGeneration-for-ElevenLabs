import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";

const schema = z
  .object({
    text: z.string().min(1).max(1000),
    duration_seconds: z.number().min(0.5).max(30).optional(),
    loop: z.boolean().default(false),
    prompt_influence: z.number().min(0).max(1).optional(),
    model_id: z.enum(["eleven_text_to_sound_v2", "eleven_text_to_sound_v3"]).optional(),
    output_format: z.string().max(50).default("mp3_44100_128"),
    filename: z.string().min(1).max(200),
    allow_paid: z.boolean().default(false),
    allow_unknown_cost: z.boolean().default(false),
  })
  .strict();

export function registerSoundTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "get_sound_effect_presets",
    "Return editable local starter prompts for common game-audio categories. This is local guidance and does not contact ElevenLabs.",
    z
      .object({
        category: z
          .enum([
            "combat",
            "footsteps",
            "construction",
            "destruction",
            "ui",
            "ambience",
            "creature",
            "magic",
            "vehicle",
            "cinematic",
          ])
          .optional(),
      })
      .strict(),
    async ({ category }) => {
      const presets = {
        combat: "A single close, punchy game combat impact with a short natural decay; no music, no speech.",
        footsteps:
          "A short sequence of clearly separated footsteps on the specified material, consistent pace, no music.",
        construction: "A brief sequence of tactile building and tool sounds, distinct transients, no voice or music.",
        destruction: "A concise game-ready break and debris fall with a strong initial transient and short tail.",
        ui: "A clean, short user-interface confirmation sound with a soft transient and minimal tail.",
        ambience: "A calm continuous environmental bed with subtle variation and no foreground speech or music.",
        creature: "An original expressive creature vocalization, clearly nonverbal, with a defined beginning and end.",
        magic: "A short magical energy effect with a rising shimmer, clear impact, and controlled decay.",
        vehicle: "A brief game vehicle sound with a readable mechanical start, movement, and stop.",
        cinematic: "A compact cinematic transition accent that rises, lands clearly, and decays without speech.",
      } satisfies Record<string, string>;
      return {
        success: true,
        call_remote: false,
        presets: category ? { [category]: presets[category] } : presets,
        editable: true,
      };
    },
  );
  const handler = (ambient: boolean) => async (input: z.infer<typeof schema>) => {
    const { filename, output_format, allow_paid, allow_unknown_cost, ...body } = input;
    return ctx.generation.execute({
      operation: ambient ? "generate_ambient_audio" : "generate_sound_effect",
      category: ambient ? "ambient" : "sound_effect",
      endpoint: "/v1/sound-generation",
      modelId: input.model_id,
      request: { ...body, loop: ambient ? true : body.loop },
      outputFilename: filename,
      query: { output_format },
      authorization: { allowPaid: allow_paid, allowUnknownCost: allow_unknown_cost },
    });
  };
  registerTool(
    server,
    ctx.logger,
    "generate_sound_effect",
    "Generate one sound effect from a text prompt. Official maximum duration is 30 seconds. Cost is not estimated by this MCP; explicit authorization is required.",
    schema,
    handler(false),
  );
  registerTool(
    server,
    ctx.logger,
    "generate_ambient_audio",
    "Generate an ambient sound loop using the documented loop flag. The API does not guarantee a seamless loop beyond its own generation behavior.",
    schema,
    handler(true),
  );
}
