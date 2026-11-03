import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { parseFile } from "music-metadata";
import yauzl from "yauzl";
import type { AppConfig } from "../../config/env.js";
import { runProcess } from "../../adapters/ffmpeg.js";
import { AppError } from "../../utils/errors.js";
import { MediaManager } from "./media-manager.js";

export type ExportProfile = "godot_sfx" | "godot_music" | "godot_dialogue" | "godot_ambient" | "trailer_audio";

export class MediaService {
  constructor(
    private readonly config: AppConfig,
    private readonly media: MediaManager,
  ) {}

  async inspect(path: string): Promise<Record<string, unknown>> {
    const safePath = await this.media.resolveAllowed(path);
    const base = await this.media.inspect(safePath);
    const metadata = await parseFile(safePath)
      .then((parsed) => ({
        duration_seconds: parsed.format.duration ?? null,
        codec: parsed.format.codec ?? null,
        sample_rate: parsed.format.sampleRate ?? null,
        channels: parsed.format.numberOfChannels ?? null,
        bitrate: parsed.format.bitrate ?? null,
        container: parsed.format.container ?? null,
      }))
      .catch(() => null);
    let probe: unknown = null;
    try {
      probe = JSON.parse(
        (
          await runProcess(
            this.config.FFPROBE_PATH,
            ["-v", "error", "-show_format", "-show_streams", "-of", "json", safePath],
            30_000,
          )
        ).stdout,
      );
    } catch {
      /* FFprobe is optional for inspection output. */
    }
    return { ...base, music_metadata: metadata, ffprobe: probe };
  }

