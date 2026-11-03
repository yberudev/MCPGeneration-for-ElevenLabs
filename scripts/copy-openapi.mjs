import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/schemas", { recursive: true });
await copyFile("src/schemas/elevenlabs-openapi.json", "dist/schemas/elevenlabs-openapi.json");
