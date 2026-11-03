import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { AppConfig } from "../config/env.js";
import { ElevenLabsHttp } from "./elevenlabs-http.js";
import { OpenApiContracts } from "../services/openapi-contracts.js";
import { AppError } from "../utils/errors.js";

/** SDK-backed read calls plus documented REST fallbacks for binary and newer endpoints. */
export class ElevenLabsAdapter {
  readonly sdk: ElevenLabsClient | null;
  readonly http: ElevenLabsHttp;

  constructor(config: AppConfig) {
    this.sdk = config.ELEVENLABS_API_KEY
      ? new ElevenLabsClient({
          apiKey: config.ELEVENLABS_API_KEY,
          maxRetries: 0,
          timeoutInSeconds: Math.ceil(config.REQUEST_TIMEOUT_MS / 1000),
        })
      : null;
    this.http = new ElevenLabsHttp(
      config.ELEVENLABS_API_KEY,
      config.REQUEST_TIMEOUT_MS,
      config.MAX_MEDIA_BYTES,
      fetch,
      new OpenApiContracts(),
    );
  }

  async accountInfo(): Promise<unknown> {
    return this.requireSdk().user.get({ maxRetries: 0 });
  }

  async subscription(): Promise<unknown> {
    return this.requireSdk().user.subscription.get({ maxRetries: 0 });
  }

  async models(): Promise<unknown> {
    return this.requireSdk().models.list({ maxRetries: 0 });
  }

  async voices(query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.http.json("GET", "/v2/voices", { query });
  }

  async voice(voiceId: string): Promise<unknown> {
    return this.requireSdk().voices.get(voiceId, {}, { maxRetries: 0 });
  }

  async voiceSettings(voiceId: string): Promise<unknown> {
    return this.requireSdk().voices.settings.get(voiceId, { maxRetries: 0 });
  }

  async audioEffects(): Promise<unknown> {
    return this.requireSdk().audioEffects.getCatalog({ maxRetries: 0 });
  }

  private requireSdk(): ElevenLabsClient {
    if (!this.sdk) throw new AppError("ELEVENLABS_API_KEY is not configured", "missing_api_key");
    return this.sdk;
  }
}
