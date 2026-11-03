import type Database from "better-sqlite3";
import type { Logger } from "pino";
import type { AppConfig } from "../config/env.js";
import type { ElevenLabsAdapter } from "../adapters/elevenlabs-client.js";
import type { BudgetManager } from "../services/budget/budget-manager.js";
import type { GenerationService } from "../services/generation/generation-service.js";
import type { MediaManager } from "../services/media/media-manager.js";
import type { MediaService } from "../services/media/media-service.js";

export interface AppContext {
  config: AppConfig;
  db: Database.Database;
  logger: Logger;
  eleven: ElevenLabsAdapter;
  budget: BudgetManager;
  generation: GenerationService;
  media: MediaManager;
  mediaService: MediaService;
}
