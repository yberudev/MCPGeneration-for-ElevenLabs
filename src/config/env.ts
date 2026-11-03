import { config as loadDotEnv } from "dotenv";
import { isAbsolute, resolve } from "node:path";
import * as z from "zod/v4";

// Keep secrets in the ignored, project-local file. Existing process variables
// still win, and .env remains a fallback for compatibility.
loadDotEnv({ path: [".env.local", ".env"] });

const bool = z.preprocess(
  (value) => (value === undefined ? "false" : value),
  z.enum(["true", "false"]).transform((value) => value === "true"),
);

const envSchema = z.object({
  ELEVENLABS_API_KEY: z.string().optional().default(""),
  MCP_TRANSPORT: z.literal("stdio").default("stdio"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  GENERATED_DIR: z.string().default("./generated"),
  DATABASE_PATH: z.string().default("./data/mcp.sqlite"),
  ALLOWED_ROOTS: z.string().default(""),
  DRY_RUN: z.preprocess(
    (value) => (value === undefined ? "true" : value),
    z.enum(["true", "false"]).transform((value) => value === "true"),
  ),
  ALLOW_PAID_GENERATIONS: bool,
  MAX_CREDITS_PER_REQUEST: z.coerce.number().int().nonnegative().default(500),
  MAX_MONTHLY_CREDITS: z.coerce.number().int().nonnegative().default(5000),
  MAX_CONCURRENT_GENERATIONS: z.coerce.number().int().positive().default(1),
  ENABLE_IMAGE_API: bool,
  ENABLE_VIDEO_API: bool,
  ENABLE_MUSIC_FINETUNES: bool,
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(600_000).default(120_000),
  MAX_MEDIA_BYTES: z.coerce.number().int().positive().default(104_857_600),
});

export interface AppConfig extends Omit<
  z.infer<typeof envSchema>,
  "GENERATED_DIR" | "DATABASE_PATH" | "ALLOWED_ROOTS"
> {
  GENERATED_DIR: string;
  DATABASE_PATH: string;
  ALLOWED_ROOTS: string[];
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AppConfig {
  const parsed = envSchema.parse(source);
  const absolute = (path: string) => (isAbsolute(path) ? path : resolve(cwd, path));
  return {
    ...parsed,
    GENERATED_DIR: absolute(parsed.GENERATED_DIR),
    DATABASE_PATH: absolute(parsed.DATABASE_PATH),
    ALLOWED_ROOTS: parsed.ALLOWED_ROOTS.split(/[,:]/)
      .map((root) => root.trim())
      .filter(Boolean)
      .map(absolute),
  };
}
