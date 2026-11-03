import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsHttp } from "../../src/adapters/elevenlabs-http.js";
import { loadConfig } from "../../src/config/env.js";
import { openDatabase } from "../../src/db/database.js";
import { BudgetManager } from "../../src/services/budget/budget-manager.js";
import { GenerationService } from "../../src/services/generation/generation-service.js";
import { MediaManager } from "../../src/services/media/media-manager.js";
import { OpenApiContracts } from "../../src/services/openapi-contracts.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(fetchImpl: typeof fetch, paid = true) {
  const root = await mkdtemp(join(tmpdir(), "eleven-mcp-generation-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const config = loadConfig({
    ELEVENLABS_API_KEY: "offline-test-key",
    GENERATED_DIR: join(root, "generated"),
    DATABASE_PATH: join(root, "data.sqlite"),
    DRY_RUN: paid ? "false" : "true",
    ALLOW_PAID_GENERATIONS: paid ? "true" : "false",
    MAX_MEDIA_BYTES: "4096",
  });
  const db = openDatabase(":memory:");
  cleanups.push(async () => db.close());
  const media = new MediaManager(config, db);
  await media.initialize();
  const budget = new BudgetManager(db, config);
  const http = new ElevenLabsHttp(
    config.ELEVENLABS_API_KEY,
    config.REQUEST_TIMEOUT_MS,
    config.MAX_MEDIA_BYTES,
    fetchImpl,
    new OpenApiContracts(),
  );
  const generation = new GenerationService(http, budget, media, db, config);
  return { db, config, media, budget, generation };
}

const auth = { allowPaid: true, allowUnknownCost: true };
const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0]);
const audioResponse = () =>
  new Response(mp3, { headers: { "content-type": "audio/mpeg", "character-cost": "7", "request-id": "request-123" } });

