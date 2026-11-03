import { describe, expect, it, vi } from "vitest";
import { ElevenLabsHttp } from "../../src/adapters/elevenlabs-http.js";
import { AppError } from "../../src/utils/errors.js";

describe("ElevenLabsHttp", () => {
  it("requires a key and restricts API requests to documented paths", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;
    const client = new ElevenLabsHttp("", 1000, 1000, fetchImpl);
    await expect(client.json("GET", "/v1/user")).rejects.toMatchObject({ code: "missing_api_key" });
    await expect(client.json("GET", "https://example.com/steal")).rejects.toMatchObject({ code: "invalid_api_path" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts only signed media URLs with the documented host and path", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } }),
    ) as unknown as typeof fetch;
    const client = new ElevenLabsHttp("offline-key", 1000, 1024, fetchImpl);
    await expect(client.downloadGeneratedMedia("http://storage.googleapis.com/generations/test")).rejects.toMatchObject(
      { code: "untrusted_media_url" },
    );
    await expect(client.downloadGeneratedMedia("https://example.com/generations/test")).rejects.toMatchObject({
      code: "untrusted_media_url",
    });
    await expect(client.downloadGeneratedMedia("https://storage.googleapis.com/other/test")).rejects.toMatchObject({
      code: "untrusted_media_url",
    });
    await client.downloadGeneratedMedia("https://storage.googleapis.com/generations/test");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "error" }));
  });

  it("limits response size and redacts sensitive upstream text", async () => {
    const oversized = new ElevenLabsHttp("offline-key", 1000, 2, async () => new Response("large"));
    await expect(oversized.binary("GET", "/v1/user")).rejects.toMatchObject({ code: "media_too_large" });
    const failing = new ElevenLabsHttp(
      "offline-key",
      1000,
      1000,
      async () => new Response(JSON.stringify({ message: "xi-api-key=secretvalue" }), { status: 401 }),
    );
    await expect(failing.json("GET", "/v1/user")).rejects.toSatisfy(
      (error: unknown) => error instanceof AppError && !error.message.includes("secretvalue"),
    );
  });
});
