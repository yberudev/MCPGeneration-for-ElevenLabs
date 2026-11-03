import type { McpServer } from "@modelcontextprotocol/server";
import type { ZodObject, ZodRawShape } from "zod/v4";
import type { Logger } from "pino";
import { errorMessage } from "../utils/errors.js";

export function registerTool<T extends ZodRawShape>(
  server: McpServer,
  logger: Logger,
  name: string,
  description: string,
  schema: ZodObject<T>,
  handler: (input: ReturnType<ZodObject<T>["parse"]>) => unknown | Promise<unknown>,
): void {
  server.registerTool(name, { description, inputSchema: schema }, async (input) => {
    try {
      const result = await handler(input as ReturnType<ZodObject<T>["parse"]>);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      logger.warn({ tool: name, error: errorMessage(error) }, "MCP tool failed");
      return {
        isError: true,
        content: [
          { type: "text", text: JSON.stringify({ success: false, operation: name, error: errorMessage(error) }) },
        ],
      };
    }
  });
}
