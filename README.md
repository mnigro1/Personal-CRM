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

`.mcp.json` registers a stdio MCP server (`npm run mcp`) exposing the workspace of `MCP_USER_EMAIL`: `search_contacts`, `get_contact`, `create_contact`, `log_interaction`, `add_memory`, `add_follow_up`, `list_follow_ups`, `complete_follow_up`. Claude Code picks it up automatically when working in this repo.

## Tests

`npm test` — unit tests always run; integration tests (workspace isolation, dedup, tag merge, last-interaction recompute) run when `DATABASE_URL` is set.

## Architecture notes

- **Workspace isolation**: all data access goes through `src/db/repo.ts` (`repoFor(workspaceId)`); no route or tool touches Drizzle directly.
- **Layer rule**: `interactions.raw_source` is immutable (Layer 1); memories are user-approved facts (Layer 2); AI summaries are regenerable caches (Layer 3). No AI text is ever written into Layer 1/2 fields.
- **`last_interaction_date`** is recomputed (`MAX(occurred_at)`), never incremented.
- Duplicate pastes are caught by a per-workspace SHA-256 over whitespace-normalized source text.
