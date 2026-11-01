<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Personal CRM — agent notes

- **You are the AI layer of this product.** The `personal-crm` MCP server (`.mcp.json`) exposes the user's workspace. When the user pastes notes about a conversation or asks you to "process captures", follow the extraction workflow in `mcp/EXTRACTION.md` — stage proposals, never write extracted facts directly without user approval.
- All data access goes through `repoFor(workspaceId)` in `src/db/repo.ts` (+ `repo-extraction.ts`). Never import Drizzle tables into routes/actions/MCP handlers directly.
- Layer rule (spec §3): `interactions.raw_source` is immutable Layer 1; memories are user-approved Layer 2; AI summaries and message drafts are regenerable Layer 3. No AI text ever lands in Layer 1/2 fields without going through the proposal → approval pipeline.
- **Drafting** (`../draft-message-spec.md`): a draft is never sent and never marked sent by anything but an explicit click. `markDraftSent` in `src/db/repo-drafts.ts` is the single place a draft can become Layer 1, and it takes a required outcome — "reached out another way" writes nothing at all. Don't add a code path that logs an unsent draft, and don't prefill the "what did you actually send" box with the draft.
- Tests: `npm test` (integration tests need `DATABASE_URL` in `.env.local`).
- **Intros** (README "Intros"): the only two-contact entity. Double opt-in is DERIVED from the opt-in timestamps against `sent_at` in `isDoubleOptIn` — never add a stored boolean for it, and never let a caller set `intros.status` directly. `mark_intro_sent` spawns the 30-day check-in; `record_intro_outcome` closes it.
- **Ids from the client are untrusted.** Any contact/interaction id arriving from a form or MCP call goes through `assertContactsInWorkspace` / `assertInteractionInWorkspace` in `src/db/repo.ts` before it is written into a link row. Joins that return contact rows filter on `workspace_id` even when the FK "should" guarantee it.
- **URL fields** (`linkedin_url`, `website`) only ever hold http(s): `safeHttpUrl` in `src/lib/normalize.ts` runs on every write path (repo create/update, extraction apply) and again at render. Never put a stored URL in an `href` without it.
- **Dates**: the server is UTC; the user's `timezone` is the truth. Parse `datetime-local` input with `zonedLocalToUtc` and render with `formatDate` / `formatDateTime` from `src/lib/dates.ts` — never bare `toLocaleDateString()` or `new Date(localString)` on the server.
- **Abuse limits** live in `src/db/rate-limit.ts` (Postgres-backed fixed windows). Magic-link requests are limited per email and per IP in the Auth.js `signIn` callback; the hosted MCP endpoint per token and per IP on bad tokens. Add a key there rather than an in-memory counter — Vercel functions share no memory.
- **Per-user settings** are a JSON blob (`users.settings_json`) read through typed helpers (`voiceFor` in `lib/drafting.ts`, `extractionSettingsFor` in `lib/user-settings.ts`) and written through `src/db/users.ts`. `extraction.autoApply` decides whether the AI applies proposals itself; the server instructions and `get_extraction_context` are built from it per user, so never hard-code either behaviour into the prompt text.
