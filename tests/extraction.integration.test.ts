/**
 * Phase 2 engine tests: proposal staging, dedup flagging, apply with batched
 * revisions, undo semantics. Real database; skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("extraction pipeline (integration)", async () => {
  const { db } = await import("@/db");
  const {
    contactTags,
    contacts,
    extractions,
    followUps,
    interactionContacts,
    interactions,
    memories,
    revisions,
    tags,
    users,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");

  const run = Date.now();
  let userId: string;
  let wsId: string;
  let otherWsId: string;
  let otherUserId: string;
  let repo: ReturnType<typeof repoFor>;

  const mkInteraction = async (text: string, contactIds: string[] = []) => {
    const res = await repo.createInteraction({
      type: "coffee",
      occurredAt: new Date("2026-07-15T14:00:00Z"),
      rawSource: text,
      sourceType: "manual_note",
      extractionStatus: "pending",
      contactIds,
    });
    return res.interaction;
  };

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `ext-${run}@example.test`, timezone: "America/New_York" })
      .returning();
    userId = user.id;
    const [ws] = await db
      .insert(workspaces)
      .values({ ownerUserId: userId, name: "Ext Test" })
      .returning();
    wsId = ws.id;
    repo = repoFor(wsId);

    const [otherUser] = await db
      .insert(users)
      .values({ email: `ext-other-${run}@example.test`, timezone: "UTC" })
      .returning();
    otherUserId = otherUser.id;
    const [otherWs] = await db
      .insert(workspaces)
      .values({ ownerUserId: otherUserId, name: "Ext Other" })
      .returning();
    otherWsId = otherWs.id;
  });

  afterAll(async () => {
    for (const ws of [wsId, otherWsId]) {
      if (!ws) continue;
      await db.delete(revisions).where(eq(revisions.workspaceId, ws));
      await db.delete(extractions).where(eq(extractions.workspaceId, ws));
      await db.delete(contactTags).where(eq(contactTags.workspaceId, ws));
      await db.delete(followUps).where(eq(followUps.workspaceId, ws));
      await db.delete(memories).where(eq(memories.workspaceId, ws));
      await db
        .delete(interactionContacts)
        .where(eq(interactionContacts.workspaceId, ws));
      await db.delete(interactions).where(eq(interactions.workspaceId, ws));
      await db.delete(tags).where(eq(tags.workspaceId, ws));
      await db.delete(contacts).where(eq(contacts.workspaceId, ws));
      await db.delete(workspaces).where(eq(workspaces.id, ws));
    }
    await db
      .delete(users)
      .where(inArray(users.id, [userId, otherUserId].filter(Boolean)));
  });

  it("rejects malformed proposals and cross-workspace references", async () => {
    const interaction = await mkInteraction(`malformed test ${run}`);

    await expect(
      repo.saveProposal(interaction.id, { new_memories: "not-an-array" }, { model: "test" }),
    ).rejects.toThrow();

    // Memory belonging to another workspace must be rejected.
    const otherRepo = repoFor(otherWsId);
    const foreignContact = await otherRepo.createContact({ firstName: "Foreign" });
    const foreignMemory = await otherRepo.addMemory({
      contactId: foreignContact.id,
      text: "foreign fact",
      category: "other",
    });
    await expect(
      repo.saveProposal(
        interaction.id,
        { already_known: [{ existing_memory_id: foreignMemory.id }] },
        { model: "test" },
      ),
    ).rejects.toThrow(/not in this workspace/);
  });

  it("flags probable duplicate memories via trigram similarity", async () => {
    const contact = await repo.createContact({ firstName: "Dup", lastName: "Target" });
    await repo.addMemory({
      contactId: contact.id,
      text: "Interested in healthcare entrepreneurship",
      category: "goals",
    });
    const interaction = await mkInteraction(`dup test ${run}`, [contact.id]);

    const { staged } = await repo.saveProposal(
      interaction.id,
      {
        contact_bindings: [
          { mention: "Dup", status: "confident", contact_id: contact.id },
        ],
        new_memories: [
          { contact: contact.id, text: "Interested in healthcare entrepreneurship.", category: "goals" },
          { contact: contact.id, text: "Training for the Boston Marathon", category: "interests" },
        ],
      },
      { model: "test" },
    );

    expect(staged.flags.new_memories[0]?.probableDuplicate).toBe(true);
    expect(staged.flags.new_memories[1]).toBeUndefined();
  });

  it("applies a full proposal atomically with a revisions batch, then undoes it", async () => {
    const sarah = await repo.createContact({ firstName: "Apply", lastName: "Sarah", currentCompany: "Bain" });
    const existing = await repo.addMemory({
      contactId: sarah.id,
      text: "Works at Bain as a consultant",
      category: "career",
    });
    const known = await repo.addMemory({
      contactId: sarah.id,
      text: "Interested in climate technology",
      category: "interests",
    });
    const interaction = await mkInteraction(`apply test ${run}`, [sarah.id]);

    const { extraction } = await repo.saveProposal(
      interaction.id,
      {
        interaction: { summary: "Career-change conversation" },
        contact_bindings: [
          { mention: "Sarah", status: "confident", contact_id: sarah.id, confidence: 0.95 },
        ],
        new_memories: [
          { contact: sarah.id, text: "Left Bain to found a healthcare startup", category: "career" },
          { contact: sarah.id, text: "Moving to Denver in September", category: "geography", event_date: "2026-09-01", event_date_precision: "month" },
        ],
        supersessions: [
          { existing_memory_id: existing.id, reason: "She left Bain", replacement_memory_index: 0 },
        ],
        already_known: [{ existing_memory_id: known.id }],
        follow_ups: [
          { contact: sarah.id, description: "Check in after Denver move", reason: "She lands in September", due_date: "2026-10-01" },
        ],
        contact_field_updates: [
          { contact_id: sarah.id, field: "current_company", old_value: "Bain", new_value: "Stealth Healthcare Startup" },
        ],
      },
      { model: "test" },
    );

    const result = await repo.applyExtraction(
      extraction.id,
      {
        new_memories: [0, 1],
        supersessions: [0],
        already_known: [0],
        follow_ups: [0],
        contact_field_updates: [0],
      },
      userId,
    );

    expect(result.counts.memoriesAdded).toBe(2);
    expect(result.counts.memoriesSuperseded).toBe(1);
    expect(result.counts.memoriesConfirmed).toBe(1);
    expect(result.counts.followUpsAdded).toBe(1);
    expect(result.counts.fieldsUpdated).toBe(1);

    const full = (await repo.getContact(sarah.id))!;
    expect(full.currentCompany).toBe("Stealth Healthcare Startup");
    expect(full.aiSummaryStale).toBe(true);
    const newMem = full.memories.find((m) => m.text.includes("founded") || m.text.includes("found a healthcare"));
    expect(newMem?.createdBy).toBe("ai");
    expect(newMem?.sourceInteractionId).toBe(interaction.id);
    const superseded = full.memories.find((m) => m.id === existing.id)!;
    expect(superseded.status).toBe("superseded");
    expect(superseded.supersededByMemoryId).toBe(newMem!.id);
    const confirmed = full.memories.find((m) => m.id === known.id)!;
    expect(confirmed.lastConfirmedAt).not.toBeNull();
    // Old company value preserved as a historical memory.
    expect(
      full.memories.some((m) => m.status === "historical" && m.text.includes("Bain")),
    ).toBe(true);

    const batch = await repo.getRevisionsForBatch(result.batchId);
    expect(batch.length).toBeGreaterThanOrEqual(7);

    // Full undo: everything reverts (nothing edited since).
    const undo = await repo.undoBatch(result.batchId, userId);
    expect(undo.skipped).toBe(0);
    expect(undo.reverted).toBe(batch.length);

    const after = (await repo.getContact(sarah.id))!;
    expect(after.currentCompany).toBe("Bain");
    const restored = after.memories.find((m) => m.id === existing.id)!;
    expect(restored.status).toBe("current");
    expect(restored.supersededByMemoryId).toBeNull();
    expect(after.memories.some((m) => m.text.includes("Denver"))).toBe(false);
    expect(after.followUps).toHaveLength(0);
    expect((await repo.getContact(sarah.id))!.memories.find((m) => m.id === known.id)!.lastConfirmedAt).toBeNull();

    // Extraction re-opened for re-apply.
    const reopened = await repo.getExtraction(extraction.id);
    expect(reopened!.extraction.status).toBe("proposed");
  });

  it("closes an open follow-up the interaction satisfies, and undo reopens it", async () => {
    // The reported gap: pasting a message you already sent left the follow-up
    // open, so Home kept claiming you still owed it.
    const dana = await repo.createContact({ firstName: "Closeout", lastName: "Dana" });
    const followUp = await repo.addFollowUp({
      contactId: dana.id,
      description: "Send Dana the promised update",
      reason: "Promised it in February",
    });
    const interaction = await mkInteraction(
      `Pasted the message I sent Dana ${run}`,
      [dana.id],
    );

    const { extraction } = await repo.saveProposal(
      interaction.id,
      {
        contact_bindings: [
          { mention: "Dana", status: "confident", contact_id: dana.id, confidence: 0.99 },
        ],
        completed_follow_ups: [
          {
            follow_up_id: followUp.id,
            evidence: "The pasted text is the update she was waiting on",
          },
        ],
      },
      { model: "test" },
    );

    const result = await repo.applyExtraction(
      extraction.id,
      { completed_follow_ups: [0] },
      userId,
    );
    expect(result.counts.followUpsCompleted).toBe(1);

    const [closed] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, followUp.id));
    expect(closed.status).toBe("completed");
    expect(closed.completedAt).not.toBeNull();
    // Gone from the inbox, which is the whole point.
    expect((await repo.listOpenFollowUps()).map((r) => r.followUp.id)).not.toContain(
      followUp.id,
    );

    // Undo has to put it back, or a wrong close silently loses the obligation.
    await repo.undoBatch(result.batchId, userId);
    const [reopened] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, followUp.id));
    expect(reopened.status).toBe("open");
    expect(reopened.completedAt).toBeNull();
    expect((await repo.listOpenFollowUps()).map((r) => r.followUp.id)).toContain(
      followUp.id,
    );
  });

  it("will not close a follow-up from another workspace", async () => {
    const mine = await repo.createContact({ firstName: "Scoped", lastName: "Mine" });
    const otherRepo = repoFor(otherWsId);
    const theirs = await otherRepo.createContact({ firstName: "Scoped", lastName: "Theirs" });
    const foreign = await otherRepo.addFollowUp({
      contactId: theirs.id,
      description: "Not yours to close",
      reason: "test",
    });
    const interaction = await mkInteraction(`cross ws close ${run}`, [mine.id]);

    await expect(
      repo.saveProposal(
        interaction.id,
        {
          contact_bindings: [
            { mention: "Scoped", status: "confident", contact_id: mine.id, confidence: 0.99 },
          ],
          completed_follow_ups: [
            { follow_up_id: foreign.id, evidence: "should be rejected" },
          ],
        },
        { model: "test" },
      ),
    ).rejects.toThrow(/follow-up not in this workspace/);

    const [untouched] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, foreign.id));
    expect(untouched.status).toBe("open");
  });

  it("undo skips rows the user edited after apply and reports it", async () => {
    const contact = await repo.createContact({ firstName: "EditRace" });
    const interaction = await mkInteraction(`edit race ${run}`, [contact.id]);
    const { extraction } = await repo.saveProposal(
      interaction.id,
      {
        new_memories: [
          { contact: contact.id, text: "Fact one about EditRace", category: "other" },
          { contact: contact.id, text: "Fact two about EditRace", category: "other" },
        ],
      },
      { model: "test" },
    );
    const { batchId } = await repo.applyExtraction(
      extraction.id,
      { new_memories: [0, 1] },
      userId,
    );

    const applied = (await repo.getContact(contact.id))!.memories;
    const edited = applied.find((m) => m.text === "Fact one about EditRace")!;
    await repo.updateMemory(edited.id, { text: "Fact one, corrected by user" }, userId);

    const undo = await repo.undoBatch(batchId, userId);
    expect(undo.skipped).toBe(1);
    expect(undo.reverted).toBeGreaterThanOrEqual(1);

    const after = (await repo.getContact(contact.id))!.memories;
    expect(after.some((m) => m.text === "Fact one, corrected by user")).toBe(true);
    expect(after.some((m) => m.text === "Fact two about EditRace")).toBe(false);
  });

  it("blocks apply on unresolved ambiguous or new bindings, applies on resolution", async () => {
    const interaction = await mkInteraction(`ambiguous test ${run}`);
    const { extraction } = await repo.saveProposal(
      interaction.id,
      {
        contact_bindings: [
          {
            mention: "Jordan",
            status: "new",
            new_contact: { first_name: "Jordan", last_name: "Rivers", current_company: "Acme Water" },
          },
        ],
        new_memories: [
          { contact: "Jordan", text: "Runs a wastewater business in Ohio", category: "career" },
        ],
      },
      { model: "test" },
    );

    await expect(
      repo.applyExtraction(extraction.id, { new_memories: [0] }, userId),
    ).rejects.toThrow(/must be confirmed/);

    const result = await repo.applyExtraction(
      extraction.id,
      { binding_resolutions: { Jordan: "create" }, new_memories: [0] },
      userId,
    );
    expect(result.counts.contactsCreated).toBe(1);
    expect(result.counts.memoriesAdded).toBe(1);

    const created = (await repo.listContacts({ q: "Jordan" }))[0];
    expect(created.currentCompany).toBe("Acme Water");
    const full = (await repo.getContact(created.id))!;
    expect(full.memories[0].text).toContain("wastewater");
    expect(full.interactions.map((i) => i.id)).toContain(interaction.id);

    // Undo soft-deletes the AI-created contact.
    await repo.undoBatch(result.batchId, userId);
    expect(await repo.getContact(created.id)).toBeNull();
  });

  it("re-run creates a new extraction attempt; prior rows preserved", async () => {
    const contact = await repo.createContact({ firstName: "Rerun" });
    const interaction = await mkInteraction(`rerun test ${run}`, [contact.id]);
    await repo.saveProposal(
      interaction.id,
      { new_memories: [{ contact: contact.id, text: "First pass fact", category: "other" }] },
      { model: "test" },
    );
    await repo.reRunExtraction(interaction.id);
    const pending = await repo.listPendingCaptures();
    expect(pending.map((p) => p.id)).toContain(interaction.id);

    const { extraction: second } = await repo.saveProposal(
      interaction.id,
      { already_known: [] },
      { model: "test" },
    );
    expect(second.attempt).toBe(2);
    const all = await repo.getExtractionsForInteraction(interaction.id);
    expect(all).toHaveLength(2);
  });

  it("summary lifecycle: apply marks stale, refresh clears it, isolation holds", async () => {
    const contact = await repo.createContact({ firstName: "Snapshot" });
    await repo.addMemory({ contactId: contact.id, text: "Snapshot test fact", category: "other" });

    // Missing summary + has memories → listed as needing a snapshot.
    let stale = await repo.listStaleSummaries();
    expect(stale.some((c) => c.id === contact.id)).toBe(true);

    const updated = await repo.updateContactSummary(contact.id, "You met Snapshot recently.");
    expect(updated!.aiSummary).toBe("You met Snapshot recently.");
    expect(updated!.aiSummaryStale).toBe(false);
    expect(updated!.aiSummaryGeneratedAt).not.toBeNull();
    stale = await repo.listStaleSummaries();
    expect(stale.some((c) => c.id === contact.id)).toBe(false);

    // Applying an extraction re-flags it.
    const interaction = await mkInteraction(`snapshot staleness ${run}`, [contact.id]);
    const { extraction } = await repo.saveProposal(
      interaction.id,
      { new_memories: [{ contact: contact.id, text: "A newer snapshot fact", category: "other" }] },
      { model: "test" },
    );
    await repo.applyExtraction(extraction.id, { new_memories: [0] }, userId);
    stale = await repo.listStaleSummaries();
    expect(stale.some((c) => c.id === contact.id)).toBe(true);

    // Another workspace can't write this contact's summary.
    const otherRepo = repoFor(otherWsId);
    expect(await otherRepo.updateContactSummary(contact.id, "hijack")).toBeNull();
  });

  it("flags possible duplicates on proposed new contacts", async () => {
    await repo.createContact({
      firstName: "Priyanka",
      lastName: "Raman",
      currentCompany: "Northwind",
    });
    const interaction = await mkInteraction(`new contact dupe ${run}`);
    const { staged } = await repo.saveProposal(
      interaction.id,
      {
        contact_bindings: [
          {
            mention: "Priyanka",
            status: "new",
            new_contact: { first_name: "Priyanka", last_name: "Raman" },
          },
        ],
      },
      { model: "test" },
    );
    const dupes = staged.flags.new_contacts?.["Priyanka"];
    expect(dupes?.[0].name).toBe("Priyanka Raman");
    expect(dupes?.[0].company).toBe("Northwind");
  });

  it("open follow-ups exclude soft-deleted contacts", async () => {
    const contact = await repo.createContact({ firstName: "GhostFollowUp" });
    await repo.addFollowUp({
      contactId: contact.id,
      description: "should vanish with the contact",
      reason: "test",
    });
    expect(
      (await repo.listOpenFollowUps()).some((f) => f.contact.id === contact.id),
    ).toBe(true);

    await repo.softDeleteContact(contact.id);
    expect(
      (await repo.listOpenFollowUps()).some((f) => f.contact.id === contact.id),
    ).toBe(false);
  });

  it("marks extraction failed without touching the capture", async () => {
    const interaction = await mkInteraction(`failure test ${run}`);
    await repo.markExtractionFailed(interaction.id, "malformed JSON", { model: "test" });
    const failed = await repo.listFailedExtractions();
    expect(failed.some((f) => f.interaction.id === interaction.id)).toBe(true);
    const row = await repo.getInteraction(interaction.id);
    expect(row!.extractionStatus).toBe("failed");
    expect(row!.rawSource).toContain("failure test");
  });
});
