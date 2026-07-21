<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Personal CRM — agent notes

- **You are the AI layer of this product.** The `personal-crm` MCP server (`.mcp.json`) exposes the user's workspace. When the user pastes notes about a conversation or asks you to "process captures", follow the extraction workflow in `mcp/EXTRACTION.md` — stage proposals, never write extracted facts directly without user approval.
- All data access goes through `repoFor(workspaceId)` in `src/db/repo.ts` (+ `repo-extraction.ts`). Never import Drizzle tables into routes/actions/MCP handlers directly.
- Layer rule (spec §3): `interactions.raw_source` is immutable Layer 1; memories are user-approved Layer 2; AI summaries are regenerable Layer 3. No AI text ever lands in Layer 1/2 fields without going through the proposal → approval pipeline.
- Tests: `npm test` (integration tests need `DATABASE_URL` in `.env.local`).
