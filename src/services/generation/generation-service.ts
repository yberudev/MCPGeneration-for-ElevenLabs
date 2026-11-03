import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type Database from "better-sqlite3";
import type { AppConfig } from "../../config/env.js";
import { ElevenLabsHttp } from "../../adapters/elevenlabs-http.js";
import { BudgetManager, type Authorization } from "../budget/budget-manager.js";
import { MediaManager, type SavedMedia } from "../media/media-manager.js";
import { AppError, classifyRemoteError } from "../../utils/errors.js";

export interface GenerationInput {
  operation: string;
  category: string;
  endpoint: string;
  modelId?: string;
  request: unknown;
  outputFilename: string;
  authorization?: Authorization;
  documentedFree?: boolean;
  query?: Record<string, string | number | boolean | undefined>;
  filePath?: string;
  filePaths?: string[];
  fileField?: string;
  method?: "POST" | "GET";
  response?: "binary" | "json" | "multipart_mixed";
  responseFilename?: string;
  asyncRemote?: boolean;
  jsonAudioField?: string;
  jsonAudioArray?: { arrayField: string; audioField: string; filenamePrefix: string };
  jsonSaveFilename?: boolean;
  expectedExtension?: string;
}

export class GenerationService {
  constructor(
    private readonly http: ElevenLabsHttp,
    private readonly budget: BudgetManager,
    private readonly media: MediaManager,
    private readonly db: Database.Database,
    private readonly config: AppConfig,
  ) {}

