# Contribution instructions

- Read the current official ElevenLabs OpenAPI contract in `src/schemas/elevenlabs-openapi.json` and the current product documentation before changing an API route, request or response assumption.
- Do not copy or adapt code from another MCP server or another local project.
- Preserve the layered architecture: protocol tools validate and delegate; services own business rules; adapters own external calls.
- Never run a paid ElevenLabs request from tests, CI, install hooks or `npm run check`.
- Keep paid operations disabled by default. Unknown cost is never zero and requires a per-call authorization flag.
- Do not retry paid POST requests automatically. Record uncertain outcomes and do not silently resubmit.
- Add offline tests for new validation, budget, job, file or protocol behavior.
- Update `docs/API_MATRIX.md` and `docs/TOOL_REFERENCE.md` when API coverage changes.
- Do not fabricate credit values, plan access or successful media results.
- Keep API keys in environment variables or an ignored `.env.local`/`.env` file. Never add secrets to logs, fixtures or configuration examples.
- Use explicit FFmpeg argument arrays with `shell: false`; resolve every local input/output path through the media manager.
- Require explicit consent and confirmation for cloning voices and deleting remote data.
