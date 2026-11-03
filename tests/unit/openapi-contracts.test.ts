import { describe, expect, it } from "vitest";
import { OpenApiContracts } from "../../src/services/openapi-contracts.js";

describe("OpenApiContracts", () => {
  const contracts = new OpenApiContracts();

  it("matches parameterized official paths and validates a documented request", () => {
    expect(() =>
      contracts.validate("POST", "/v1/text-to-speech/voice-123", { text: "hello" }, { output_format: "mp3_44100_128" }),
    ).not.toThrow();
  });

  it("rejects undocumented paths, parameters, and invalid request bodies", () => {
    expect(() => contracts.validate("POST", "/v1/not-an-endpoint", {})).toThrowError(/No official OpenAPI contract/);
    expect(() => contracts.validate("POST", "/v1/music", {}, { invented: "yes" })).toThrowError(/not documented/);
    expect(() =>
      contracts.validate("POST", "/v1/sound-generation", { text: "bird call" }, { output_format: "not-a-real-format" }),
    ).toThrowError(/does not match/);
  });

  it("enforces required query fields, HTTP methods, and request-body media types", () => {
    expect(() => contracts.validate("GET", "/v1/usage/character-stats", undefined)).toThrowError(
      /Required query parameter start_unix/,
    );
    expect(() => contracts.validate("PATCH", "/v1/models", {})).toThrowError(/does not define PATCH/);
    expect(() => contracts.validate("GET", "/v1/models", { invented: true })).toThrowError(/no request body/);
    expect(() => contracts.validate("POST", "/v1/music", { prompt: "music" }, {}, new FormData())).toThrowError(
      /does not define multipart/,
    );
  });

  it("converts documented numeric and boolean queries and validates repeated multipart fields", () => {
    expect(() => contracts.validate("GET", "/v1/history", undefined, { page_size: "20" })).not.toThrow();
    expect(() =>
      contracts.validate(
        "POST",
        "/v1/text-to-speech/voice-123",
        { text: "hello" },
        { output_format: "mp3_44100_128", enable_logging: "true" },
      ),
    ).not.toThrow();
    const form = new FormData();
    form.append("videos", new File(["clip one"], "one.mp4"));
    form.append("videos", new File(["clip two"], "two.mp4"));
    form.append("tags", "cinematic");
    form.append("tags", "bright");
    expect(() => contracts.validate("POST", "/v1/music/video-to-music", undefined, {}, form)).not.toThrow();
  });
});
