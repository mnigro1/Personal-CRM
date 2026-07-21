# Personal-CRM

Personal CRM for professional connections — AI Native. Built from `personal-crm-spec.md` (Relationship Intelligence Platform, spec v3).

## Status

Phases 0–1 complete: schema for all spec tables, magic-link auth with invites, workspace-isolated repository layer, contacts/interactions/tags/memories/follow-ups UI, MCP server. AI extraction pipeline (Phase 2) is next — designed to run through Claude via MCP rather than an in-app API key.

## Setup

1. Create a [Neon](https://neon.tech) Postgres project and put the connection string in `.env.local`:

   ```
   DATABASE_URL=postgres://...
   AUTH_SECRET=<openssl rand -base64 32>
   MCP_USER_EMAIL=you@example.com
   ```

2. Apply migrations: `npm run db:migrate`
3. Run: `npm run dev` — sign in at http://localhost:3000; the magic link is printed to this terminal (no email provider in dev). The first user to sign in becomes the owner; further users need an invite from Settings.

## MCP

Two ways in, one shared tool surface (`src/lib/mcp-tools.ts`):

- **Local (Claude Code / Claude Desktop)**: `.mcp.json` registers a stdio server (`npm run mcp`) scoped to `MCP_USER_EMAIL`'s workspace.
- **Hosted (claude.ai, ChatGPT, any remote MCP client)**: `/api/mcp/<token>` — streamable HTTP, stateless. Each user mints their own connector URL in Settings → "Connect your AI"; the token resolves server-side to exactly their workspace. Revocable anytime.

Tools: contacts/interactions/memories/follow-ups CRUD + the extraction pipeline (`list_pending_captures`, `get_extraction_context`, `submit_extraction_proposal`, `apply_extraction`, `undo_extraction_batch`) per `mcp/EXTRACTION.md`.

The usage contract (date handling, capture workflow, approval gates, retrieval patterns) is delivered automatically to every client via the MCP `instructions` field at initialize time, personalized with the user's timezone (`buildServerInstructions` in `src/lib/mcp-tools.ts`). [`mcp/CLAUDE_PROJECT_INSTRUCTIONS.md`](mcp/CLAUDE_PROJECT_INSTRUCTIONS.md) is the same contract in paste-into-project-instructions form — optional reinforcement for clients that under-weight the protocol field.

## Tests

`npm test` — unit tests always run; integration tests (workspace isolation, dedup, tag merge, last-interaction recompute) run when `DATABASE_URL` is set.

## Architecture notes

- **Workspace isolation**: all data access goes through `src/db/repo.ts` (`repoFor(workspaceId)`); no route or tool touches Drizzle directly.
- **Layer rule**: `interactions.raw_source` is immutable (Layer 1); memories are user-approved facts (Layer 2); AI summaries are regenerable caches (Layer 3). No AI text is ever written into Layer 1/2 fields.
- **`last_interaction_date`** is recomputed (`MAX(occurred_at)`), never incremented.
- Duplicate pastes are caught by a per-workspace SHA-256 over whitespace-normalized source text.
