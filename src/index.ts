import { serveStdio } from "@modelcontextprotocol/server/stdio";
import pino from "pino";
import { createApplication } from "./server/create-server.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.destination(2));
const applications = new Set<ReturnType<typeof createApplication>>();
const handle = serveStdio(
  () => {
    const application = createApplication(undefined, logger);
    applications.add(application);
    return application.server;
  },
  { onerror: (error) => logger.error({ error: error.message }, "MCP transport error") },
);

function closeApplications(): void {
  for (const application of applications) {
    try {
      application.close();
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : "close failed" }, "Database shutdown failed");
    }
  }
  applications.clear();
}

process.stdin.once("end", closeApplications);
process.once("SIGINT", () => {
  void handle.close().finally(closeApplications);
});
process.once("SIGTERM", () => {
  void handle.close().finally(closeApplications);
});