  async execute(input: GenerationInput): Promise<Record<string, unknown>> {
    if (input.request === null || typeof input.request !== "object")
      throw new AppError("Request body must be an object", "invalid_request");
    const resolvedFiles = await Promise.all(
      (input.filePaths ?? (input.filePath ? [input.filePath] : [])).map((path) => this.media.resolveAllowed(path)),
    );
    const fileHashes = await Promise.all(
      resolvedFiles.map(async (path) =>
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ),
    );
    const normalized = stableStringify({ request: input.request, query: input.query ?? {}, files: fileHashes });
    const requestHash = createHash("sha256")
      .update(`${input.endpoint}\n${input.modelId ?? ""}\n${normalized}`)
      .digest("hex");
    const form = resolvedFiles.length
      ? await this.http.filesForm(input.request as Record<string, unknown>, resolvedFiles, input.fileField ?? "file")
      : undefined;
    this.http.validateRequest(input.method ?? "POST", input.endpoint, input.request, input.query ?? {}, form);
    if (!input.asyncRemote) {
      const mediaOutput =
        input.jsonAudioField ||
        input.jsonAudioArray ||
        input.response === "multipart_mixed" ||
        (input.response ?? "binary") === "binary";
      const mediaFilename = input.responseFilename ?? input.outputFilename;
      if (mediaOutput) {
        const requestedFormat = input.query?.output_format;
        const expectedExtension =
          input.expectedExtension ??
          (typeof requestedFormat === "string" ? extensionForOutputFormat(requestedFormat) : undefined);
        if (typeof requestedFormat === "string" && !expectedExtension)
          throw new AppError(
            "This output format is not supported by the local media store",
            "unsupported_output_format",
          );
        if (expectedExtension && extname(mediaFilename).toLowerCase() !== expectedExtension)
          throw new AppError(
            `Filename extension must be ${expectedExtension} for the selected output format`,
            "format_extension_mismatch",
          );
        await this.media.preflightSave(mediaFilename);
      } else if (input.jsonSaveFilename) await this.media.preflightSave(input.outputFilename);
      if (input.jsonAudioField) await this.media.preflightSave(input.outputFilename.replace(/\.[^.]+$/, ".json"));
      if (input.response === "multipart_mixed")
        await this.media.preflightSave(input.outputFilename.replace(/\.[^.]+$/, ".json"));
      if (input.jsonAudioArray) {
        for (let index = 1; index <= 3; index += 1)
          await this.media.preflightSave(`${input.jsonAudioArray.filenamePrefix.replace(/\.[^.]+$/, "")}-${index}.mp3`);
        await this.media.preflightSave(`${input.jsonAudioArray.filenamePrefix.replace(/\.[^.]+$/, "")}-previews.json`);
      }
    }
    const generationId = randomUUID();
    const reservation = this.budget.reserve({
      generationId,
      category: input.category,
      endpoint: input.endpoint,
      modelId: input.modelId,
      requestHash,
      estimatedCredits: input.documentedFree ? 0 : null,
      documentedFree: input.documentedFree,
      authorization: input.authorization,
    });
    let submitted = false;
    let responseReceived = false;
    try {
      let result;
      if (form) {
        submitted = true;
        result =
          input.response === "json"
            ? await this.http.json("POST", input.endpoint, { form, query: input.query })
            : await this.http.binary("POST", input.endpoint, { form, query: input.query });
      } else {
        submitted = true;
        result =
          input.response === "json"
            ? await this.http.json(input.method ?? "POST", input.endpoint, { body: input.request, query: input.query })
            : await this.http.binary(input.method ?? "POST", input.endpoint, {
                body: input.request,
                query: input.query,
              });
      }
      responseReceived = true;
      const remote = "data" in result ? result : null;
      const remoteId =
        remote && typeof remote.data === "object" && remote.data !== null
          ? String(
              (remote.data as Record<string, unknown>).generation_id ??
                (remote.data as Record<string, unknown>).transcription_id ??
                (remote.data as Record<string, unknown>).project_id ??
                (remote.data as Record<string, unknown>).song_id ??
                (remote.data as Record<string, unknown>).asset_id ??
                (remote.data as Record<string, unknown>).id ??
                "",
            ) || null
          : null;
      this.budget.markSubmitted(reservation, remoteId);
      if (input.response === "json") {
        const body = remote?.data;
        if (input.jsonAudioField && typeof body === "object" && body !== null) {
          const resultObject = body as Record<string, unknown>;
          const encoded = resultObject[input.jsonAudioField];
          if (typeof encoded !== "string")
            throw new AppError(`Expected ${input.jsonAudioField} in the documented response`, "missing_audio_payload");
          const audio = Buffer.from(encoded, "base64");
          const audioName = input.outputFilename;
          const savedAudio = await this.media.save(audio, audioName, input.category, {
            operation: input.operation,
            model_id: input.modelId ?? null,
            generation_id: generationId,
          });
          const metadata = { ...resultObject };
          delete metadata[input.jsonAudioField];
          const sidecarName = audioName.replace(/\.[^.]+$/, ".json");
          const savedMetadata = await this.media.save(
            Buffer.from(JSON.stringify(metadata, null, 2)),
            sidecarName,
            `${input.category}_metadata`,
            { operation: input.operation, generation_id: generationId },
          );
          this.budget.complete(reservation, savedAudio.path, remote?.usageHeader ?? null);
          this.recordAsset(input, savedAudio, generationId);
          return {
            success: true,
            operation: input.operation,
            asset_id: savedAudio.assetId,
            generation_id: generationId,
            status: "completed",
            call_remote: true,
            files: [
              { path: savedAudio.path, mime_type: savedAudio.mimeType, sha256: savedAudio.sha256 },
              { path: savedMetadata.path, mime_type: savedMetadata.mimeType, sha256: savedMetadata.sha256 },
            ],
            timing_metadata: metadata,
            billing: this.billing(reservation.policy, remote?.usageHeader ?? null),
            request_id: remote?.requestId ?? null,
          };
        }
        if (input.jsonAudioArray && typeof body === "object" && body !== null) {
          const resultObject = body as Record<string, unknown>;
          const previews = resultObject[input.jsonAudioArray.arrayField];
          if (!Array.isArray(previews))
            throw new AppError(
              `Expected ${input.jsonAudioArray.arrayField} in the documented response`,
              "missing_audio_payload",
            );
          const files = [];
          const safePreviews = [];
          for (const [index, entry] of previews.entries()) {
            if (
              typeof entry !== "object" ||
              entry === null ||
              typeof (entry as Record<string, unknown>)[input.jsonAudioArray.audioField] !== "string"
            )
              throw new AppError("Voice preview did not include base64 audio", "missing_audio_payload");
            const preview = entry as Record<string, unknown>;
            const bytes = Buffer.from(String(preview[input.jsonAudioArray.audioField]), "base64");
            const filename = `${input.jsonAudioArray.filenamePrefix.replace(/\.[^.]+$/, "")}-${index + 1}.mp3`;
            const saved = await this.media.save(bytes, filename, input.category, {
              operation: input.operation,
              preview_index: index + 1,
              generated_voice_id: preview.generated_voice_id ?? null,
            });
            files.push({ path: saved.path, mime_type: saved.mimeType, sha256: saved.sha256 });
            const safe = { ...preview };
            delete safe[input.jsonAudioArray.audioField];
            safePreviews.push(safe);
          }
          const metadataName = `${input.jsonAudioArray.filenamePrefix.replace(/\.[^.]+$/, "")}-previews.json`;
          const savedMetadata = await this.media.save(
            Buffer.from(JSON.stringify({ ...resultObject, [input.jsonAudioArray.arrayField]: safePreviews }, null, 2)),
            metadataName,
            `${input.category}_metadata`,
            { operation: input.operation, generation_id: generationId },
          );
          files.push({ path: savedMetadata.path, mime_type: savedMetadata.mimeType, sha256: savedMetadata.sha256 });
          this.budget.complete(reservation, files[0]?.path ?? null, remote?.usageHeader ?? null);
          return {
            success: true,
            operation: input.operation,
            generation_id: generationId,
            status: "completed",
            call_remote: true,
            previews: safePreviews,
            files,
            billing: this.billing(reservation.policy, remote?.usageHeader ?? null),
            request_id: remote?.requestId ?? null,
          };
        }
        if (input.asyncRemote) {
          if (remoteId)
            this.db
              .prepare(
                "INSERT OR REPLACE INTO remote_jobs(id,generation_id,remote_id,status,resource_type,updated_at) VALUES(?,?,?,'submitted',?,?)",
              )
              .run(remoteId, generationId, remoteId, input.category, new Date().toISOString());
          this.db
            .prepare("UPDATE generations SET status='submitted',remote_id=?,updated_at=? WHERE id=?")
            .run(remoteId, new Date().toISOString(), generationId);
          if (remoteId)
            this.budget.reconcileRemote(remoteId, (remote?.data as Record<string, unknown> | undefined)?.status);
          return {
            success: true,
            operation: input.operation,
            generation_id: generationId,
            remote_id: remoteId,
            status: "submitted",
            call_remote: true,
            billing: this.billing(reservation.policy, remote?.usageHeader ?? null),
            result: remote?.data,
          };
        }
        if (input.jsonSaveFilename) {
          const saved = await this.media.save(
            Buffer.from(JSON.stringify(body, null, 2)),
            input.outputFilename,
            `${input.category}_json`,
            { operation: input.operation, generation_id: generationId, remote_id: remoteId },
          );
          this.budget.complete(reservation, saved.path, remote?.usageHeader ?? null);
          return {
            success: true,
            operation: input.operation,
            asset_id: saved.assetId,
            generation_id: generationId,
            remote_id: remoteId,
            status: "completed",
            call_remote: true,
            file: { path: saved.path, mime_type: saved.mimeType, sha256: saved.sha256, bytes: saved.bytes },
            summary: summarizeJson(body),
            billing: this.billing(reservation.policy, remote?.usageHeader ?? null),
            request_id: remote?.requestId ?? null,
          };
        }
        this.budget.complete(reservation, null, remote?.usageHeader ?? null);
        return {
          success: true,
          operation: input.operation,
          generation_id: generationId,
          remote_id: remoteId,
          status: "completed",
          call_remote: true,
          billing: this.billing(reservation.policy, remote?.usageHeader ?? null),
          result: remote?.data,
        };
      }
      const binary = result as {
        data: Buffer;
        usageHeader: string | null;
        requestId: string | null;
        contentType: string | null;
      };
      if (input.response === "multipart_mixed") {
        const parts = parseMultipartMixed(binary.data, binary.contentType);
        const audio = parts.find((part) => part.contentType.startsWith("audio/"));
        const json = parts.find((part) => part.contentType.includes("json"));
        if (!audio || !json)
          throw new AppError(
            "Detailed music response did not contain both documented JSON metadata and audio parts",
            "invalid_multipart_response",
          );
        const metadata = JSON.parse(json.data.toString("utf8")) as unknown;
        const audioFile = await this.media.save(audio.data, input.outputFilename, input.category, {
          operation: input.operation,
          model_id: input.modelId ?? null,
          generation_id: generationId,
        });
        const metadataFile = await this.media.save(
          Buffer.from(JSON.stringify(metadata, null, 2)),
          input.outputFilename.replace(/\.[^.]+$/, ".json"),
          `${input.category}_metadata`,
          { operation: input.operation, generation_id: generationId },
        );
        this.budget.complete(reservation, audioFile.path, binary.usageHeader);
        return {
          success: true,
          operation: input.operation,
          asset_id: audioFile.assetId,
          generation_id: generationId,
          status: "completed",
          call_remote: true,
          files: [audioFile, metadataFile].map((file) => ({
            path: file.path,
            mime_type: file.mimeType,
            bytes: file.bytes,
            sha256: file.sha256,
          })),
          billing: this.billing(reservation.policy, binary.usageHeader),
          request_id: binary.requestId,
        };
      }
      const filename = input.responseFilename ?? input.outputFilename;
      const saved = await this.media.save(binary.data, filename, input.category, {
        operation: input.operation,
        model_id: input.modelId ?? null,
        request_hash: requestHash,
        remote_id: remoteId,
      });
      this.budget.complete(reservation, saved.path, binary.usageHeader);
      this.recordAsset(input, saved, generationId);
      return {
        success: true,
        operation: input.operation,
        asset_id: saved.assetId,
        generation_id: generationId,
        status: "completed",
        call_remote: true,
        files: [{ path: saved.path, mime_type: saved.mimeType, bytes: saved.bytes, sha256: saved.sha256 }],
        billing: this.billing(reservation.policy, binary.usageHeader),
        request_id: binary.requestId,
      };
    } catch (error) {
      const code = error instanceof AppError ? error.code : "unexpected_error";
      const status = error instanceof AppError ? error.status : undefined;
      const outcomeUnknown =
        responseReceived ||
        (error instanceof AppError &&
          (error.code === "remote_request_unknown" ||
            error.code === "invalid_remote_json" ||
            (submitted && (status === undefined || status >= 500)) ||
            classifyRemoteError(error) === "remote_server_error"));
      this.budget.fail(reservation, outcomeUnknown ? "unknown" : "failed", code);
      throw error;
    }
  }

