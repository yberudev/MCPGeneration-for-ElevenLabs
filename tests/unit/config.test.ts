import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

describe("loadConfig", () => {
  it("defaults to dry-run and paid generation disabled", () => {
    const config = loadConfig({}, "/tmp/mcp-config-test");
    expect(config.DRY_RUN).toBe(true);
    expect(config.ALLOW_PAID_GENERATIONS).toBe(false);
    expect(config.GENERATED_DIR).toBe("/tmp/mcp-config-test/generated");
  });

  it("parses explicit policy and authorized roots", () => {
    const config = loadConfig(
      { DRY_RUN: "false", ALLOW_PAID_GENERATIONS: "true", ALLOWED_ROOTS: "/tmp/a,/tmp/b" },
      "/tmp/mcp-config-test",
    );
    expect(config.DRY_RUN).toBe(false);
    expect(config.ALLOW_PAID_GENERATIONS).toBe(true);
    expect(config.ALLOWED_ROOTS).toEqual(["/tmp/a", "/tmp/b"]);
  });
});
