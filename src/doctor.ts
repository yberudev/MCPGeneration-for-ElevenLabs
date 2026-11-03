import { access, constants, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { loadConfig } from "./config/env.js";
import { openDatabase } from "./db/database.js";

const config = loadConfig();
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
checks.push({ name: "node", ok: Number(process.versions.node.split(".")[0]) >= 24, detail: process.versions.node });
checks.push({
  name: "api_key_configured",
  ok: Boolean(config.ELEVENLABS_API_KEY),
  detail: config.ELEVENLABS_API_KEY ? "configured (value hidden)" : "not configured; remote tools require a key",
});
checks.push({
  name: "paid_generation_default",
  ok: config.DRY_RUN && !config.ALLOW_PAID_GENERATIONS,
  detail: `DRY_RUN=${config.DRY_RUN}; ALLOW_PAID_GENERATIONS=${config.ALLOW_PAID_GENERATIONS}`,
});
for (const [name, binary] of [
  ["ffmpeg", config.FFMPEG_PATH],
  ["ffprobe", config.FFPROBE_PATH],
] as const) {
  const result = spawnSync(binary, ["-version"], { encoding: "utf8", timeout: 5_000, shell: false });
  checks.push({
    name,
    ok: result.status === 0,
    detail: result.status === 0 ? (result.stdout.split("\n")[0] ?? "available") : `${binary} is unavailable`,
  });
}
await mkdir(config.GENERATED_DIR, { recursive: true });
await mkdir(config.DATABASE_PATH.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
const db = openDatabase(config.DATABASE_PATH);
const sqliteResult = db.prepare("SELECT 1 AS value").get() as { value?: number } | undefined;
checks.push({ name: "sqlite", ok: sqliteResult?.value === 1, detail: config.DATABASE_PATH });
db.close();
const permissions = await access(config.GENERATED_DIR, constants.W_OK)
  .then(() => true)
  .catch(() => false);
checks.push({ name: "generated_dir_writable", ok: permissions, detail: config.GENERATED_DIR });
const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ success: failed.length === 0, checks }, null, 2));
if (failed.length) process.exitCode = 1;