  private billing(policy: string, usageHeader: string | null): Record<string, unknown> {
    return {
      estimated_credits: policy === "documented_free" ? 0 : null,
      actual_credits: null,
      character_cost_header: usageHeader,
      status: policy === "documented_free" ? "documented_free_endpoint" : "unknown",
    };
  }

  private recordAsset(input: GenerationInput, saved: SavedMedia, generationId: string): void {
    const metadata = JSON.stringify({
      operation: input.operation,
      generation_id: generationId,
      model_id: input.modelId ?? null,
    });
    this.db.prepare("UPDATE media_assets SET metadata_json=? WHERE id=?").run(metadata, saved.assetId);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseMultipartMixed(bytes: Buffer, contentType: string | null): Array<{ contentType: string; data: Buffer }> {
  const boundaryMatch = contentType?.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary || boundary.length > 200)
    throw new AppError("Detailed music response has no valid multipart boundary", "invalid_multipart_response");
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Array<{ contentType: string; data: Buffer }> = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const start = bytes.indexOf(delimiter, cursor);
    if (start < 0) break;
    let contentStart = start + delimiter.length;
    if (bytes.subarray(contentStart, contentStart + 2).toString() === "--") break;
    if (bytes.subarray(contentStart, contentStart + 2).toString() === "\r\n") contentStart += 2;
    const headerEnd = bytes.indexOf(Buffer.from("\r\n\r\n"), contentStart);
    if (headerEnd < 0)
      throw new AppError("Detailed music response contains a malformed multipart header", "invalid_multipart_response");
    const headers = bytes.subarray(contentStart, headerEnd).toString("latin1");
    const next = bytes.indexOf(delimiter, headerEnd + 4);
    if (next < 0)
      throw new AppError("Detailed music response contains an unterminated part", "invalid_multipart_response");
    let end = next;
    if (bytes.subarray(end - 2, end).toString() === "\r\n") end -= 2;
    const type =
      headers
        .match(/^content-type:\s*([^\r\n]+)/im)?.[1]
        ?.trim()
        .toLowerCase() ?? "application/octet-stream";
    parts.push({ contentType: type, data: bytes.subarray(headerEnd + 4, end) });
    cursor = next;
  }
  return parts;
}

function summarizeJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return { response_type: typeof value };
  const object = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of [
    "text",
    "status",
    "language_code",
    "language_probability",
    "transcription_id",
    "project_id",
    "song_id",
    "id",
  ]) {
    const item = object[key];
    if (typeof item === "string" || typeof item === "number")
      summary[key] = typeof item === "string" ? item.slice(0, 400) : item;
  }
  return summary;
}

function extensionForOutputFormat(format: string): string | undefined {
  if (format === "auto" || /^mp3_\d+_\d+$/.test(format)) return ".mp3";
  if (/^wav_\d+$/.test(format)) return ".wav";
  if (/^opus_\d+_\d+$/.test(format)) return ".ogg";
  return undefined;
}
