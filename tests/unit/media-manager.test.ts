import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";
import { openDatabase } from "../../src/db/database.js";
import { MediaManager } from "../../src/services/media/media-manager.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("MediaManager", () => {
  it("rejects paths outside authorized roots and validates media signatures", async () => {
    const root = await mkdtemp(join(tmpdir(), "eleven-mcp-media-"));
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
    await expect(media.resolveAllowed("/etc/passwd")).rejects.toThrow(/outside ALLOWED_ROOTS/);
    await expect(media.save(Buffer.from("not audio"), "bad.mp3", "test")).rejects.toThrow(/signature/);
    const asset = await media.save(Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000"), "good.mp3", "test");
    expect(asset.path).toContain("generated");
    expect(media.listAssets()).toHaveLength(1);
    expect(await media.inspect(asset.path)).toMatchObject({ signature_valid: true, mime_type: "audio/mpeg" });
    await expect(media.save(Buffer.from("data"), "../escape.mp3", "test")).rejects.toThrow(/Filename/);
    await expect(media.save(Buffer.from("data"), "unknown.bin", "test")).rejects.toThrow(/extension/);
    await expect(media.preflightSave("good.mp3")).rejects.toThrow(/exists/);
    const written = await media.atomicWrite(join(config.GENERATED_DIR, "folder", "note.json"), Buffer.from("{}"));
    await expect(media.atomicWrite(written, Buffer.from("new"))).rejects.toThrow(/exists/);
    expect(await media.resolveAllowed(written)).toBe(written);
    await media.removeAsset(asset.path);
    expect(media.listAssets()).toHaveLength(0);
    const link = join(config.GENERATED_DIR, "escape-link");
    await symlink("/etc/passwd", link);
    await expect(media.resolveAllowed(link)).rejects.toThrow(/Symlink resolution escapes/);
  });
});
