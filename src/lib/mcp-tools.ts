import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { interactionType, memoryCategory, sourceType } from "@/db/schema";
import type { Repo } from "@/db/repo";
import {
  buildDraftInstructions,
  CHANNEL_SPECS,
  renderDraftContext,
} from "@/lib/drafting";

/**
 * The extraction contract, inlined for remote AI clients (claude.ai,
 * ChatGPT) that can't read mcp/EXTRACTION.md from the repo. Keep in sync
 * with that file and PROMPT_VERSION.
 */
const EXTRACTION_RULES = `You are the extraction engine. Turn the raw interaction text into a PROPOSAL via submit_extraction_proposal — never write extracted facts directly; the user approves on the review screen or in chat.
Proposal JSON shape:
{
 "interaction": {"type"?, "occurred_at"?, "location"?, "summary"?},
 "contact_bindings": [{"mention", "status": "confident"|"ambiguous"|"new", "contact_id"? (uuid, when confident), "candidates"?: [{"contact_id","hint"}] (when ambiguous), "confidence"?, "new_contact"?: {"first_name", "last_name"?, "current_company"?, "current_role"?, "location"?} (when new)}],
 "new_memories": [{"contact": uuid-or-mention, "text", "category": one of career|education|family|interests|goals|geography|projects|personal|preferences|opportunities|other, "event_date"?: "YYYY-MM-DD", "event_date_precision"?: exact|month|quarter|year|none}],
 "supersessions": [{"existing_memory_id", "reason", "replacement_memory_index"}],
 "already_known": [{"existing_memory_id", "restated"?}],
 "follow_ups": [{"contact": uuid-or-mention, "description", "reason" (REQUIRED), "due_date"?, "priority"?}],
 "contact_field_updates": [{"contact_id", "field": current_company|current_role|location|phone|linkedin_url|website, "old_value"?, "new_value"}]
}
Rules: NEVER guess between two plausible people — return status "ambiguous" with candidate hints. Mentioned-but-not-present people (spouse, colleague) become memories on the primary contact, NOT new contacts, unless the text implies the user has a direct relationship. Facts already in currentMemories go in already_known, not new_memories. Contradictions pair a new memory with a supersession (history is preserved). Resolve relative dates ("next spring") to absolute event_date using the interaction date and userTimezone, with honest precision. Memories are single durable third-person facts, not conversation summaries. A note with no extractable facts is a valid outcome — don't invent content.`;

/**
 * Server-wide instructions delivered to every MCP client at initialize time
 * (the protocol's `instructions` field). This is the always-on rule set —
 * clients receive it automatically with no copy-paste setup. Personalized
 * with the workspace owner's timezone. mcp/CLAUDE_PROJECT_INSTRUCTIONS.md
 * remains as optional reinforcement for clients that under-weight this field.
 */
