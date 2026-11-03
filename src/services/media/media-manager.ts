import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";

export interface SavedMedia {
  assetId: string;
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
}

const MIME_BY_EXT: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".zip": "application/zip",
};

export class MediaManager {
  readonly roots: string[];

  constructor(
    private readonly config: AppConfig,
    private readonly db: Database.Database,
  ) {
    this.roots = [config.GENERATED_DIR, ...config.ALLOWED_ROOTS].map((root) => resolve(root));
  }

  async initialize(): Promise<void> {
    await mkdir(this.config.GENERATED_DIR, { recursive: true });
    await mkdir(dirname(this.config.DATABASE_PATH), { recursive: true });
  }

  async resolveAllowed(inputPath: string): Promise<string> {
    const path = resolve(inputPath);
    if (!this.isWithinAnyRoot(path))
      throw new AppError("The requested path is outside ALLOWED_ROOTS and GENERATED_DIR", "path_not_allowed");
    const canonical = await realpath(path).catch(async () => {
      const parent = await realpath(dirname(path)).catch(() => null);
      if (!parent) throw new AppError("The path parent does not exist", "path_parent_missing");
      const target = resolve(parent, basename(path));
      if (!this.isWithinAnyRoot(target))
        throw new AppError("The resolved path is outside allowed roots", "path_not_allowed");
      return target;
    });
    if (!this.isWithinAnyRoot(canonical))
      throw new AppError("Symlink resolution escapes allowed roots", "path_not_allowed");
    return canonical;
  }

