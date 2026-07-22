/**
 * Message drafting (spec: draft-message-spec.md).
 *
 * The load-bearing assertion in here is the negative one: a draft that was
 * never sent must never reach interactions.raw_source. That column is
 * immutable Layer 1 and extraction reads from it, so a fabricated message
 * would become fabricated memories.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("message drafts (integration)", async () => {
  const { db } = await import("@/db");
  const {
    contacts,
    followUps,
    interactionContacts,
    interactions,
    memories,
    messageDrafts,
    users,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");

  const run = Date.now();
  let userAId: string, userBId: string;
  let wsAId: string, wsBId: string;
  let repoA: ReturnType<typeof repoFor>;
  let repoB: ReturnType<typeof repoFor>;
  let contactId: string;

  beforeAll(async () => {
    const [userA] = await db
      .insert(users)
      .values({
        email: `draft-a-${run}@example.test`,
        timezone: "America/New_York",
        settingsJson: { drafting: { voice: "Direct and warm.", signOff: "— Test" } },
      })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: `draft-b-${run}@example.test`, timezone: "America/New_York" })
      .returning();
    userAId = userA.id;
    userBId = userB.id;
    const [wsA] = await db
      .insert(workspaces)
      .values({ ownerUserId: userAId, name: "Draft A" })
      .returning();
    const [wsB] = await db
      .insert(workspaces)
      .values({ ownerUserId: userBId, name: "Draft B" })
      .returning();
    wsAId = wsA.id;
    wsBId = wsB.id;
    repoA = repoFor(wsAId);
    repoB = repoFor(wsBId);

    const contact = await repoA.createContact({
      firstName: "Dana",
      lastName: "Reyes",
      emails: [`dana-${run}@example.test`],
      phone: "+15551234567",
      currentCompany: "Northwind",
      currentRole: "VP Product",
    });
    contactId = contact.id;
    await repoA.addMemory({
      contactId,
      text: "Taking a three-month sabbatical starting in September",
      category: "career",
    });
  });

  afterAll(async () => {
    for (const wsId of [wsAId, wsBId]) {
      if (!wsId) continue;
      await db.delete(messageDrafts).where(eq(messageDrafts.workspaceId, wsId));
      await db.delete(followUps).where(eq(followUps.workspaceId, wsId));
      await db.delete(memories).where(eq(memories.workspaceId, wsId));
      await db
        .delete(interactionContacts)
        .where(eq(interactionContacts.workspaceId, wsId));
      await db.delete(interactions).where(eq(interactions.workspaceId, wsId));
      await db.delete(contacts).where(eq(contacts.workspaceId, wsId));
      await db.delete(workspaces).where(eq(workspaces.id, wsId));
    }
    await db
      .delete(users)
      .where(inArray(users.id, [userAId, userBId].filter(Boolean)));
  });

  async function newDraft(description = "Send Dana the deck") {
    const followUp = await repoA.addFollowUp({
      contactId,
      description,
      reason: "She asked for it after the demo",
    });
    const draft = await repoA.createDraft({
      contactId,
      followUpId: followUp.id,
      channel: "email",
    });
    return { followUp, draft };
  }

  it("assembles context from memories, the ask, and the user's voice", async () => {
    const { draft } = await newDraft();
    const ctx = await repoA.buildDraftContext(draft.id);

    expect(ctx).not.toBeNull();
    expect(ctx!.contact.name).toBe("Dana Reyes");
    expect(ctx!.followUp?.description).toBe("Send Dana the deck");
    expect(ctx!.followUp?.reason).toBe("She asked for it after the demo");
    expect(ctx!.memories.map((m) => m.text)).toContain(
      "Taking a three-month sabbatical starting in September",
    );
    expect(ctx!.voice.signOff).toBe("— Test");
  });

  it("saves the model's text into both body and ai_body, once", async () => {
    const { draft } = await newDraft();
    const saved = await repoA.saveDraftBody(draft.id, {
      body: "Hi Dana — sending the deck today.",
      subject: "The deck",
    });
    expect(saved?.status).toBe("drafted");
    expect(saved?.body).toBe("Hi Dana — sending the deck today.");
    expect(saved?.aiBody).toBe("Hi Dana — sending the deck today.");

    // A late second write must not clobber text the user may have edited.
    const again = await repoA.saveDraftBody(draft.id, { body: "Different text" });
    expect(again).toBeNull();
  });

  it("user edits change body but never ai_body or status", async () => {
    const { draft } = await newDraft();
    await repoA.saveDraftBody(draft.id, { body: "Original text" });
    const edited = await repoA.updateDraftText(draft.id, { body: "My rewrite" });

    expect(edited?.body).toBe("My rewrite");
    expect(edited?.aiBody).toBe("Original text");
    expect(edited?.status).toBe("drafted");

    const reverted = await repoA.revertDraft(draft.id);
    expect(reverted?.body).toBe("Original text");
  });

  it('"sent as written" logs the body verbatim and closes the follow-up', async () => {
    const { followUp, draft } = await newDraft("Send Dana the Q3 numbers");
    const body = `Hi Dana — here are the Q3 numbers. ${run}`;
    await repoA.saveDraftBody(draft.id, { body });

    const result = await repoA.markDraftSent(draft.id, { kind: "as_written" });

    expect(result?.draft.status).toBe("sent");
    expect(result?.interaction?.rawSource).toBe(body);
    expect(result?.interaction?.type).toBe("email");
    // Outbound text is already-known — it must not enter the extraction queue.
    expect(result?.interaction?.extractionStatus).toBe("skipped");

    const [row] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, followUp.id));
    expect(row.status).toBe("completed");
  });

  it('"reached out another way" writes NOTHING to Layer 1', async () => {
    const { followUp, draft } = await newDraft("Congratulate Dana");
    const body = `An AI draft that was never sent ${run}`;
    await repoA.saveDraftBody(draft.id, { body });

    const before = await repoA.listInteractions();
    const result = await repoA.markDraftSent(draft.id, { kind: "other_channel" });

    expect(result?.draft.status).toBe("sent_other");
    expect(result?.interaction).toBeNull();

    // The unsent draft text must appear nowhere in interactions.
    const after = await repoA.listInteractions();
    expect(after).toHaveLength(before.length);
    expect(after.some((i) => i.rawSource.includes(body))).toBe(false);

    // The follow-up still closes — that part always happens.
    const [row] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, followUp.id));
    expect(row.status).toBe("completed");
  });

  it('"sent something different" logs only the pasted text, and nothing when blank', async () => {
    const { draft } = await newDraft("Ping Dana about the offsite");
    const aiText = `AI wrote this and it never went out ${run}`;
    await repoA.saveDraftBody(draft.id, { body: aiText });

    const actual = `Hey Dana, quick one about the offsite ${run}`;
    const result = await repoA.markDraftSent(draft.id, {
      kind: "different",
      text: actual,
    });
    expect(result?.draft.status).toBe("sent_other");
    expect(result?.interaction?.rawSource).toBe(actual);

    // Blank paste = nothing logged. Failing in the safe direction.
    const { draft: draft2 } = await newDraft("Second ping");
    await repoA.saveDraftBody(draft2.id, { body: `Another unsent draft ${run}` });
    const blank = await repoA.markDraftSent(draft2.id, {
      kind: "different",
      text: "   ",
    });
    expect(blank?.draft.status).toBe("sent_other");
    expect(blank?.interaction).toBeNull();
  });

  it("is idempotent — a second mark-sent does not double-log", async () => {
    const { draft } = await newDraft("Thank Dana");
    await repoA.saveDraftBody(draft.id, { body: `Thanks Dana ${run}` });
    await repoA.markDraftSent(draft.id, { kind: "as_written" });

    const before = await repoA.listInteractions();
    const second = await repoA.markDraftSent(draft.id, { kind: "as_written" });
    expect(second?.alreadyClosed).toBe(true);
    expect(second?.interaction).toBeNull();
    expect(await repoA.listInteractions()).toHaveLength(before.length);
  });

  it("refuses to mark a never-written draft as sent 'as written'", async () => {
    const { draft } = await newDraft("Still waiting on the AI");
    // status is "requested" — there is no body "as written" could describe.
    await expect(
      repoA.markDraftSent(draft.id, { kind: "as_written" }),
    ).rejects.toThrow(/written draft/i);
  });

  it("Done on a never-written draft: honest outcomes still close it", async () => {
    // You called them before the AI ever wrote the draft. The follow-up
    // completes, the draft closes, and nothing fabricated reaches Layer 1.
    const { followUp, draft } = await newDraft("Handled before drafting");
    const before = await repoA.listInteractions();

    const result = await repoA.markDraftSent(draft.id, { kind: "other_channel" });
    expect(result?.draft.status).toBe("sent_other");
    expect(result?.interaction).toBeNull();
    expect(await repoA.listInteractions()).toHaveLength(before.length);

    const [row] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, followUp.id));
    expect(row.status).toBe("completed");
  });

  it("a sent draft is a closed record — no discard, revert, or regenerate", async () => {
    const { draft } = await newDraft("Locking the record");
    await repoA.saveDraftBody(draft.id, { body: `Sent text ${run}` });
    await repoA.markDraftSent(draft.id, { kind: "as_written" });

    expect(await repoA.discardDraft(draft.id)).toBeNull();
    expect(await repoA.revertDraft(draft.id)).toBeNull();
    expect(await repoA.regenerateDraft(draft.id)).toBeNull();

    const after = await repoA.getDraft(draft.id);
    expect(after?.draft.status).toBe("sent");
    expect(after?.draft.body).toBe(`Sent text ${run}`);
  });

  it("a discarded draft stays discarded", async () => {
    const { draft } = await newDraft("Changed my mind");
    await repoA.saveDraftBody(draft.id, { body: "never mind" });
    await repoA.discardDraft(draft.id);

    expect(await repoA.regenerateDraft(draft.id)).toBeNull();
    await expect(
      repoA.markDraftSent(draft.id, { kind: "as_written" }),
    ).rejects.toThrow(/discarded/i);
  });

  it("is idempotent per follow-up — a second create returns the draft in flight", async () => {
    const { followUp, draft } = await newDraft("No forking");
    const second = await repoA.createDraft({
      contactId,
      followUpId: followUp.id,
      channel: "text", // even with a different channel, the live draft wins
    });
    expect(second.id).toBe(draft.id);
    expect(second.channel).toBe("email");
  });

  it("takes the contact from the follow-up, not the caller", async () => {
    const other = await repoA.createContact({
      firstName: "Wrong",
      lastName: "Person",
    });
    const followUp = await repoA.addFollowUp({
      contactId, // Dana's follow-up
      description: "Contact binding check",
      reason: "test",
    });
    const draft = await repoA.createDraft({
      contactId: other.id, // caller lies about the contact
      followUpId: followUp.id,
      channel: "email",
    });
    expect(draft.contactId).toBe(contactId);
  });

  it("refuses to draft against a closed follow-up", async () => {
    const followUp = await repoA.addFollowUp({
      contactId,
      description: "Already handled",
      reason: "test",
    });
    await repoA.completeFollowUp(followUp.id);

    await expect(
      repoA.createDraft({ contactId, followUpId: followUp.id, channel: "text" }),
    ).rejects.toThrow(/already closed/i);
  });

  it("keeps drafts inside their workspace", async () => {
    const { draft } = await newDraft("Isolation check");
    await repoA.saveDraftBody(draft.id, { body: "private text" });

    expect(await repoB.getDraft(draft.id)).toBeNull();
    expect(await repoB.buildDraftContext(draft.id)).toBeNull();
    expect(await repoB.listPendingDrafts()).toHaveLength(0);
    expect(await repoB.saveDraftBody(draft.id, { body: "hijack" })).toBeNull();
    expect(await repoB.updateDraftText(draft.id, { body: "hijack" })).toBeNull();
    expect(await repoB.markDraftSent(draft.id, { kind: "as_written" })).toBeNull();

    // A still has the untouched text.
    const mine = await repoA.getDraft(draft.id);
    expect(mine?.draft.body).toBe("private text");
  });

  it("lists only pending drafts, and drops them once written", async () => {
    const { draft } = await newDraft("Pending check");
    const pending = await repoA.listPendingDrafts();
    expect(pending.some((p) => p.draft.id === draft.id)).toBe(true);

    await repoA.saveDraftBody(draft.id, { body: "now written" });
    const after = await repoA.listPendingDrafts();
    expect(after.some((p) => p.draft.id === draft.id)).toBe(false);
  });
});
