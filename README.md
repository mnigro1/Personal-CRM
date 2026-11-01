# Personal-CRM

Personal CRM for professional connections — AI Native. Built from `personal-crm-spec.md` (Relationship Intelligence Platform, spec v3).

## Status

Phases 0–3 (partial) shipped: full schema, magic-link auth with invites,
workspace-isolated repository layer, contacts/interactions/memories/follow-ups,
the AI capture pipeline (extract → review → apply → undo), AI snapshots, the
Home view, and a hosted MCP endpoint. Tags were removed deliberately — facts
live in memories, which free-text search already covers.

**Message drafting** (`draft-message-spec.md`, phase 1) closes the Reconnect
leg: every open follow-up gets a "Draft message" button, the connected Claude
writes the draft through the MCP tools, and the user edits and sends it
themselves. Nothing is ever sent or marked sent automatically, and a draft is
Layer 3 — it only reaches `interactions.raw_source` when the user affirms at
the Mark-sent step that it is what actually went out.

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

Tools: contacts/interactions/memories/follow-ups CRUD + the extraction pipeline (`list_pending_captures`, `get_extraction_context`, `submit_extraction_proposal`, `apply_extraction`, `undo_extraction_batch`) per `mcp/EXTRACTION.md`, plus message drafting (`list_pending_drafts`, `get_draft_context`, `save_message_draft`, `request_message_draft`) per `../draft-message-spec.md`.

The usage contract (date handling, capture workflow, approval gates, retrieval patterns) is delivered automatically to every client via the MCP `instructions` field at initialize time, personalized with the user's timezone (`buildServerInstructions` in `src/lib/mcp-tools.ts`). [`mcp/CLAUDE_PROJECT_INSTRUCTIONS.md`](mcp/CLAUDE_PROJECT_INSTRUCTIONS.md) is the same contract in paste-into-project-instructions form — optional reinforcement for clients that under-weight the protocol field.

## Intros

The one place two contacts are related to each other. Everything else in the
CRM hangs off a single `contact_id`; an intro is a `(person_a, person_b)` pair
with a lifecycle.

**Lifecycle.** `proposed` → `opt_in_pending` → `opt_in_confirmed` → `sent` →
`completed`, with `declined` and `abandoned` as the other two ends. Status is
never set directly by a caller: `record_intro_opt_in` derives it from the
timestamps, so status and evidence cannot disagree.

**The double opt-in rule.** An intro counts toward the goal only if both
`a_opted_in_at` and `b_opted_in_at` are set *and both are earlier than*
`sent_at`. That is computed on read, never stored as a flag, so the
compliance rate can't be talked up and recording a yes after the fact can't
rescue an intro that went out cold. `mark_intro_sent` refuses without both
opt-ins; `force: true` still records the intro but it fails the derived check
and is reported separately by `get_intro_stats`.

**The 30-day check-in is automatic.** Transitioning to `sent` creates a
follow-up due `sent_at + 30 days` with `intro_id` set, pointed at
`person_a_contact_id`. Follow-ups stay single-contact; `get_draft_context`
joins through `intro_id` to name the other person and quote the reason, so
the existing drafting machinery works unchanged. `record_intro_outcome`
completes that follow-up — you never close it separately.

**Duplicates.** One live intro per unordered pair, enforced by a partial
unique index on `least/greatest` of the two contact ids. `log_intro` returns
the existing intro rather than erroring. Reaching a terminal state frees the
pair, so two people can be introduced again later.

Goal lives in `users.settings_json` as `goals.introsPerMonth` (default 2),
editable in Settings. Months are bucketed in the owner's timezone.

Existing `type = 'intro'` interactions are **not** backfilled automatically —
that would invent opt-in history. `npx tsx scripts/list-intro-interactions.ts`
lists them with a suggested `log_intro` call so you can decide case by case.

## Security notes

- **Production needs an email provider** (`GMAIL_USER` + `GMAIL_APP_PASSWORD`, or `RESEND_API_KEY` + `EMAIL_FROM`). Without one, sign-in refuses to send rather than log a live magic link. Links expire after an hour.
- **Abuse limits** (Postgres-backed, `src/db/rate-limit.ts`): magic-link requests are capped per email (5 / 15 min) and per IP (20 / 15 min); the hosted MCP endpoint per token (300 / min) and per IP for bad tokens (20 / min). Limits fail open if the database is unreachable.
- **Tenant isolation**: every query is scoped by `workspace_id` through `repoFor`; ids a client sends (contact, interaction) are verified against the workspace before they are linked to anything.
- **URL fields** are restricted to http(s) at write time and again at render, so a pasted `javascript:` link can never become a clickable one.
- **Headers**: a static Content-Security-Policy (no framing, no plugins, same-origin forms), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS — set in `next.config.ts`.
- **Settings → AI extraction** lets each user choose whether their AI applies extraction proposals automatically or holds them for review. Hold-for-review is the safer choice for anyone who pastes in text written by other people.
- **Connector tokens** are shown once, stored as SHA-256 hashes, revocable in Settings. The token travels in the connector URL because claude.ai/ChatGPT custom connectors can't send headers — treat the URL as a password.
- **Your data is yours** (Settings → Your data): `/api/export` downloads the whole workspace as JSON — every table, soft-deleted and merged contacts included — or the live contacts as a CSV (`?format=csv`), 3 downloads per 10 minutes per user. "Delete my account" (type DELETE) hard-deletes everything the user owns in one transaction — workspace data, connector tokens, invites, sessions, sign-in tokens, the user row — then signs them out. No retention copy, no email; the AI connector stops working the instant it commits. That is the one hard delete in the codebase: `deleteUserAccount` in `src/db/users.ts`.

## Tests

`npm test` — unit tests always run; integration tests (workspace isolation,
extraction apply/undo, duplicate detection, hosted MCP auth) run when
`DATABASE_URL` is set.

## Architecture notes

- **Workspace isolation**: all data access goes through `src/db/repo.ts` (`repoFor(workspaceId)`); no route or tool touches Drizzle directly.
- **Layer rule**: `interactions.raw_source` is immutable (Layer 1); memories are user-approved facts (Layer 2); AI summaries are regenerable caches (Layer 3). No AI text is ever written into Layer 1/2 fields.
- **`last_interaction_date`** is recomputed (`MAX(occurred_at)`), never incremented.
- Duplicate pastes are caught by a per-workspace SHA-256 over whitespace-normalized source text.
