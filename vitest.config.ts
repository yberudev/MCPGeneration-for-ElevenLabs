import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/services/budget/**/*.ts",
        "src/services/generation/**/*.ts",
        "src/services/openapi-contracts.ts",
        "src/services/media/**/*.ts",
      ],
      reporter: ["text", "html"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
