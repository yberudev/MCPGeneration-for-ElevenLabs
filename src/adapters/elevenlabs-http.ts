import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { AppError } from "../utils/errors.js";
import type { OpenApiContracts } from "../services/openapi-contracts.js";

export interface RemoteResult<T> {
  data: T;
  status: number;
  requestId: string | null;
  usageHeader: string | null;
  contentType: string | null;
}

export interface BinaryResult extends Omit<RemoteResult<never>, "data"> {
  data: Buffer;
}

export class ElevenLabsHttp {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 120_000,
    private readonly maxResponseBytes = 104_857_600,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly contracts?: OpenApiContracts,
  ) {}

  async json<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; form?: FormData } = {},
  ): Promise<RemoteResult<T>> {
    const response = await this.send(method, path, options);
    const text = await response.text();
    if (!response.ok) throw this.httpError(response.status, text);
    let data: T;
    try {
      data = (text ? JSON.parse(text) : {}) as T;
    } catch (cause) {
      throw new AppError("ElevenLabs returned an invalid JSON response", "invalid_remote_json", response.status, {
        cause,
      });
    }
    return this.meta(response, data);
  }

  validateRequest(
    method: string,
    path: string,
    body: unknown,
    query: Record<string, unknown> = {},
    form?: FormData,
  ): void {
    const url = new URL(path, "https://api.elevenlabs.io");
    this.contracts?.validate(method, url.pathname, body, query, form);
  }

  async binary(
    method: "GET" | "POST",
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; form?: FormData } = {},
  ): Promise<BinaryResult> {
    const response = await this.send(method, path, options);
    if (!response.ok) throw this.httpError(response.status, await response.text());
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > this.maxResponseBytes)
      throw new AppError("Remote media exceeds the configured size limit", "media_too_large", response.status);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > this.maxResponseBytes)
      throw new AppError("Remote media exceeds the configured size limit", "media_too_large", response.status);
    return this.meta(response, data);
  }

  async downloadGeneratedMedia(signedUrl: string): Promise<BinaryResult> {
    let url: URL;
    try {
      url = new URL(signedUrl);
    } catch {
      throw new AppError("Remote media URL is invalid", "invalid_media_url");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "storage.googleapis.com" ||
      !url.pathname.startsWith("/generations/") ||
      url.username ||
      url.password
    ) {
      throw new AppError(
        "Only signed ElevenLabs generation media URLs from storage.googleapis.com are accepted",
        "untrusted_media_url",
      );
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch (cause) {
      throw new AppError("Generated media download failed or timed out", "media_download_unknown", undefined, {
        cause,
      });
    }
    if (!response.ok) throw this.httpError(response.status, await response.text());
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > this.maxResponseBytes)
      throw new AppError("Generated media exceeds the configured size limit", "media_too_large", response.status);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > this.maxResponseBytes)
      throw new AppError("Generated media exceeds the configured size limit", "media_too_large", response.status);
    return this.meta(response, data);
  }

  async fileForm(
    fields: Record<string, string | number | boolean | undefined>,
    filePath: string,
    fieldName = "file",
  ): Promise<FormData> {
    return this.filesForm(fields, [filePath], fieldName);
  }

  async filesForm(fields: Record<string, unknown>, filePaths: string[], fieldName = "file"): Promise<FormData> {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) form.append(key, typeof item === "string" ? item : JSON.stringify(item));
      } else if (typeof value === "object") form.append(key, JSON.stringify(value));
      else form.append(key, String(value));
    }
    let totalBytes = 0;
    for (const filePath of filePaths) {
      const bytes = await readFile(filePath);
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > this.maxResponseBytes || totalBytes > this.maxResponseBytes)
        throw new AppError("Input media exceeds the configured size limit", "media_too_large");
      form.append(fieldName, new File([bytes], basename(filePath)));
    }
    return form;
  }

  private async send(
    method: string,
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; form?: FormData },
  ): Promise<Response> {
    if (!path.startsWith("/v1/") && !path.startsWith("/v2/"))
      throw new AppError("Only documented ElevenLabs API paths are allowed", "invalid_api_path");
    const url = new URL(path, "https://api.elevenlabs.io");
    this.contracts?.validate(method, url.pathname, options.body, options.query, options.form);
    if (!this.apiKey) throw new AppError("ELEVENLABS_API_KEY is not configured", "missing_api_key");
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ "xi-api-key": this.apiKey, accept: "application/json, audio/*, application/zip" });
    let body: BodyInit | undefined;
    if (options.form) body = options.form;
    else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch (cause) {
      throw new AppError(
        "ElevenLabs request failed or timed out; a submitted operation may still be processing",
        "remote_request_unknown",
        undefined,
        { cause },
      );
    }
    return response;
  }

  private meta<T>(response: Response, data: T): RemoteResult<T> {
    return {
      data,
      status: response.status,
      requestId: response.headers.get("request-id") ?? response.headers.get("x-request-id"),
      usageHeader: response.headers.get("character-cost"),
      contentType: response.headers.get("content-type"),
    };
  }

  private httpError(status: number, text: string): AppError {
    const safeBody = text.replace(/xi-api-key[^\s]*/gi, "[redacted]").slice(0, 600);
    let message = `ElevenLabs request failed with HTTP ${status}`;
    if (safeBody) {
      try {
        const parsed = JSON.parse(safeBody) as { detail?: unknown; message?: unknown };
        const detail = parsed.detail ?? parsed.message;
        if (typeof detail === "string") message = `${message}: ${detail.slice(0, 300)}`;
      } catch {
        // The upstream error body may not be JSON; avoid returning it verbatim.
      }
    }
    return new AppError(message, "elevenlabs_http_error", status);
  }
}
