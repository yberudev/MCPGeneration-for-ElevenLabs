import { McpServer } from "@modelcontextprotocol/server";
import pino, { type Logger } from "pino";
import { mkdirSync } from "node:fs";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config/env.js";
import { loadConfig } from "../config/env.js";
import { ElevenLabsAdapter } from "../adapters/elevenlabs-client.js";
import { openDatabase } from "../db/database.js";
import { BudgetManager } from "../services/budget/budget-manager.js";
import { GenerationService } from "../services/generation/generation-service.js";
import { MediaManager } from "../services/media/media-manager.js";
import { MediaService } from "../services/media/media-service.js";
import type { AppContext } from "./context.js";
import { registerTools } from "./register-tools.js";

export interface Application {
  server: McpServer;
  context: AppContext;
  close(): void;
}

export function createApplication(
  config: AppConfig = loadConfig(),
  logger: Logger = pino({ level: config.LOG_LEVEL }, pino.destination(2)),
  database?: Database.Database,
): Application {
  mkdirSync(config.GENERATED_DIR, { recursive: true });
  mkdirSync(config.DATABASE_PATH.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  const db = database ?? openDatabase(config.DATABASE_PATH);
  const media = new MediaManager(config, db);
  const eleven = new ElevenLabsAdapter(config);
  const budget = new BudgetManager(db, config);
  const generation = new GenerationService(eleven.http, budget, media, db, config);
  const mediaService = new MediaService(config, media);
  const context: AppContext = { config, db, logger, eleven, budget, generation, media, mediaService };
  const server = new McpServer({ name: "MCPGeneration-for-ElevenLabs", version: "0.1.0" });
  registerTools(server, context);
  return {
    server,
    context,
    close: () => {
      if (!database) db.close();
    },
  };
}
