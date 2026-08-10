/**
 * Hosted MCP endpoint tests: token auth, workspace isolation over HTTP,
 * revocation. Calls the route handler directly. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("hosted MCP endpoint (integration)", async () => {
  const { db } = await import("@/db");
  const { contacts, followUps, mcpTokens, messageDrafts, users, workspaces } =
    await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");
  const { createMcpToken, revokeMcpToken, listMcpTokens } = await import("@/db/tokens");
  const { POST } = await import("@/app/api/mcp/[token]/route");

  const run = Date.now();
  let userAId: string, userBId: string, wsAId: string, wsBId: string;
  let tokenA: string, tokenB: string;

  const rpc = async (
    token: string,
    method: string,
    params: Record<string, unknown> = {},
    id = 1,
  ) => {
    const req = new Request(`http://localhost/api/mcp/${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const res = await POST(req, { params: Promise.resolve({ token }) });
    return { status: res.status, body: res.status === 401 ? await res.json() : await res.json() };
  };

  const initialize = (token: string) =>
    rpc(token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    });

  beforeAll(async () => {
    const [userA] = await db
      .insert(users)
      .values({ email: `mcp-a-${run}@example.test`, timezone: "UTC" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: `mcp-b-${run}@example.test`, timezone: "UTC" })
      .returning();
    userAId = userA.id;
    userBId = userB.id;
    const [wsA] = await db
      .insert(workspaces)
      .values({ ownerUserId: userAId, name: "MCP A" })
      .returning();
    const [wsB] = await db
      .insert(workspaces)
      .values({ ownerUserId: userBId, name: "MCP B" })
      .returning();
    wsAId = wsA.id;
    wsBId = wsB.id;

    await repoFor(wsAId).createContact({ firstName: "AliceOnly", location: "Boston" });
    await repoFor(wsBId).createContact({ firstName: "BobOnly", location: "Denver" });

    tokenA = await createMcpToken(userAId, "test A");
    tokenB = await createMcpToken(userBId, "test B");
  });

  afterAll(async () => {
    for (const ws of [wsAId, wsBId]) {
      await db.delete(messageDrafts).where(eq(messageDrafts.workspaceId, ws));
      await db.delete(followUps).where(eq(followUps.workspaceId, ws));
      await db.delete(contacts).where(eq(contacts.workspaceId, ws));
      await db.delete(workspaces).where(eq(workspaces.id, ws));
    }
    await db
      .delete(mcpTokens)
      .where(inArray(mcpTokens.userId, [userAId, userBId]));
    await db.delete(users).where(inArray(users.id, [userAId, userBId]));
  });

  it("rejects unknown tokens with 401", async () => {
    const res = await initialize("crm_not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("initializes and lists tools with a valid token", async () => {
    const init = await initialize(tokenA);
    expect(init.status).toBe(200);
    const res = await rpc(tokenA, "tools/list", {}, 2);
    expect(res.status).toBe(200);
    const tools = res.body.result.tools as { name: string; annotations?: Record<string, unknown> }[];
    const names = tools.map((t) => t.name);
    expect(names).toContain("search_contacts");
    expect(names).toContain("submit_extraction_proposal");
    // Tags were removed as a feature — these tools must not come back.
    for (const t of ["list_tags", "merge_tags", "set_contact_tags", "delete_tag"]) {
      expect(names).not.toContain(t);
    }

    // Safety hints so clients auto-run low-risk tools instead of prompting.
    const get = tools.find((t) => t.name === "get_contact");
    expect(get?.annotations?.readOnlyHint).toBe(true);
    const refresh = tools.find((t) => t.name === "refresh_contact_summary");
    expect(refresh?.annotations?.destructiveHint).toBe(false);
    // The apply step keeps its approval checkpoint — no low-risk hint.
    const apply = tools.find((t) => t.name === "apply_extraction");
    expect(apply?.annotations?.readOnlyHint).toBeUndefined();
  });

  it("delivers per-user server instructions at initialize", async () => {
    const init = await initialize(tokenA);
    const instructions = init.body.result.instructions as string;
    expect(instructions).toContain("personal relationship CRM");
    // Personalized with this user's timezone (test users are UTC).
    expect(instructions).toContain("timezone is UTC");
    expect(instructions).toContain("Never guess between two similar people");
    expect(instructions).toContain("apply_extraction ONLY after");
    // Proactive processing default.
    expect(instructions).toContain("PROACTIVELY PROCESS CAPTURES");
    expect(instructions).toContain("refresh_contact_summary");
  });

  it("scopes each token to its own workspace", async () => {
    const a = await rpc(tokenA, "tools/call", {
      name: "search_contacts",
      arguments: {},
    }, 3);
    const aContacts = JSON.parse(a.body.result.content[0].text);
    expect(aContacts.map((c: { name: string }) => c.name)).toEqual(["AliceOnly"]);

    const b = await rpc(tokenB, "tools/call", {
      name: "search_contacts",
      arguments: {},
    }, 4);
    const bContacts = JSON.parse(b.body.result.content[0].text);
    expect(bContacts.map((c: { name: string }) => c.name)).toEqual(["BobOnly"]);
  });

  it("get_contact flags a stale/missing snapshot so the AI refreshes it", async () => {
    const repoA = repoFor(wsAId);
    const c = await repoA.createContact({ firstName: "NeedsSnapshot" });
    await repoA.addMemory({ contactId: c.id, text: "Loves hiking", category: "interests" });

    const res = await rpc(tokenA, "tools/call", {
      name: "get_contact",
      arguments: { contactId: c.id },
    }, 6);
    const payload = JSON.parse(res.body.result.content[0].text);
    expect(payload.snapshotStale).toBe(true);
    expect(payload.action).toContain("refresh_contact_summary");

    // Once a summary is written, the nudge disappears.
    await repoA.updateContactSummary(c.id, "You met NeedsSnapshot. They love hiking.");
    const res2 = await rpc(tokenA, "tools/call", {
      name: "get_contact",
      arguments: { contactId: c.id },
    }, 7);
    const payload2 = JSON.parse(res2.body.result.content[0].text);
    expect(payload2.snapshotStale).toBe(false);
    expect(payload2.action).toBeUndefined();
  });

  it("create_contact blocks likely duplicates until forced", async () => {
    const blocked = await rpc(tokenA, "tools/call", {
      name: "create_contact",
      arguments: { firstName: "AliceOnly" },
    }, 8);
    const payload = JSON.parse(blocked.body.result.content[0].text);
    expect(payload.blocked).toBe(true);
    expect(payload.possibleDuplicates[0].name).toBe("AliceOnly");

    const forced = await rpc(tokenA, "tools/call", {
      name: "create_contact",
      arguments: { firstName: "AliceOnly", force: true },
    }, 9);
    const created = JSON.parse(forced.body.result.content[0].text);
    expect(created.created).toBe(true);
  });

  it("a WRITTEN draft is visible to the AI, not just an empty pending list", async () => {
    // The failure this guards: an agent called list_pending_drafts, saw [],
    // concluded no drafts existed, and rewrote drafts the user already had.
    // A written draft is absent from that list BY DESIGN, so every other
    // read path has to make its existence obvious.
    const repo = repoFor(wsAId);
    const contact = await repo.createContact({ firstName: "DraftSubject" });
    const followUp = await repo.addFollowUp({
      contactId: contact.id,
      description: "Send the thing",
      reason: "they asked",
    });
    const draft = await repo.createDraft({
      contactId: contact.id,
      followUpId: followUp.id,
      channel: "email",
    });
    await repo.saveDraftBody(draft.id, {
      body: "Existing text the user already has.",
      subject: "Existing subject",
    });

    // The misleading signal, asserted so nobody "fixes" it by accident.
    const pending = await rpc(tokenA, "tools/call", {
      name: "list_pending_drafts",
      arguments: {},
    }, 20);
    expect(JSON.parse(pending.body.result.content[0].text)).toHaveLength(0);

    // list_follow_ups must show the draft exists and is written.
    const list = await rpc(tokenA, "tools/call", {
      name: "list_follow_ups",
      arguments: {},
    }, 21);
    const row = JSON.parse(list.body.result.content[0].text).find(
      (r: { followUp: { id: string } }) => r.followUp.id === followUp.id,
    );
    expect(row.draft).not.toBeNull();
    expect(row.draft.written).toBe(true);

    // get_draft_context must hand back the actual text to read.
    const ctx = await rpc(tokenA, "tools/call", {
      name: "get_draft_context",
      arguments: { draftId: draft.id },
    }, 22);
    const payload = JSON.parse(ctx.body.result.content[0].text);
    expect(payload.alreadyWritten).toBe(true);
    expect(payload.currentBody).toBe("Existing text the user already has.");
    expect(payload.currentSubject).toBe("Existing subject");
    expect(payload.action).toMatch(/do not overwrite it reflexively/i);

    // Reopening must report what it is about to replace.
    const reopen = await rpc(tokenA, "tools/call", {
      name: "request_message_draft",
      arguments: { followUpId: followUp.id, channel: "email" },
    }, 23);
    const reopened = JSON.parse(reopen.body.result.content[0].text);
    expect(reopened.reopenedExisting).toBe(true);
    expect(reopened.previousBody).toBe("Existing text the user already has.");
  });

  it("revoked tokens stop working immediately", async () => {
    const [row] = await listMcpTokens(userBId);
    await revokeMcpToken(userBId, row.id);
    const res = await rpc(tokenB, "tools/list", {}, 5);
    expect(res.status).toBe(401);
  });
});
