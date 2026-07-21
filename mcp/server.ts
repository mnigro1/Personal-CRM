/**
 * Stdio MCP server exposing the CRM to Claude Code / Claude Desktop.
 *
 * Reuses the same workspace-scoped repository layer as the web app, so every
 * query is confined to one workspace — the one belonging to MCP_USER_EMAIL.
 *
 * Run: npm run mcp   (or: npx tsx mcp/server.ts)
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(import.meta.dirname, "../.env.local") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { eq } from "drizzle-orm";

async function main() {
  // Imported dynamically so .env.local is loaded before the db pool reads
  // DATABASE_URL.
  const { db } = await import("../src/db");
  const { users, workspaces, interactionType, sourceType, memoryCategory } =
    await import("../src/db/schema");
  const { repoFor } = await import("../src/db/repo");

  const email = process.env.MCP_USER_EMAIL;
  if (!email) throw new Error("MCP_USER_EMAIL is not set");

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No user found for ${email} — sign in to the web app once first`);
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, user.id));
  if (!workspace) throw new Error(`No workspace for ${email}`);

  const repo = repoFor(workspace.id);

  const server = new McpServer({ name: "personal-crm", version: "0.1.0" });

  const json = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  server.registerTool(
    "search_contacts",
    {
      description:
        "Search contacts in the workspace. All filters optional; returns matching contacts with their tags.",
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
          tags: c.tags.map((t) => t.name),
          lastInteractionDate: c.lastInteractionDate,
        })),
      );
    },
  );

  server.registerTool(
    "get_contact",
    {
      description:
        "Full record for one contact: fields, memories, interactions (with raw source), open follow-ups, tags.",
      inputSchema: { contactId: z.string().uuid() },
    },
    async ({ contactId }) => {
      const contact = await repo.getContact(contactId);
      if (!contact) return json({ error: "Contact not found" });
      return json(contact);
    },
  );

  server.registerTool(
    "create_contact",
    {
      description: "Create a new contact in the workspace.",
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
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ tags: tagNames, emails, ...fields }) => {
      const contact = await repo.createContact({
        ...fields,
        emails: emails ?? [],
      });
      if (tagNames?.length) await repo.setContactTags(contact.id, tagNames);
      return json({ created: true, contactId: contact.id });
    },
  );

  server.registerTool(
    "log_interaction",
    {
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
          : "Saved. Run get_extraction_context and submit a proposal (see mcp/EXTRACTION.md).",
      });
    },
  );

  // ------------------------------------------------------------------------
  // Extraction pipeline (Phase 2): Claude is the extractor. Workflow:
  // list_pending_captures → get_extraction_context → submit_extraction_proposal
  // → user approves (web review screen, or in chat via apply_extraction).
  // ------------------------------------------------------------------------

  server.registerTool(
    "list_pending_captures",
    {
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
      description:
        "Everything needed to extract one interaction: raw source, user timezone (anchor all relative dates to it), contact roster for entity resolution, current memories of linked contacts (facts already known), existing tags (reuse, don't invent), open follow-ups. Read mcp/EXTRACTION.md for the full rules, then call submit_extraction_proposal.",
      inputSchema: { interactionId: z.string().uuid() },
    },
    async ({ interactionId }) => {
      const context = await repo.getExtractionContext(interactionId);
      if (!context) return json({ error: "Interaction not found" });
      return json(context);
    },
  );

  server.registerTool(
    "submit_extraction_proposal",
    {
      description:
        "Stage an extraction proposal for user review (never applies anything directly). The proposal JSON contract is defined in mcp/EXTRACTION.md. Returns dedup flags and blocking items (ambiguous/new bindings) — relay those to the user. The user approves on the web review screen, or in chat via apply_extraction.",
      inputSchema: {
        interactionId: z.string().uuid(),
        proposal: z
          .record(z.string(), z.unknown())
          .describe("Proposal JSON per mcp/EXTRACTION.md"),
        model: z.string().default("claude-via-mcp").describe("Your model id"),
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
      const result = await repo.applyExtraction(extractionId, selections, user.id);
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
    async ({ batchId }) => json(await repo.undoBatch(batchId, user.id)),
  );

  server.registerTool(
    "add_memory",
    {
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
      description: "List all open follow-ups in the workspace, with their contacts.",
      inputSchema: {},
    },
    async () => json(await repo.listOpenFollowUps()),
  );

  server.registerTool(
    "add_follow_up",
    {
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
      description: "Mark a follow-up as completed.",
      inputSchema: { followUpId: z.string().uuid() },
    },
    async ({ followUpId }) => {
      const followUp = await repo.completeFollowUp(followUpId);
      return json(followUp ? { completed: true } : { error: "Not found" });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`personal-crm MCP server ready (workspace: ${workspace.name})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
