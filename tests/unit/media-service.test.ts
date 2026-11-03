import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runProcess: vi.fn() }));
vi.mock("../../src/adapters/ffmpeg.js", () => ({ runProcess: mocks.runProcess }));

import { loadConfig } from "../../src/config/env.js";
import { openDatabase } from "../../src/db/database.js";
import { MediaManager } from "../../src/services/media/media-manager.js";
import { MediaService } from "../../src/services/media/media-service.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  mocks.runProcess.mockReset();
});

describe("MediaService", () => {
  it("uses the safe FFmpeg wrapper for local conversions and Godot export", async () => {
    const root = await mkdtemp(join(tmpdir(), "eleven-mcp-media-service-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const config = loadConfig({
      GENERATED_DIR: join(root, "generated"),
      DATABASE_PATH: join(root, "data.sqlite"),
      ALLOWED_ROOTS: root,
      MAX_MEDIA_BYTES: "4096",
    });
    const db = openDatabase(":memory:");
    cleanups.push(async () => db.close());
    const media = new MediaManager(config, db);
    await media.initialize();
    const service = new MediaService(config, media);
    const source = join(config.GENERATED_DIR, "source.mp3");
    await writeFile(source, Buffer.from("source"));
    mocks.runProcess.mockImplementation(async (_binary: string, args: string[]) => {
      const output = args.at(-1) ?? "";
      if (args.includes("-show_format")) return { stdout: "{}", stderr: "" };
      if (output.includes("%03d")) await writeFile(output.replace("%03d", "001"), Buffer.from("segment"));
      else await writeFile(output, Buffer.from("encoded"));
      return { stdout: "", stderr: "" };
    });

    expect(await service.inspect(source)).toMatchObject({ path: source, size_bytes: 6 });
    expect(await service.convert(source, "converted.wav", "wav")).toMatchObject({
      operation: "convert_audio",
      call_remote: false,
    });
    expect(await service.normalize(source, "normalized.wav")).toMatchObject({ operation: "process_audio" });
    expect(await service.trim(source, "trimmed.wav", 0.5, 2)).toMatchObject({ operation: "trim_audio" });
    expect(await service.loop(source, "loop.ogg", 4)).toMatchObject({ operation: "create_audio_loop" });
    expect(await service.split(source, 2, "parts/speech")).toMatchObject({
      operation: "split_audio",
      files: [expect.stringContaining("speech_001.mp3")],
    });
    expect(await service.merge([source, source], "merged.wav", "wav")).toMatchObject({ operation: "merge_audio" });

    const project = join(root, "godot-project");
    await (await import("node:fs/promises")).mkdir(project, { recursive: true });
    expect(await service.exportGodot(source, project, "audio/music.ogg", "godot_music")).toMatchObject({
      operation: "export_to_godot",
      asset: { profile: "godot_music" },
    });
    expect(mocks.runProcess).toHaveBeenCalled();
    await expect(service.exportGodot(source, project, "../outside.ogg", "godot_music")).rejects.toThrow(
      /inside the project root/,
    );
  });

  it("rejects unsafe stem output prefixes before opening an archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "eleven-mcp-stems-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const config = loadConfig({
      GENERATED_DIR: join(root, "generated"),
      DATABASE_PATH: join(root, "data.sqlite"),
      MAX_MEDIA_BYTES: "1024",
    });
    const db = openDatabase(":memory:");
    cleanups.push(async () => db.close());
    const media = new MediaManager(config, db);
    await media.initialize();
    const zip = join(config.GENERATED_DIR, "stems.zip");
    await writeFile(zip, Buffer.from("PK\u0003\u0004"));
    const service = new MediaService(config, media);
    await expect(service.extractStems(zip, "../escape")).rejects.toThrow(/inside GENERATED_DIR/);
  });
});