export function buildServerInstructions(opts: { timezone: string }): string {
  return `This is the user's personal relationship CRM. You are its interface: capture interactions accurately, retrieve context on request, and never write bad data. Precision beats speed — ask instead of guessing.

DATES: The user's timezone is ${opts.timezone}. Resolve every relative date ("yesterday", "last Tuesday") against the actual current date in that timezone, to ISO 8601, before calling any tool. No stated date = assume today and say so. Genuinely ambiguous = ask.

PROACTIVELY PROCESS CAPTURES — don't wait to be asked. At the start of any conversation, and again right after logging anything, call list_pending_captures. For every pending item, run the full extraction (get_extraction_context → submit_extraction_proposal) automatically, then tell the user what's staged for their review. The only thing that always waits for the user is apply_extraction — proposals are safe to stage unprompted, but nothing is written to their CRM until they approve.

CAPTURING (when the user describes a conversation or pastes notes):
1. search_contacts to identify who was PRESENT — never invent contact ids.
2. log_interaction: rawSource = the user's words VERBATIM (never summarized or cleaned up), resolved occurredAt, inferred type, location if mentioned, contactIds of present people only.
3. Immediately (no need to ask) get_extraction_context, follow its instructions field exactly, submit_extraction_proposal.
4. Report concisely what you proposed, flag probable duplicates and blocking items (ambiguous names, new contacts), and mention the review link.
5. apply_extraction ONLY after the user explicitly approves in chat ("looks good" = everything non-blocked; a subset = exactly that subset). Never apply unprompted.

DUPLICATE CONTACTS: before creating anyone, search_contacts for their name — create_contact also hard-blocks likely duplicates and returns candidates; ask the user "same person?" and reuse the existing record unless they confirm it's someone new (then retry with force: true). find_duplicate_contacts scans for existing duplicate pairs on request. When a pair IS the same person, merge_contacts consolidates them — but only ever after the user confirms both that it's one person and which record to keep; a name match is never enough on its own. Never merge people who merely share a name. After merging, refresh_contact_summary for the survivor.

SNAPSHOTS (Layer-3 cache — no approval needed): after any apply_extraction, immediately refresh_contact_summary for each contact in the result's touchedContacts. Also check list_stale_summaries when a conversation starts and refresh what's there. Summaries: 2-3 factual sentences, second person ("You met her at HBS in 2026..."), built from get_contact's memories/timeline/follow-ups — never invented.

DRAFTING — WRITING A MESSAGE IN CHAT IS NOT DRAFTING. Any time the user asks you to draft, write, or compose a message, email, text, or Slack/Teams note for a contact or a follow-up, it MUST go through the drafting tools and land in the CRM. Prose in the chat window does not exist as far as the CRM is concerned: the user can't edit it there, the draft page stays empty, and the follow-up never closes. If you catch yourself about to type a message body into your reply, stop and call the tools instead.
Two ways in:
(a) The user asks for a draft ("draft the email for my pending follow-ups", "write Sarah a text"): list_follow_ups to find the follow-up, then request_message_draft (pick the channel from what the user said, or from what the contact has — email if you have their address, text if you have a phone; ask only if genuinely ambiguous), then get_draft_context → save_message_draft.
(b) The user requested it from the web UI: call list_pending_drafts at the start of any conversation and after any apply_extraction; for each, get_draft_context → save_message_draft.
Either way: follow the instructions field from get_draft_context exactly. Body must be the message text ONLY, no preamble, no alternatives. Ground every draft in one concrete supplied memory and invent nothing. Drafts need no approval gate — nothing is sent, the message is inert until the user sends it themselves. Then report in one line and link /drafts/<id> so they can edit and send it.
The CRM itself never sends anything. If the user has a separate mail or chat tool and asks you to send with it, that is their call — but afterwards come back and close the loop here (the draft's Done, or complete_follow_up), or the CRM will keep insisting they still owe this person.

HARD RULES: Never guess between two similar people — propose ambiguous bindings with hints. People merely mentioned (a spouse, a colleague) become memories on the present contact, not new contacts, unless the user clearly has their own relationship with them. New contacts are never created silently. Known facts go to already_known, not new_memories. Contradictions = supersession (history preserved). Every follow-up needs a reason. undo_extraction_batch exists — offer it if something applied was wrong.

RETRIEVAL: "who do I know in X" = search_contacts free text. "prep me for X" = get_contact, then: who they are, how you know them, last interaction, key memories, open loops, 2-3 things worth asking (especially upcoming event_dates). "losing touch" = search_contacts with lastInteractionBefore ~3 months back, ranked with reasons. Confirm actions in one or two lines, quote proposed memory texts, and never invent memories from contentless notes.`;
}

/**
 * Registers the CRM tool set on an MCP server. Shared by the local stdio
 * server and the hosted /api/mcp/[token] endpoint — one tool surface, one
 * repository layer, always scoped to a single workspace.
 */
