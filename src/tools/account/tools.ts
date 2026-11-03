import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppContext } from "../../server/context.js";
import { registerTool } from "../../server/tool-utils.js";

export function registerAccountTools(server: McpServer, ctx: AppContext): void {
  registerTool(
    server,
    ctx.logger,
    "get_account_info",
    "Read the authenticated ElevenLabs account profile. Makes a read-only API call.",
    z.object({}).strict(),
    async () => ({ success: true, call_remote: true, data: await ctx.eleven.accountInfo() }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_subscription",
    "Read the account subscription and documented usage fields. This does not estimate generation cost.",
    z.object({}).strict(),
    async () => ({ success: true, call_remote: true, data: await ctx.eleven.subscription() }),
  );
  registerTool(
    server,
    ctx.logger,
    "list_models",
    "List models returned by ElevenLabs GET /v1/models.",
    z.object({}).strict(),
    async () => ({ success: true, call_remote: true, data: await ctx.eleven.models() }),
  );
  registerTool(
    server,
    ctx.logger,
    "list_voices",
    "Search the authenticated voice catalog through ElevenLabs GET /v2/voices.",
    z
      .object({
        search: z.string().max(100).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
        next_page_token: z.string().max(300).optional(),
      })
      .strict(),
    async (input) => ({
      success: true,
      call_remote: true,
      data: await ctx.eleven.voices({
        search: input.search,
        page_size: input.page_size,
        next_page_token: input.next_page_token,
      }),
    }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_voice",
    "Read a single voice by ID.",
    z.object({ voice_id: z.string().min(1).max(100) }).strict(),
    async ({ voice_id }) => ({ success: true, call_remote: true, data: await ctx.eleven.voice(voice_id) }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_voice_settings",
    "Read the saved settings for an ElevenLabs voice.",
    z.object({ voice_id: z.string().min(1).max(100) }).strict(),
    async ({ voice_id }) => ({ success: true, call_remote: true, data: await ctx.eleven.voiceSettings(voice_id) }),
  );
  registerTool(
    server,
    ctx.logger,
    "list_audio_effects",
    "Read the documented audio effects catalog.",
    z.object({}).strict(),
    async () => ({ success: true, call_remote: true, data: await ctx.eleven.audioEffects() }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_capabilities",
    "Combine local implementation flags with read-only account and model information. Plan access remains unknown unless the API reports it.",
    z.object({}).strict(),
    async () => {
      const [subscription, models] = await Promise.allSettled([ctx.eleven.subscription(), ctx.eleven.models()]);
      const plan =
        subscription.status === "fulfilled" && typeof subscription.value === "object" && subscription.value !== null
          ? ((subscription.value as Record<string, unknown>).tier ?? null)
          : null;
      return {
        success: true,
        call_remote: true,
        plan,
        subscription_status: subscription.status,
        models_status: models.status,
        implemented: [
          "account_read",
          "tts",
          "dialogue",
          "sound_effects",
          "music_generation",
          "music_stems",
          "video_to_music",
          "voice_design",
          "voice_remix",
          "voice_management",
          "voice_conversion",
          "speech_to_text",
          "forced_alignment",
          "audio_isolation",
          "dubbing_projects",
          "flows",
          "assets",
          "history",
          "local_media",
          "godot_export",
        ],
        partial: [
          "music_inpainting_workflow",
          "dubbing_editor_and_transcript_mutations",
          "voice_professional_cloning",
          "provider_streams_are_saved_after_buffering",
        ],
        not_implemented: [
          "music_continuation_or_remix",
          "dubbing_speaker_and_segment_editor",
          "real_time_audio_forwarding",
        ],
        gated: {
          images: ctx.config.ENABLE_IMAGE_API,
          videos: ctx.config.ENABLE_VIDEO_API,
          music_finetunes: ctx.config.ENABLE_MUSIC_FINETUNES,
        },
        note: "Capabilities that cannot be queried without a generation request are reported as unknown; this tool never probes access using a paid operation.",
        data: {
          subscription: subscription.status === "fulfilled" ? subscription.value : null,
          models: models.status === "fulfilled" ? models.value : null,
        },
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "get_budget_status",
    "Read local generation policy, observed local usage and unsettled reservations.",
    z.object({}).strict(),
    async () => ({ success: true, call_remote: false, ...ctx.budget.getStatus() }),
  );
  registerTool(
    server,
    ctx.logger,
    "get_usage_report",
    "Read local operation counts and explicit usage values returned by the API. Character counts are not converted into credits.",
    z.object({}).strict(),
    async () => ({ success: true, call_remote: false, ...ctx.budget.getUsageReport() }),
  );
  registerTool(
    server,
    ctx.logger,
    "set_local_budget",
    "Change local request, monthly and concurrency policy limits. This does not enable paid calls.",
    z
      .object({
        max_credits_per_request: z.number().int().nonnegative().optional(),
        max_monthly_credits: z.number().int().nonnegative().optional(),
        max_concurrent_generations: z.number().int().positive().optional(),
      })
      .strict(),
    async (input) => {
      ctx.budget.setLocalBudget({
        MAX_CREDITS_PER_REQUEST: input.max_credits_per_request,
        MAX_MONTHLY_CREDITS: input.max_monthly_credits,
        MAX_CONCURRENT_GENERATIONS: input.max_concurrent_generations,
      });
      return {
        success: true,
        call_remote: false,
        paid_generations_enabled: ctx.config.ALLOW_PAID_GENERATIONS,
        dry_run: ctx.config.DRY_RUN,
        policy: ctx.budget.getStatus(),
      };
    },
  );
  registerTool(
    server,
    ctx.logger,
    "estimate_cost",
    "Return an official estimate only when one is available. This local implementation does not invent per-character, per-second or per-generation prices.",
    z
      .object({
        operation: z.enum([
          "tts",
          "dialogue",
          "sound_effect",
          "music",
          "transcription",
          "voice_changer",
          "audio_isolation",
          "dubbing",
          "image",
          "video",
        ]),
        text: z.string().max(20_000).optional(),
        duration_seconds: z.number().positive().optional(),
        model_id: z.string().max(100).optional(),
      })
      .strict(),
    async ({ operation }) => ({
      success: true,
      operation,
      call_remote: false,
      estimated_credits: null,
      confidence: "unavailable",
      reason:
        "No reliable official preflight price is exposed for this operation. The composition-plan endpoint is documented as not consuming credits.",
    }),
  );
}