describe("GenerationService", () => {
  it("saves and registers a valid audio response after explicit payment authorization", async () => {
    const fetchImpl = vi.fn(async () => audioResponse()) as unknown as typeof fetch;
    const { generation, db } = await setup(fetchImpl);
    const result = await generation.execute({
      operation: "generate_sound_effect",
      category: "sound_effect",
      endpoint: "/v1/sound-generation",
      request: { text: "A short bell" },
      outputFilename: "bell.mp3",
      query: { output_format: "mp3_44100_128" },
      authorization: auth,
    });
    expect(result).toMatchObject({ success: true, status: "completed", request_id: "request-123" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT status FROM generations").get()).toMatchObject({ status: "completed" });
    expect(db.prepare("SELECT state FROM credit_reservations").get()).toMatchObject({ state: "completed" });
  });

  it("saves timestamped audio separately from its JSON alignment metadata", async () => {
    const body = JSON.stringify({ audio_base64: mp3.toString("base64"), alignment: { characters: ["h", "i"] } });
    const fetchImpl = vi.fn(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const { generation, config } = await setup(fetchImpl);
    const result = await generation.execute({
      operation: "generate_speech_with_timestamps",
      category: "speech",
      endpoint: "/v1/text-to-speech/voice-1/with-timestamps",
      request: { text: "hi" },
      outputFilename: "line.mp3",
      response: "json",
      jsonAudioField: "audio_base64",
      query: { output_format: "mp3_44100_128" },
      authorization: auth,
    });
    expect(result).toMatchObject({ success: true, status: "completed" });
    expect(await readFile(join(config.GENERATED_DIR, "line.mp3"))).toEqual(mp3);
    expect(JSON.parse(await readFile(join(config.GENERATED_DIR, "line.json"), "utf8"))).toMatchObject({
      alignment: { characters: ["h", "i"] },
    });
  });

  it("decodes a detailed music multipart response into audio and metadata files", async () => {
    const boundary = "mcp-offline-boundary";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n{"song_metadata":{"bpm":90}}\r\n--${boundary}\r\nContent-Type: audio/mpeg\r\n\r\n`,
      ),
      mp3,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const fetchImpl = vi.fn(
      async () => new Response(multipart, { headers: { "content-type": `multipart/mixed; boundary=${boundary}` } }),
    ) as unknown as typeof fetch;
    const { generation, config } = await setup(fetchImpl);
    const result = await generation.execute({
      operation: "generate_music_detailed",
      category: "music",
      endpoint: "/v1/music/detailed",
      request: { prompt: "gentle piano" },
      outputFilename: "theme.mp3",
      response: "multipart_mixed",
      query: { output_format: "mp3_44100_128" },
      authorization: auth,
    });
    expect(result).toMatchObject({ success: true, status: "completed" });
    expect(await readFile(join(config.GENERATED_DIR, "theme.mp3"))).toEqual(mp3);
    expect(JSON.parse(await readFile(join(config.GENERATED_DIR, "theme.json"), "utf8"))).toMatchObject({
      song_metadata: { bpm: 90 },
    });
  });

  it("does not send a remote request in dry-run", async () => {
    const fetchImpl = vi.fn(async () => audioResponse()) as unknown as typeof fetch;
    const { generation } = await setup(fetchImpl, false);
    await expect(
      generation.execute({
        operation: "generate_sound_effect",
        category: "sound_effect",
        endpoint: "/v1/sound-generation",
        request: { text: "A short bell" },
        outputFilename: "bell.mp3",
        query: { output_format: "mp3_44100_128" },
        authorization: auth,
      }),
    ).rejects.toThrow(/Dry run is enabled/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects mismatched and unsupported output formats before creating a reservation", async () => {
    const fetchImpl = vi.fn(async () => audioResponse()) as unknown as typeof fetch;
    const { generation, db } = await setup(fetchImpl);
    await expect(
      generation.execute({
        operation: "generate_sound_effect",
        category: "sound_effect",
        endpoint: "/v1/sound-generation",
        request: { text: "A short bell" },
        outputFilename: "bell.wav",
        query: { output_format: "mp3_44100_128" },
        authorization: auth,
      }),
    ).rejects.toThrow(/Filename extension must be/);
    await expect(
      generation.execute({
        operation: "generate_sound_effect",
        category: "sound_effect",
        endpoint: "/v1/sound-generation",
        request: { text: "A short bell" },
        outputFilename: "bell.pcm",
        query: { output_format: "pcm_16000" },
        authorization: auth,
      }),
    ).rejects.toThrow(/not supported by the local media store/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM generations").get()).toMatchObject({ count: 0 });
  });

  it("marks a server-side failure as unknown because billing may have happened", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "temporary outage" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { generation, db } = await setup(fetchImpl);
    await expect(
      generation.execute({
        operation: "generate_sound_effect",
        category: "sound_effect",
        endpoint: "/v1/sound-generation",
        request: { text: "A short bell" },
        outputFilename: "bell.mp3",
        query: { output_format: "mp3_44100_128" },
        authorization: auth,
      }),
    ).rejects.toThrow(/HTTP 500/);
    expect(db.prepare("SELECT status FROM generations").get()).toMatchObject({ status: "unknown" });
  });

  it("persists an asynchronous remote ID and reconciles its reservation after completion", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "remote-image-1", status: "pending" }), {
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { generation, db, budget } = await setup(fetchImpl);
    const result = await generation.execute({
      operation: "generate_image",
      category: "image",
      endpoint: "/v1/flows/image",
      modelId: "gpt-image-1",
      request: { model_id: "gpt-image-1", prompt: "A blue sky" },
      outputFilename: "unused.json",
      response: "json",
      asyncRemote: true,
      authorization: auth,
    });
    expect(result).toMatchObject({ status: "submitted", remote_id: "remote-image-1" });
    const localId = result.generation_id as string;
    expect(db.prepare("SELECT id FROM generations").get()).toMatchObject({ id: localId });
    expect(db.prepare("SELECT generation_id,status FROM remote_jobs").get()).toMatchObject({
      generation_id: localId,
      status: "submitted",
    });
    expect(budget.reconcileRemote("remote-image-1", "completed", "/tmp/image.png")).toBe(true);
    expect(db.prepare("SELECT state FROM credit_reservations").get()).toMatchObject({ state: "completed" });
  });

  it("validates a multipart upload and saves its JSON response locally", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "remote-asset", name: "foley" }), {
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const { generation, config } = await setup(fetchImpl);
    const inputPath = join(config.GENERATED_DIR, "input.mp3");
    await writeFile(inputPath, mp3);
    const result = await generation.execute({
      operation: "upload_asset",
      category: "remote_asset",
      endpoint: "/v1/assets",
      request: { name: "foley" },
      filePath: inputPath,
      fileField: "asset",
      outputFilename: "asset.json",
      response: "json",
      jsonSaveFilename: true,
      authorization: auth,
    });
    expect(result).toMatchObject({ success: true, status: "completed", summary: { id: "remote-asset" } });
    expect(JSON.parse(await readFile(join(config.GENERATED_DIR, "asset.json"), "utf8"))).toMatchObject({
      id: "remote-asset",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("extracts Base64 voice previews and removes audio bytes from returned metadata", async () => {
    const body = JSON.stringify({
      text: "Generated text",
      previews: [
        {
          audio_base_64: mp3.toString("base64"),
          generated_voice_id: "preview-1",
          media_type: "audio/mpeg",
          duration_secs: 1,
          language: "en",
        },
      ],
    });
    const fetchImpl = vi.fn(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const { generation, config } = await setup(fetchImpl);
    const result = await generation.execute({
      operation: "design_voice",
      category: "voice_preview",
      endpoint: "/v1/text-to-voice/design",
      request: { voice_description: "A warm, clear fictional narrator voice." },
      outputFilename: "voice.mp3",
      response: "json",
      jsonAudioArray: { arrayField: "previews", audioField: "audio_base_64", filenamePrefix: "voice" },
      authorization: auth,
    });
    expect(result).toMatchObject({ success: true, previews: [{ generated_voice_id: "preview-1" }] });
    expect(await readFile(join(config.GENERATED_DIR, "voice-1.mp3"))).toEqual(mp3);
    expect(await readFile(join(config.GENERATED_DIR, "voice-previews.json"), "utf8")).not.toContain("audio_base_64");
  });

  it("marks a malformed detailed response unknown after the remote request succeeded", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(Buffer.from("not multipart"), { headers: { "content-type": "multipart/mixed" } }),
    ) as unknown as typeof fetch;
    const { generation, db } = await setup(fetchImpl);
    await expect(
      generation.execute({
        operation: "generate_music_detailed",
        category: "music",
        endpoint: "/v1/music/detailed",
        request: { prompt: "quiet strings" },
        outputFilename: "track.mp3",
        response: "multipart_mixed",
        query: { output_format: "mp3_44100_128" },
        authorization: auth,
      }),
    ).rejects.toThrow(/boundary/);
    expect(db.prepare("SELECT status FROM generations").get()).toMatchObject({ status: "unknown" });
  });
});