  async convert(
    input: string,
    filename: string,
    format: "wav" | "ogg" | "mp3" | "flac",
    overwrite = false,
    filters: string[] = [],
  ): Promise<Record<string, unknown>> {
    const source = await this.media.resolveAllowed(input);
    const finalPath = await this.generatedOutput(filename, format, overwrite);
    const temp = await this.tempOutput(finalPath, format);
    try {
      const args = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        source,
        ...(filters.length ? ["-af", filters.join(",")] : []),
        ...this.codecArgs(format),
        temp,
      ];
      await runProcess(this.config.FFMPEG_PATH, args);
      const bytes = await readFile(temp);
      const savedPath = await this.media.atomicWrite(finalPath, bytes, overwrite);
      return {
        success: true,
        operation: filters.length ? "process_audio" : "convert_audio",
        call_remote: false,
        path: savedPath,
        bytes: bytes.length,
        profile: format,
        source_path: source,
      };
    } finally {
      await rm(temp, { force: true });
    }
  }

  async normalize(
    input: string,
    filename: string,
    format: "wav" | "ogg" | "mp3" | "flac" = "wav",
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    return this.convert(input, filename, format, overwrite, ["loudnorm=I=-16:TP=-1.5:LRA=11"]);
  }

  async trim(
    input: string,
    filename: string,
    start: number,
    duration: number,
    format: "wav" | "ogg" | "mp3" | "flac" = "wav",
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    const source = await this.media.resolveAllowed(input);
    const finalPath = await this.generatedOutput(filename, format, overwrite);
    const temp = await this.tempOutput(finalPath, format);
    try {
      await runProcess(this.config.FFMPEG_PATH, [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-ss",
        String(start),
        "-i",
        source,
        "-t",
        String(duration),
        ...this.codecArgs(format),
        temp,
      ]);
      const bytes = await readFile(temp);
      return {
        success: true,
        operation: "trim_audio",
        call_remote: false,
        path: await this.media.atomicWrite(finalPath, bytes, overwrite),
        bytes: bytes.length,
      };
    } finally {
      await rm(temp, { force: true });
    }
  }

  async loop(
    input: string,
    filename: string,
    duration: number,
    format: "wav" | "ogg" | "mp3" = "ogg",
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    const source = await this.media.resolveAllowed(input);
    const finalPath = await this.generatedOutput(filename, format, overwrite);
    const temp = await this.tempOutput(finalPath, format);
    try {
      await runProcess(this.config.FFMPEG_PATH, [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-stream_loop",
        "-1",
        "-i",
        source,
        "-t",
        String(duration),
        ...this.codecArgs(format),
        temp,
      ]);
      const bytes = await readFile(temp);
      return {
        success: true,
        operation: "create_audio_loop",
        call_remote: false,
        path: await this.media.atomicWrite(finalPath, bytes, overwrite),
        bytes: bytes.length,
        note: "The file is repeated to the requested duration; this does not guarantee a seamless boundary.",
      };
    } finally {
      await rm(temp, { force: true });
    }
  }

  async split(input: string, segmentSeconds: number, prefix: string): Promise<Record<string, unknown>> {
    const source = await this.media.resolveAllowed(input);
    const cleanPrefix = prefix.replaceAll("\\", "/");
    if (!cleanPrefix || cleanPrefix.startsWith("/") || cleanPrefix.split("/").some((part) => part === ".."))
      throw new AppError("Output prefix must stay inside GENERATED_DIR", "invalid_filename");
    const tempDir = await mkdtemp(join(tmpdir(), "mcp-eleven-split-"));
    const tempPattern = join(tempDir, `${basename(prefix)}_%03d${extname(source)}`);
    try {
      await runProcess(this.config.FFMPEG_PATH, [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        source,
        "-f",
        "segment",
        "-segment_time",
        String(segmentSeconds),
        "-reset_timestamps",
        "1",
        tempPattern,
      ]);
      const files = (await readdir(tempDir)).sort();
      const outputs = [];
      for (const [index, name] of files.entries()) {
        const destinationName = `${prefix}_${String(index + 1).padStart(3, "0")}${extname(name)}`;
        const dest = join(this.config.GENERATED_DIR, destinationName);
        const bytes = await readFile(join(tempDir, name));
        outputs.push(await this.media.atomicWrite(dest, bytes));
      }
      return { success: true, operation: "split_audio", call_remote: false, files: outputs };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async merge(
    inputs: string[],
    filename: string,
    format: "wav" | "ogg" | "mp3" | "flac",
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    const sources = await Promise.all(inputs.map((path) => this.media.resolveAllowed(path)));
    const finalPath = await this.generatedOutput(filename, format, overwrite);
    const temp = await this.tempOutput(finalPath, format);
    try {
      const args = ["-hide_banner", "-nostdin", "-y"];
      for (const source of sources) args.push("-i", source);
      const inputsExpr = sources.map((_, index) => `[${index}:a]`).join("");
      args.push(
        "-filter_complex",
        `${inputsExpr}concat=n=${sources.length}:v=0:a=1[out]`,
        "-map",
        "[out]",
        ...this.codecArgs(format),
        temp,
      );
      await runProcess(this.config.FFMPEG_PATH, args);
      const bytes = await readFile(temp);
      return {
        success: true,
        operation: "merge_audio",
        call_remote: false,
        path: await this.media.atomicWrite(finalPath, bytes, overwrite),
        bytes: bytes.length,
      };
    } finally {
      await rm(temp, { force: true });
    }
  }

  async exportGodot(
    input: string,
    projectRoot: string,
    relativePath: string,
    profile: ExportProfile,
    overwrite = false,
  ): Promise<Record<string, unknown>> {
    const source = await this.media.resolveAllowed(input);
    const root = await this.media.resolveAllowed(projectRoot);
    const rel = relativePath.replaceAll("\\", "/");
    if (!rel || rel.startsWith("/") || rel.split("/").some((part) => part === ".."))
      throw new AppError("Godot export path must stay inside the project root", "invalid_export_path");
    const ext = (
      {
        godot_sfx: ".wav",
        godot_music: ".ogg",
        godot_dialogue: ".ogg",
        godot_ambient: ".ogg",
        trailer_audio: ".mp3",
      } as const
    )[profile];
    const destination = resolve(root, rel);
    const relFromRoot = relative(root, destination);
    if (relFromRoot.startsWith(`..${sep}`) || relFromRoot === "..")
      throw new AppError("Export path escapes the project root", "invalid_export_path");
    const sourceExt = extname(source).toLowerCase();
    const finalPath = sourceExt === ext ? destination : resolve(root, `${rel.replace(/\.[^.]+$/, "")}${ext}`);
    let bytes: Buffer;
    if (sourceExt === ext) bytes = await readFile(source);
    else {
      const temp = await this.tempOutput(finalPath, ext.slice(1));
      try {
        await runProcess(this.config.FFMPEG_PATH, [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-i",
          source,
          ...this.codecArgs(ext.slice(1) as "wav" | "ogg" | "mp3"),
          temp,
        ]);
        bytes = await readFile(temp);
      } finally {
        await rm(temp, { force: true });
      }
    }
    const output = await this.media.atomicWrite(finalPath, bytes, overwrite);
    const metadata = await parseFile(output)
      .then((parsed) => ({
        duration_seconds: parsed.format.duration ?? null,
        codec: parsed.format.codec ?? null,
        sample_rate: parsed.format.sampleRate ?? null,
      }))
      .catch(() => ({}));
    const manifestPath = resolve(root, ".mcp-generation", "assets.json");
    const current = await readFile(manifestPath, "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .then((value) => (Array.isArray(value) ? value : []))
      .catch(() => [] as unknown[]);
    const entry = {
      asset_id: randomUUID(),
      relative_path: relative(root, output).split(sep).join("/"),
      profile,
      sha256: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      created_at: new Date().toISOString(),
      ...metadata,
    };
    await this.media.atomicWrite(manifestPath, Buffer.from(JSON.stringify([...current, entry], null, 2)), true);
    return {
      success: true,
      operation: "export_to_godot",
      call_remote: false,
      file: output,
      manifest: manifestPath,
      asset: entry,
    };
  }

  async extractStems(zipPath: string, prefix: string): Promise<Record<string, unknown>> {
    const safeZip = await this.media.resolveAllowed(zipPath);
    const info = await stat(safeZip);
    if (info.size > this.config.MAX_MEDIA_BYTES)
      throw new AppError("Stem archive exceeds MAX_MEDIA_BYTES", "media_too_large");
    const cleanPrefix = prefix.replaceAll("\\", "/");
    if (!cleanPrefix || cleanPrefix.startsWith("/") || cleanPrefix.split("/").some((part) => part === ".."))
      throw new AppError("Stem prefix must stay inside GENERATED_DIR", "invalid_filename");
    const extracted: Array<{ path: string; sha256: string; bytes: number }> = [];
    const maxExpanded = 500 * 1024 * 1024;
    let expanded = 0;
    try {
      await new Promise<void>((resolveZip, rejectZip) => {
        yauzl.open(safeZip, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (openError, zip) => {
          if (openError || !zip) {
            rejectZip(openError ?? new Error("Unable to read zip archive"));
            return;
          }
          let entryCount = 0;
          zip.on("error", rejectZip);
          zip.on("end", () => {
            zip.close();
            resolveZip();
          });
          zip.on("entry", (entry) => {
            entryCount += 1;
            const name = String(entry.fileName).replaceAll("\\", "/");
            const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (
              entryCount > 50 ||
              name.startsWith("/") ||
              name.split("/").some((part) => part === "..") ||
              unixMode === 0o120000
            ) {
              zip.close();
              rejectZip(new AppError("Archive contains too many entries or an unsafe path", "unsafe_zip_entry"));
              return;
            }
            if (name.endsWith("/")) {
              zip.readEntry();
              return;
            }
            const ext = extname(name).toLowerCase();
            if (![".wav", ".mp3", ".ogg", ".flac", ".m4a"].includes(ext)) {
              zip.close();
              rejectZip(new AppError(`Archive contains a non-audio stem: ${basename(name)}`, "unexpected_zip_content"));
              return;
            }
            if (
              entry.uncompressedSize > this.config.MAX_MEDIA_BYTES ||
              expanded + entry.uncompressedSize > maxExpanded
            ) {
              zip.close();
              rejectZip(new AppError("Expanded stem archive exceeds the configured limit", "zip_expansion_limit"));
              return;
            }
            zip.openReadStream(entry, (streamError, stream) => {
              if (streamError || !stream) {
                zip.close();
                rejectZip(streamError ?? new Error("Unable to read stem"));
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              stream.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > this.config.MAX_MEDIA_BYTES || expanded + size > maxExpanded) {
                  stream.destroy(
                    new AppError("Expanded stem archive exceeds the configured limit", "zip_expansion_limit"),
                  );
                  return;
                }
                chunks.push(Buffer.from(chunk));
              });
              stream.on("error", (error) => {
                zip.close();
                rejectZip(error);
              });
              stream.on("end", async () => {
                try {
                  const bytes = Buffer.concat(chunks);
                  expanded += bytes.length;
                  const outName = `stems/${cleanPrefix}/${String(extracted.length + 1).padStart(2, "0")}-${basename(name)}`;
                  const saved = await this.media.save(bytes, outName, "music_stem", {
                    archive: safeZip,
                    original_name: name,
                  });
                  extracted.push({ path: saved.path, sha256: saved.sha256, bytes: saved.bytes });
                  zip.readEntry();
                } catch (error) {
                  zip.close();
                  rejectZip(error);
                }
              });
            });
          });
          zip.readEntry();
        });
      });
    } catch (error) {
      for (const item of extracted) await this.media.removeAsset(item.path).catch(() => undefined);
      throw error;
    }
    return {
      success: true,
      operation: "extract_music_stems",
      call_remote: false,
      source_zip: safeZip,
      stems: extracted,
    };
  }

  private async generatedOutput(filename: string, format: string, overwrite: boolean): Promise<string> {
    const name = filename.replaceAll("\\", "/");
    if (name.startsWith("/") || name.split("/").includes(".."))
      throw new AppError("Output name must be relative to GENERATED_DIR", "invalid_filename");
    const withExt = extname(name) ? name : `${name}.${format}`;
    if (extname(withExt).toLowerCase() !== `.${format}`)
      throw new AppError("Filename extension must match the selected output format", "format_extension_mismatch");
    const path = resolve(this.config.GENERATED_DIR, withExt);
    await this.media.prepareOutputPath(path);
    if (!overwrite) await this.assertAbsent(path);
    return path;
  }

  private async tempOutput(finalPath: string, format: string): Promise<string> {
    const path = resolve(dirnameSafe(finalPath), `.mcp-${randomUUID()}.${format}`);
    await this.media.prepareOutputPath(path);
    return path;
  }

  private async assertAbsent(path: string): Promise<void> {
    if (
      await stat(path)
        .then(() => true)
        .catch(() => false)
    )
      throw new AppError("Output exists; set overwrite=true to replace it", "file_exists");
  }

  private codecArgs(format: string): string[] {
    if (format === "wav") return ["-c:a", "pcm_s16le", "-f", "wav"];
    if (format === "ogg") return ["-c:a", "libvorbis", "-q:a", "5", "-f", "ogg"];
    if (format === "mp3") return ["-c:a", "libmp3lame", "-q:a", "2", "-f", "mp3"];
    if (format === "flac") return ["-c:a", "flac", "-f", "flac"];
    throw new AppError(`Unsupported audio export format: ${format}`, "unsupported_audio_format");
  }
}

function dirnameSafe(path: string): string {
  return resolve(path, "..");
}