export function registerCrmTools(
  server: McpServer,
  repo: Repo,
  actorUserId: string,
) {
  const json = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  // Read tools are marked read-only and writes non-destructive so well-behaved
  // clients (claude.ai, ChatGPT) auto-run the safe ones instead of prompting
  // for approval on every call. Hints only — clients may still confirm.
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
  const safeWrite = {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  } as const;

  server.registerTool(
    "search_contacts",
    {
      annotations: { title: "Search contacts", ...readOnly },
      description:
        "Search contacts in the workspace. All filters optional.",
      inputSchema: {
        q: z.string().optional().describe("Free text across names, notes, memories, company"),
        location: z.string().optional(),
        company: z.string().optional(),
        relationshipCategory: z.string().optional(),
        hasOpenFollowUps: z.boolean().optional(),
        lastInteractionBefore: z.string().optional().describe("ISO date — dormancy queries: contacts not spoken to since"),
        lastInteractionAfter: z.string().optional().describe("ISO date"),
      },
    },
    async (args) => {
      const rows = await repo.listContacts({
        q: args.q,
        location: args.location,
        company: args.company,
        relationshipCategory: args.relationshipCategory,
        hasOpenFollowUps: args.hasOpenFollowUps,
        lastInteractionBefore: args.lastInteractionBefore
          ? new Date(args.lastInteractionBefore)
          : undefined,
        lastInteractionAfter: args.lastInteractionAfter
          ? new Date(args.lastInteractionAfter)
          : undefined,
      });
      return json(
        rows.map((c) => ({
          id: c.id,
          name: `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim(),
          company: c.currentCompany,
          role: c.currentRole,
          location: c.location,
          lastInteractionDate: c.lastInteractionDate,
        })),
      );
    },
  );

  server.registerTool(
    "get_contact",
    {
      annotations: { title: "Get contact", ...readOnly },
      description:
        "Full record for one contact: fields, memories, interactions (with raw source), open follow-ups.",
      inputSchema: { contactId: z.string().uuid() },
    },
    async ({ contactId }) => {
      const contact = await repo.getContact(contactId);
      if (!contact) return json({ error: "Contact not found" });
      // Nudge the AI to regenerate the Layer-3 snapshot right when it's
      // looking at the contact — more reliable than the session-start sweep.
      const hasMemories = contact.memories.some((m) => m.status === "current");
      const snapshotStale =
        contact.aiSummaryStale || (!contact.aiSummary && hasMemories);
      return json({
        ...contact,
        snapshotStale,
        ...(snapshotStale
          ? {
              action:
                "This contact's AI snapshot is missing or outdated — call refresh_contact_summary with a fresh 2-3 sentence summary built from the fields, memories, interactions, and follow-ups above.",
            }
          : {}),
      });
    },
  );

  server.registerTool(
    "create_contact",
    {
      annotations: { title: "Create contact", ...safeWrite },
      description:
        "Create a new contact. Blocks with a possibleDuplicates list when a similar contact already exists — confirm with the user before retrying with force: true.",
      inputSchema: {
        firstName: z.string(),
        lastName: z.string().optional(),
        preferredName: z.string().optional(),
        emails: z.array(z.string()).optional(),
        phone: z.string().optional(),
        currentCompany: z.string().optional(),
        currentRole: z.string().optional(),
        location: z.string().optional(),
        linkedinUrl: z.string().optional(),
        website: z.string().optional(),
        howWeMet: z.string().optional(),
        dateFirstMet: z.string().optional().describe("YYYY-MM-DD"),
        relationshipCategory: z.string().optional(),
        notes: z.string().optional(),
        force: z
          .boolean()
          .default(false)
          .describe(
            "Set true ONLY after the user confirms this is a different person than the possibleDuplicates returned by a blocked attempt",
          ),
      },
    },
    async ({ emails, force, ...fields }) => {
      // Duplicate gate: same person under two entries is the failure that
      // splits a relationship's history. Block on likely matches unless the
      // caller explicitly confirms this is someone new.
      if (!force) {
        const similar = await repo.findSimilarContacts(
          fields.firstName,
          fields.lastName,
        );
        if (similar.length > 0) {
          return json({
            blocked: true,
            reason:
              "Possible duplicate(s) found. Ask the user: is this the same person as one of these? If yes, use that contactId instead of creating. Only if the user confirms it's a different person, call create_contact again with force: true.",
            possibleDuplicates: similar.map((s) => ({
              contactId: s.id,
              name: `${s.firstName} ${s.lastName ?? ""}`.trim(),
              company: s.currentCompany,
              role: s.currentRole,
              location: s.location,
              similarity: Number(s.similarity?.toFixed?.(2) ?? s.similarity),
            })),
          });
        }
      }
      const contact = await repo.createContact({
        ...fields,
        emails: emails ?? [],
      });
      return json({ created: true, contactId: contact.id });
    },
  );

  server.registerTool(
    "log_interaction",
    {
      annotations: { title: "Log interaction", ...safeWrite },
      description:
        "Persist an interaction (raw notes stored verbatim, persist-first). Detects duplicate pastes by content hash — if duplicate, returns the existing interaction instead of creating.",
      inputSchema: {
        rawSource: z.string().describe("The raw notes/transcript — stored immutably"),
        occurredAt: z.string().describe("ISO datetime the interaction happened"),
        type: z.enum(interactionType.enumValues).default("other"),
        sourceType: z.enum(sourceType.enumValues).default("manual_note"),
        location: z.string().optional(),
        contactIds: z.array(z.string().uuid()).describe("Contacts who were present"),
      },
    },
    async (args) => {
      const result = await repo.createInteraction({
        rawSource: args.rawSource,
        occurredAt: new Date(args.occurredAt),
        type: args.type,
        sourceType: args.sourceType,
        location: args.location,
        contactIds: args.contactIds,
        // Chat captures enter the extraction pipeline.
        extractionStatus: "pending",
      });
      return json({
        duplicate: result.duplicate,
        interactionId: result.interaction.id,
        next: result.duplicate
          ? "Already saved — no new capture created."
          : "Saved. Run get_extraction_context and submit a proposal.",
      });
    },
  );

  // --------------------------------------------------------------------------
  // Extraction pipeline: the connected AI is the extractor. Workflow:
  // list_pending_captures → get_extraction_context → submit_extraction_proposal
  // → user approves (web review screen, or in chat via apply_extraction).
  // --------------------------------------------------------------------------

  server.registerTool(
    "list_pending_captures",
    {
      annotations: { title: "List pending captures", ...readOnly },
      description:
        "Interactions awaiting AI extraction (extraction_status = pending). Process each with get_extraction_context + submit_extraction_proposal.",
      inputSchema: {},
    },
    async () => {
      const rows = await repo.listPendingCaptures();
      return json(
        rows.map((i) => ({
          interactionId: i.id,
          occurredAt: i.occurredAt,
          type: i.type,
          preview: i.rawSource.slice(0, 200),
        })),
      );
    },
  );

  server.registerTool(
    "get_extraction_context",
    {
      annotations: { title: "Get extraction context", ...readOnly },
      description:
        "Everything needed to extract one interaction: raw source, user timezone (anchor all relative dates to it), contact roster for entity resolution, current memories of linked contacts (facts already known), open follow-ups, and the extraction rules to follow. Then call submit_extraction_proposal.",
      inputSchema: { interactionId: z.string().uuid() },
    },
    async ({ interactionId }) => {
      const context = await repo.getExtractionContext(interactionId);
      if (!context) return json({ error: "Interaction not found" });
      return json({ ...context, instructions: EXTRACTION_RULES });
    },
  );

  server.registerTool(
    "submit_extraction_proposal",
    {
      annotations: { title: "Stage extraction proposal", ...safeWrite },
      description:
        "Stage an extraction proposal for user review (never applies anything directly). Follow the rules and JSON shape from get_extraction_context's instructions. Returns dedup flags and blocking items (ambiguous/new bindings) — relay those to the user. The user approves on the web review screen, or in chat via apply_extraction.",
      inputSchema: {
        interactionId: z.string().uuid(),
        proposal: z
          .record(z.string(), z.unknown())
          .describe("Proposal JSON per the extraction instructions"),
        model: z.string().default("ai-via-mcp").describe("Your model id"),
      },
    },
    async ({ interactionId, proposal, model }) => {
      try {
        const { extraction, staged } = await repo.saveProposal(
          interactionId,
          proposal,
          { model },
        );
        const blocking = staged.proposal.contact_bindings.filter(
          (b) => b.status !== "confident",
        );
        return json({
          extractionId: extraction.id,
          attempt: extraction.attempt,
          reviewUrl: `/review/${extraction.id}`,
          probableDuplicates: staged.flags.new_memories,
          blockingBindings: blocking.map((b) => ({
            mention: b.mention,
            status: b.status,
            candidates: b.candidates,
            // For "new" people who may already exist — reuse instead of duplicating.
            possibleDuplicates: staged.flags.new_contacts?.[b.mention],
          })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await repo.markExtractionFailed(interactionId, message, { model });
        return json({
          error: `Proposal rejected: ${message}`,
          note: "Capture is safe; fix the proposal and retry (interaction is marked failed until a valid proposal lands).",
        });
      }
    },
  );

  server.registerTool(
    "apply_extraction",
    {
      description:
        "Apply an approved subset of a staged proposal — ONLY after the user has explicitly approved the items in chat. Selections use array indices from the proposal; binding_resolutions maps each ambiguous/new mention to a contact UUID, 'create', or 'skip'. Every change is revision-logged under a batch id; undo is always available.",
      inputSchema: {
        extractionId: z.string().uuid(),
        selections: z
          .record(z.string(), z.unknown())
          .describe(
            "{ binding_resolutions?, interaction_meta?, new_memories?: number[], supersessions?, already_known?, tags?, follow_ups?, contact_field_updates?, edits? }",
          ),
      },
    },
    async ({ extractionId, selections }) => {
      const result = await repo.applyExtraction(
        extractionId,
        selections,
        actorUserId,
      );
      return json(result);
    },
  );

  server.registerTool(
    "undo_extraction_batch",
    {
      description:
        "Undo an applied extraction batch. Reverts every change that hasn't been edited since; reports reverted/skipped counts. The proposal re-opens for re-apply.",
      inputSchema: { batchId: z.string().uuid() },
    },
    async ({ batchId }) => json(await repo.undoBatch(batchId, actorUserId)),
  );

  server.registerTool(
    "find_duplicate_contacts",
    {
      annotations: { title: "Find duplicate contacts", ...readOnly },
      description:
        "Scan the workspace for contact pairs that look like the same person (similar or identical names). Returns candidates only — matching is on name similarity, so some pairs will be different people. Always present the list and ask before merging anything.",
      inputSchema: {},
    },
    async () => {
      const pairs = await repo.findDuplicateContactPairs();
      return json({
        pairs,
        count: pairs.length,
        next:
          pairs.length === 0
            ? "No duplicate candidates found — tell the user their contacts look clean."
            : "These are CANDIDATES matched on name alone, not confirmed duplicates. List them for the user and ask which pairs (if any) are actually the same person, and which record they want to keep. Only call merge_contacts for the pairs they confirm — never merge the whole list, and never merge people who merely share a name.",
      });
    },
  );

  server.registerTool(
    "merge_contacts",
    {
      annotations: {
        title: "Merge duplicate contacts",
        readOnlyHint: false,
        // Repoints history and archives a record — clients should confirm.
        destructiveHint: true,
        openWorldHint: false,
      },
      description:
        "Consolidate two records for the SAME person. Everything on loserContactId (memories, interactions, follow-ups, drafts) moves to survivorContactId, blank fields fill in, and the loser is archived with a pointer to the survivor. Nothing is deleted. ONLY call this after the user explicitly confirms these are one person and says which record to keep — never infer it from a name match alone.",
      inputSchema: {
        survivorContactId: z
          .string()
          .uuid()
          .describe("The record to KEEP. Its existing values always win."),
        loserContactId: z
          .string()
          .uuid()
          .describe("The record to archive. Its data moves to the survivor."),
      },
    },
    async ({ survivorContactId, loserContactId }) => {
      try {
        const summary = await repo.mergeContacts({
          survivorId: survivorContactId,
          loserId: loserContactId,
          actorUserId,
        });
        return json({
          merged: true,
          ...summary,
          note: "The surviving contact's AI snapshot is now stale — call refresh_contact_summary for it.",
        });
      } catch (err) {
        return json({ error: (err as Error).message });
      }
    },
  );

  server.registerTool(
    "refresh_contact_summary",
    {
      annotations: {
        title: "Refresh AI snapshot",
        ...safeWrite,
        idempotentHint: true,
      },
      description:
        "Write the AI snapshot for a contact — a 2-3 sentence second-person summary ('You met her at...') distilled from their current memories, recent interactions, and open follow-ups (fetch via get_contact). This is a regenerable Layer-3 cache: safe to write without user approval, never a substitute for memories. Refresh it whenever it's stale.",
      inputSchema: {
        contactId: z.string().uuid(),
        summary: z
          .string()
          .min(1)
          .max(600)
          .describe("2-3 sentences, factual, second person, no filler"),
      },
    },
    async ({ contactId, summary }) => {
      const row = await repo.updateContactSummary(contactId, summary);
      return json(
        row
          ? { updated: true, contactId }
          : { error: "Contact not found" },
      );
    },
  );

  server.registerTool(
    "list_stale_summaries",
    {
      annotations: { title: "List stale snapshots", ...readOnly },
      description:
        "Contacts whose AI snapshot is missing or outdated (new facts landed since it was written). Refresh each with get_contact + refresh_contact_summary.",
      inputSchema: {},
    },
    async () => json(await repo.listStaleSummaries()),
  );

  server.registerTool(
    "add_memory",
    {
      annotations: { title: "Add memory", ...safeWrite },
      description:
        "Attach a structured memory (fact) to a contact. eventDate is when the thing happens/happened, resolved to an absolute date.",
      inputSchema: {
        contactId: z.string().uuid(),
        text: z.string(),
        category: z.enum(memoryCategory.enumValues).default("other"),
        eventDate: z.string().optional().describe("YYYY-MM-DD"),
        eventDatePrecision: z.enum(["exact", "month", "quarter", "year", "none"]).default("none"),
        sourceInteractionId: z.string().uuid().optional(),
      },
    },
    async (args) => {
      const memory = await repo.addMemory({ ...args, createdBy: "ai" });
      return json({ created: true, memoryId: memory.id });
    },
  );

  server.registerTool(
    "list_follow_ups",
    {
      annotations: { title: "List follow-ups", ...readOnly },
      description: "List all open follow-ups in the workspace, with their contacts.",
      inputSchema: {},
    },
    async () => json(await repo.listOpenFollowUps()),
  );

  server.registerTool(
    "add_follow_up",
    {
      annotations: { title: "Add follow-up", ...safeWrite },
      description: "Create a follow-up for a contact. reason is required — always explain why.",
      inputSchema: {
        contactId: z.string().uuid(),
        description: z.string(),
        reason: z.string(),
        dueDate: z.string().optional().describe("YYYY-MM-DD"),
        priority: z.enum(["low", "medium", "high"]).default("medium"),
      },
    },
    async (args) => {
      const followUp = await repo.addFollowUp({ ...args, createdBy: "ai" });
      return json({ created: true, followUpId: followUp.id });
    },
  );

  server.registerTool(
    "complete_follow_up",
    {
      annotations: { title: "Complete follow-up", ...safeWrite, idempotentHint: true },
      description: "Mark a follow-up as completed.",
      inputSchema: { followUpId: z.string().uuid() },
    },
    async ({ followUpId }) => {
      const followUp = await repo.completeFollowUp(followUpId);
      return json(followUp ? { completed: true } : { error: "Not found" });
    },
  );

  // ------------------------------------------------------------------ drafting
  //
  // The app has no server-side model. Drafting works the same way extraction
  // does: the app stages a request and assembles context, the connected client
  // writes the text back. Nothing here sends anything — the user always sends
  // the message themselves.

  server.registerTool(
    "list_pending_drafts",
    {
      annotations: { title: "List pending drafts", ...readOnly },
      description:
        "Message drafts the user has requested but that haven't been written yet. Check this at the start of a conversation and after any apply_extraction.",
      inputSchema: {},
    },
    async () => {
      const rows = await repo.listPendingDrafts();
      return json(
        rows.map((r) => ({
          draftId: r.draft.id,
          contact: `${r.contact.preferredName ?? r.contact.firstName} ${r.contact.lastName ?? ""}`.trim(),
          channel: r.draft.channel,
          channelLabel: r.draft.channelLabel,
          followUp: r.followUp?.description ?? null,
          instruction: r.draft.instruction,
          requestedAt: r.draft.requestedAt,
          next: "Call get_draft_context with this draftId, follow its instructions exactly, then save_message_draft.",
        })),
      );
    },
  );

  server.registerTool(
    "get_draft_context",
    {
      annotations: { title: "Get draft context", ...readOnly },
      description:
        "Everything needed to write one message draft: who they are, the ask, what's known about them, the last interaction, and the user's voice. Follow the returned `instructions` field exactly.",
      inputSchema: { draftId: z.string().uuid() },
    },
    async ({ draftId }) => {
      const ctx = await repo.buildDraftContext(draftId);
      if (!ctx) return json({ error: "Draft not found" });
      return json({
        instructions: buildDraftInstructions(ctx),
        context: renderDraftContext(ctx),
        channel: ctx.channel,
        needsSubject: CHANNEL_SPECS[ctx.channel].hasSubject,
        maxChars: CHANNEL_SPECS[ctx.channel].maxChars,
        memoryIds: ctx.memories.map((m) => m.id),
      });
    },
  );

  server.registerTool(
    "save_message_draft",
    {
      annotations: { title: "Save message draft", ...safeWrite },
      description:
        "Write the drafted message back. Body must be the message text ONLY — no preamble, no alternatives, no commentary; it is pasted as-is. This does not send anything.",
      inputSchema: {
        draftId: z.string().uuid(),
        body: z.string(),
        subject: z
          .string()
          .optional()
          .describe("Email only — required when the channel is email"),
      },
    },
    async ({ draftId, body, subject }) => {
      const ctx = await repo.buildDraftContext(draftId);
      if (ctx?.channel === "email" && !subject?.trim()) {
        return json({
          error:
            "This is an email draft — call save_message_draft again with a subject line as well as the body.",
        });
      }
      const row = await repo.saveDraftBody(draftId, {
        body,
        subject: subject ?? null,
        model: "mcp-client",
        contextJson: ctx ? { memoryIds: ctx.memories.map((m) => m.id) } : null,
      });
      if (!row) {
        return json({
          error:
            "No draft is waiting on that id — it may have already been written, edited, or sent. Do not retry.",
        });
      }
      return json({
        saved: true,
        draftId,
        note: "The user reviews and edits it, then sends it themselves.",
      });
    },
  );

  server.registerTool(
    "request_message_draft",
    {
      annotations: { title: "Request a message draft", ...safeWrite },
      description:
        "Queue a new draft for a follow-up (the contact comes from the follow-up), then immediately write it with get_draft_context + save_message_draft. If a draft is already in flight for this follow-up, that one is returned instead of creating a second.",
      inputSchema: {
        followUpId: z.string().uuid(),
        channel: z.enum(["text", "slack", "teams", "email", "other"]),
        channelLabel: z
          .string()
          .optional()
          .describe('Required when channel is "other" — e.g. "LinkedIn DM"'),
        instruction: z.string().optional(),
      },
    },
    async (args) => {
      const draft = await repo.createDraft({
        followUpId: args.followUpId,
        channel: args.channel,
        channelLabel: args.channelLabel ?? null,
        instruction: args.instruction ?? null,
        createdBy: "ai",
      });
      return json({
        created: true,
        draftId: draft.id,
        next: "Now call get_draft_context with this draftId.",
      });
    },
  );
}