  async save(
    bytes: Uint8Array,
    filename: string,
    category: string,
    metadata: Record<string, unknown> = {},
    overwrite = false,
  ): Promise<SavedMedia> {
    if (bytes.byteLength === 0 || bytes.byteLength > this.config.MAX_MEDIA_BYTES)
      throw new AppError("Media is empty or exceeds MAX_MEDIA_BYTES", "invalid_media_size");
    const safeName = this.safeFilename(filename);
    const destination = await this.prepareOutput(resolve(this.config.GENERATED_DIR, safeName));
    if (!overwrite) {
      try {
        await stat(destination);
        throw new AppError("Output exists; set overwrite=true to replace it", "file_exists");
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
    }
    const mimeType = MIME_BY_EXT[extname(destination).toLowerCase()] ?? "application/octet-stream";
    if (mimeType === "application/octet-stream")
      throw new AppError("Output extension is not a supported media type", "unsupported_media_extension");
    this.validateMagic(bytes, mimeType);
    const temp = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, destination);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const assetId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO media_assets(id,category,path,sha256,mime_type,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET category=excluded.category,sha256=excluded.sha256,mime_type=excluded.mime_type,metadata_json=excluded.metadata_json,created_at=excluded.created_at`,
      )
      .run(assetId, category, destination, sha256, mimeType, JSON.stringify(metadata), new Date().toISOString());
    const stored = this.db.prepare("SELECT id FROM media_assets WHERE path=?").get(destination) as { id: string };
    return { assetId: stored.id, path: destination, sha256, bytes: bytes.byteLength, mimeType };
  }

  async preflightSave(filename: string, overwrite = false): Promise<string> {
    const path = await this.prepareOutput(resolve(this.config.GENERATED_DIR, this.safeFilename(filename)));
    if (!MIME_BY_EXT[extname(path).toLowerCase()])
      throw new AppError("Output extension is not a supported media type", "unsupported_media_extension");
    if (
      !overwrite &&
      (await stat(path)
        .then(() => true)
        .catch(() => false))
    )
      throw new AppError("Output exists; choose another filename", "file_exists");
    return path;
  }

  async atomicWrite(destinationPath: string, bytes: Uint8Array, overwrite = false): Promise<string> {
    if (bytes.byteLength > this.config.MAX_MEDIA_BYTES)
      throw new AppError("Output exceeds MAX_MEDIA_BYTES", "media_too_large");
    const destination = await this.prepareOutput(resolve(destinationPath));
    if (!overwrite) {
      try {
        await stat(destination);
        throw new AppError("Output exists; set overwrite=true to replace it", "file_exists");
      } catch (error) {
        if (error instanceof AppError) throw error;
      }
    }
    const temp = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, destination);
    return destination;
  }

  async prepareOutputPath(destinationPath: string): Promise<string> {
    return this.prepareOutput(resolve(destinationPath));
  }

  async inspect(inputPath: string): Promise<Record<string, unknown>> {
    const path = await this.resolveAllowed(inputPath);
    const file = await readFile(path);
    const info = await stat(path);
    return {
      path,
      size_bytes: info.size,
      sha256: createHash("sha256").update(file).digest("hex"),
      extension: extname(path).slice(1).toLowerCase(),
      mime_type: MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream",
      signature_valid: this.magicMatches(file),
    };
  }

  listAssets(): unknown[] {
    return this.db
      .prepare(
        "SELECT id AS asset_id, category, path, sha256, mime_type, created_at FROM media_assets ORDER BY created_at DESC",
      )
      .all();
  }

  async removeAsset(path: string): Promise<void> {
    const safePath = await this.resolveAllowed(path);
    await (await import("node:fs/promises")).rm(safePath, { force: true });
    this.db.prepare("DELETE FROM media_assets WHERE path=?").run(safePath);
  }

  private safeFilename(name: string): string {
    const normalized = name.replaceAll("\\", "/");
    if (
      !normalized ||
      isAbsolute(name) ||
      normalized.split("/").some((part) => part === "..") ||
      normalized.includes("\0")
    ) {
      throw new AppError("Filename must be a relative path without parent traversal", "invalid_filename");
    }
    const output = resolve(this.config.GENERATED_DIR, normalized);
    const rel = relative(resolve(this.config.GENERATED_DIR), output);
    if (rel.startsWith(`..${sep}`) || rel === "..")
      throw new AppError("Filename escapes GENERATED_DIR", "invalid_filename");
    return rel;
  }

  private async prepareOutput(destination: string): Promise<string> {
    const root = this.roots.find((candidate) => {
      const rel = relative(candidate, destination);
      return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
    });
    if (!root) throw new AppError("The output path is outside authorized roots", "path_not_allowed");
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink())
      throw new AppError("Authorized output roots cannot be symlinks", "path_not_allowed");
    const rootReal = await realpath(root);
    const rel = relative(root, destination);
    const components = rel.split(sep).filter(Boolean);
    let current = root;
    for (const component of components.slice(0, -1)) {
      current = resolve(current, component);
      await mkdir(current, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new AppError("Output paths cannot traverse symlinks or non-directories", "path_not_allowed");
      const canonical = await realpath(current);
      if (!this.isChild(rootReal, canonical))
        throw new AppError("Output directory escaped its authorized root", "path_not_allowed");
    }
    const finalInfo = await lstat(destination).catch(() => null);
    if (finalInfo?.isSymbolicLink()) throw new AppError("Output file cannot be a symlink", "path_not_allowed");
    return destination;
  }

  private isChild(root: string, path: string): boolean {
    const rel = relative(root, path);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
  }

  private isWithinAnyRoot(path: string): boolean {
    return this.roots.some((root) => {
      const rel = relative(root, path);
      return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
    });
  }

  private magicMatches(bytes: Uint8Array): boolean {
    return (
      (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) ||
      (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) ||
      (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
      (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) ||
      Buffer.from(bytes).subarray(0, 4).toString("ascii") === "fLaC" ||
      (bytes.length >= 8 && Buffer.from(bytes).subarray(4, 8).toString("ascii") === "ftyp") ||
      (bytes.length >= 4 && Buffer.from(bytes).subarray(0, 4).toString("hex") === "1a45dfa3")
    );
  }

  private validateMagic(bytes: Uint8Array, mime: string): void {
    if (mime === "application/zip" && Buffer.from(bytes).subarray(0, 4).toString("hex") !== "504b0304")
      throw new AppError("Invalid ZIP signature", "invalid_media_signature");
    if (mime.startsWith("audio/") && !this.magicMatches(bytes))
      throw new AppError("Audio output signature does not match a supported media file", "invalid_audio_signature");
    if (mime === "audio/wav" && Buffer.from(bytes).subarray(8, 12).toString("ascii") !== "WAVE")
      throw new AppError("Invalid WAV signature", "invalid_audio_signature");
    if (mime === "image/png" && Buffer.from(bytes).subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      throw new AppError("Invalid PNG signature", "invalid_media_signature");
    if (mime === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8))
      throw new AppError("Invalid JPEG signature", "invalid_media_signature");
    if (
      mime === "image/webp" &&
      !(
        Buffer.from(bytes).subarray(0, 4).toString("ascii") === "RIFF" &&
        Buffer.from(bytes).subarray(8, 12).toString("ascii") === "WEBP"
      )
    )
      throw new AppError("Invalid WebP signature", "invalid_media_signature");
    if (mime === "video/mp4" && !this.magicMatches(bytes))
      throw new AppError("Invalid MP4 signature", "invalid_media_signature");
    if (mime === "video/webm" && Buffer.from(bytes).subarray(0, 4).toString("hex") !== "1a45dfa3")
      throw new AppError("Invalid WebM signature", "invalid_media_signature");
  }
}
