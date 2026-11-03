import { loadConfig } from "./config/env.js";
import { ElevenLabsAdapter } from "./adapters/elevenlabs-client.js";
import { openDatabase } from "./db/database.js";
import { BudgetManager } from "./services/budget/budget-manager.js";
import { GenerationService } from "./services/generation/generation-service.js";
import { MediaManager } from "./services/media/media-manager.js";

const args = new Set(process.argv.slice(2));
const config = loadConfig();
if (!config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is required for a real smoke test");
const adapter = new ElevenLabsAdapter(config);

if (!args.has("--paid")) {
  const [account, models] = await Promise.all([adapter.accountInfo(), adapter.models()]);
  console.log(
    JSON.stringify(
      { success: true, paid_request: false, account, model_count: Array.isArray(models) ? models.length : null },
      null,
      2,
    ),
  );
} else {
  if (!args.has("--confirm-paid-call") || !args.has("--allow-unknown-cost"))
    throw new Error("Paid smoke mode requires --confirm-paid-call and --allow-unknown-cost");
  if (config.DRY_RUN || !config.ALLOW_PAID_GENERATIONS)
    throw new Error("Paid smoke mode requires DRY_RUN=false and ALLOW_PAID_GENERATIONS=true");
  const voiceId = process.env.ELEVENLABS_SMOKE_VOICE_ID;
  if (!voiceId) throw new Error("Set ELEVENLABS_SMOKE_VOICE_ID to a voice you can use");
  const db = openDatabase(config.DATABASE_PATH);
  try {
    const media = new MediaManager(config, db);
    const generation = new GenerationService(adapter.http, new BudgetManager(db, config), media, db, config);
    const result = await generation.execute({
      operation: "manual_paid_smoke_test",
      category: "speech",
      endpoint: `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      request: { text: "MCP smoke test.", model_id: "eleven_multilingual_v2" },
      query: { output_format: "mp3_44100_128" },
      outputFilename: `smoke-${Date.now()}.mp3`,
      authorization: { allowPaid: true, allowUnknownCost: true },
    });
    console.log(JSON.stringify({ success: true, paid_request: true, result }, null, 2));
  } finally {
    db.close();
  }
}
