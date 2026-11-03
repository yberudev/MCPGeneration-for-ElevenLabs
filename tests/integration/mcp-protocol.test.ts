import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";
import { openDatabase } from "../../src/db/database.js";
import { createApplication } from "../../src/server/create-server.js";

describe("MCP server protocol", () => {
  it("lists tools and returns a local budget result without network access", async () => {
    const db = openDatabase(":memory:");
    const config = loadConfig({
      GENERATED_DIR: "/tmp/mcp-protocol-generated",
      DATABASE_PATH: "/tmp/mcp-protocol.sqlite",
    });
    const app = createApplication(config, pino({ level: "silent" }), db);
    const client = new Client({ name: "offline-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await app.server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain("generate_speech");
      const response = await client.callTool({ name: "get_budget_status", arguments: {} });
      expect(response.isError).not.toBe(true);
      const text = response.content.find((item) => item.type === "text");
      expect(text?.type === "text" ? JSON.parse(text.text) : null).toMatchObject({ dry_run: true, call_remote: false });
    } finally {
      await client.close();
      await app.server.close();
      app.close();
      db.close();
    }
  });
});
