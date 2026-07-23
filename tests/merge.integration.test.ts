/**
 * Contact merge. The failure this guards against is silent data loss: a
 * merge that drops a memory, orphans an interaction, or overwrites a field
 * the user could still see is worse than leaving the duplicate alone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("contact merge (integration)", async () => {
  const { db } = await import("@/db");
  const {
    contacts,
    followUps,
    interactionContacts,
    interactions,
    memories,
    messageDrafts,
    revisions,
    users,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");

  const run = Date.now();
  let userAId: string, userBId: string, wsAId: string, wsBId: string;
  let repoA: ReturnType<typeof repoFor>;
  let repoB: ReturnType<typeof repoFor>;

  beforeAll(async () => {
    const [ua] = await db.insert(users).values({ email: `merge-a-${run}@example.test` }).returning();
    const [ub] = await db.insert(users).values({ email: `merge-b-${run}@example.test` }).returning();
    userAId = ua.id;
    userBId = ub.id;
    const [wa] = await db.insert(workspaces).values({ ownerUserId: userAId, name: "M A" }).returning();
    const [wb] = await db.insert(workspaces).values({ ownerUserId: userBId, name: "M B" }).returning();
    wsAId = wa.id;
    wsBId = wb.id;
    repoA = repoFor(wsAId);
    repoB = repoFor(wsBId);
  });

  afterAll(async () => {
    for (const wsId of [wsAId, wsBId]) {
      if (!wsId) continue;
      await db.delete(revisions).where(eq(revisions.workspaceId, wsId));
      await db.delete(messageDrafts).where(eq(messageDrafts.workspaceId, wsId));
      await db.delete(followUps).where(eq(followUps.workspaceId, wsId));
      await db.delete(memories).where(eq(memories.workspaceId, wsId));
      await db.delete(interactionContacts).where(eq(interactionContacts.workspaceId, wsId));
      await db.delete(interactions).where(eq(interactions.workspaceId, wsId));
      await db.delete(contacts).where(eq(contacts.workspaceId, wsId));
      await db.delete(workspaces).where(eq(workspaces.id, wsId));
    }
    await db.delete(users).where(inArray(users.id, [userAId, userBId].filter(Boolean)));
  });

  /** A duplicate pair with history on both sides. */
  async function pair(tag: string) {
    const survivor = await repoA.createContact({
      firstName: "Dana",
      lastName: "Reyes",
      emails: [`dana-${tag}@a.test`],
      currentCompany: "Northwind",
      notes: "Survivor note",
    } as never);
    const loser = await repoA.createContact({
      firstName: "Dana",
      lastName: "Reyes",
      emails: [`dana-${tag}@b.test`],
      // Survivor has no phone/role — these should fill in.
      phone: "+15551230000",
      currentRole: "VP Product",
      // Conflicts with the survivor's company — survivor must win.
      currentCompany: "Wrong Co",
      notes: "Loser note",
    } as never);
    return { survivor, loser };
  }

  it("moves memories, follow-ups and drafts onto the survivor", async () => {
    const { survivor, loser } = await pair("move");
    await repoA.addMemory({ contactId: loser.id, text: `Loser memory ${run}`, category: "career" });
    await repoA.addMemory({ contactId: survivor.id, text: `Survivor memory ${run}`, category: "career" });
    const fu = await repoA.addFollowUp({ contactId: loser.id, description: "Loser follow-up", reason: "test" });
    const draft = await repoA.createDraft({ contactId: loser.id, channel: "email" });

    const summary = await repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id });

    expect(summary.moved.memories).toBe(1);
    expect(summary.moved.followUps).toBe(1);
    expect(summary.moved.drafts).toBe(1);

    const full = await repoA.getContact(survivor.id);
    expect(full!.memories.map((m) => m.text).sort()).toEqual(
      [`Loser memory ${run}`, `Survivor memory ${run}`].sort(),
    );
    expect(full!.followUps.map((f) => f.id)).toContain(fu.id);
    const movedDraft = await repoA.getDraft(draft.id);
    expect(movedDraft!.draft.contactId).toBe(survivor.id);
  });

  it("fills blanks from the loser but never overwrites the survivor", async () => {
    const { survivor, loser } = await pair("fields");
    const summary = await repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id });

    const merged = await repoA.getContact(survivor.id);
    // Blanks filled…
    expect(merged!.phone).toBe("+15551230000");
    expect(merged!.currentRole).toBe("VP Product");
    expect(summary.fieldsFilled).toEqual(expect.arrayContaining(["phone", "currentRole"]));
    // …but a real conflict keeps the survivor's value.
    expect(merged!.currentCompany).toBe("Northwind");
    // Emails union rather than replace.
    expect(merged!.emails).toHaveLength(2);
    // Notes are kept in full — no silent loss of typed text.
    expect(merged!.notes).toContain("Survivor note");
    expect(merged!.notes).toContain("Loser note");
    expect(summary.notesAppended).toBe(true);
  });

  it("survives both records being on the SAME interaction (composite PK)", async () => {
    const { survivor, loser } = await pair("shared");
    // The classic way a duplicate forms: one meeting logged against both.
    const shared = await repoA.createInteraction({
      type: "meeting",
      occurredAt: new Date("2026-07-01T10:00:00Z"),
      rawSource: `Shared meeting ${run}`,
      sourceType: "manual_note",
      contactIds: [survivor.id, loser.id],
    });
    const loserOnly = await repoA.createInteraction({
      type: "call",
      occurredAt: new Date("2026-07-10T10:00:00Z"),
      rawSource: `Loser-only call ${run}`,
      sourceType: "manual_note",
      contactIds: [loser.id],
    });

    const summary = await repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id });

    // The shared link is deduped, not duplicated or crashed on.
    expect(summary.deduped.interactions).toBe(1);
    expect(summary.moved.interactions).toBe(1);

    const full = await repoA.getContact(survivor.id);
    const ids = full!.interactions.map((i) => i.id);
    expect(ids).toContain(shared.interaction.id);
    expect(ids).toContain(loserOnly.interaction.id);
    // Exactly one link per interaction — no duplicated timeline entries.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recomputes last_interaction_date when the loser held the newer one", async () => {
    const { survivor, loser } = await pair("recompute");
    await repoA.createInteraction({
      type: "coffee",
      occurredAt: new Date("2026-01-05T10:00:00Z"),
      rawSource: `Old survivor coffee ${run}`,
      sourceType: "manual_note",
      contactIds: [survivor.id],
    });
    await repoA.createInteraction({
      type: "call",
      occurredAt: new Date("2026-06-20T10:00:00Z"),
      rawSource: `Recent loser call ${run}`,
      sourceType: "manual_note",
      contactIds: [loser.id],
    });

    await repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id });

    const merged = await repoA.getContact(survivor.id);
    expect(merged!.lastInteractionDate?.toISOString()).toBe("2026-06-20T10:00:00.000Z");
  });

  it("tombstones the loser: hidden from lists, resolvable by id", async () => {
    const { survivor, loser } = await pair("tombstone");
    await repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id });

    // Gone from every list and from duplicate scans.
    const listed = await repoA.listContacts();
    expect(listed.map((c) => c.id)).not.toContain(loser.id);
    expect(await repoA.getContact(loser.id)).toBeNull();
    const pairs = await repoA.findDuplicateContactPairs();
    expect(pairs.flatMap((p) => [p.aId, p.bId])).not.toContain(loser.id);

    // But an old link still knows where the person went.
    expect(await repoA.resolveMergedContact(loser.id)).toBe(survivor.id);
  });

  it("follows a chain when a merged contact is merged again", async () => {
    const a = await repoA.createContact({ firstName: "Chain", lastName: "One" } as never);
    const b = await repoA.createContact({ firstName: "Chain", lastName: "Two" } as never);
    const c = await repoA.createContact({ firstName: "Chain", lastName: "Three" } as never);
    await repoA.mergeContacts({ survivorId: b.id, loserId: a.id });
    await repoA.mergeContacts({ survivorId: c.id, loserId: b.id });
    // A → B → C resolves all the way to C, not to the already-merged B.
    expect(await repoA.resolveMergedContact(a.id)).toBe(c.id);
  });

  it("records enough in revisions to reconstruct the merge", async () => {
    const { survivor, loser } = await pair("audit");
    const m = await repoA.addMemory({ contactId: loser.id, text: `Audit memory ${run}`, category: "other" });

    const summary = await repoA.mergeContacts({
      survivorId: survivor.id,
      loserId: loser.id,
      actorUserId: userAId,
    });

    const rows = await db.select().from(revisions).where(eq(revisions.batchId, summary.batchId));
    expect(rows).toHaveLength(2);
    const tombstone = rows.find((r) => r.field === "merged_into_contact_id")!;
    const newValue = tombstone.newValue as { mergedInto: string; movedMemoryIds: string[] };
    expect(newValue.mergedInto).toBe(survivor.id);
    expect(newValue.movedMemoryIds).toContain(m.id);
    // The losing record itself is preserved, not just its id.
    expect((tombstone.oldValue as { contact: { id: string } }).contact.id).toBe(loser.id);
  });

  it("refuses self-merge, missing ids, and already-merged contacts", async () => {
    const { survivor, loser } = await pair("guards");

    await expect(
      repoA.mergeContacts({ survivorId: survivor.id, loserId: survivor.id }),
    ).rejects.toThrow(/into itself/i);

    await expect(
      repoA.mergeContacts({
        survivorId: survivor.id,
        loserId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/not found/i);

    await repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id });
    // Merging the same loser twice must not move anything a second time.
    await expect(
      repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id }),
    ).rejects.toThrow(/already merged or deleted/i);
  });

  it("cannot merge across workspaces", async () => {
    const mine = await repoA.createContact({ firstName: "Isolated", lastName: "Mine" } as never);
    const theirs = await repoB.createContact({ firstName: "Isolated", lastName: "Theirs" } as never);

    await expect(
      repoA.mergeContacts({ survivorId: mine.id, loserId: theirs.id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      repoA.mergeContacts({ survivorId: theirs.id, loserId: mine.id }),
    ).rejects.toThrow(/not found/i);

    // Neither record was touched.
    expect((await repoB.getContact(theirs.id))!.deletedAt).toBeNull();
    expect((await repoA.getContact(mine.id))!.deletedAt).toBeNull();
  });

  it("leaves nothing behind pointing at the loser", async () => {
    const { survivor, loser } = await pair("orphans");
    await repoA.addMemory({ contactId: loser.id, text: `Orphan check ${run}`, category: "other" });
    await repoA.addFollowUp({ contactId: loser.id, description: "Orphan follow-up", reason: "test" });
    await repoA.createDraft({ contactId: loser.id, channel: "text" });
    await repoA.createInteraction({
      type: "call",
      occurredAt: new Date("2026-05-01T10:00:00Z"),
      rawSource: `Orphan call ${run}`,
      sourceType: "manual_note",
      contactIds: [loser.id],
    });

    await repoA.mergeContacts({ survivorId: survivor.id, loserId: loser.id });

    for (const [name, rows] of [
      ["memories", await db.select().from(memories).where(eq(memories.contactId, loser.id))],
      ["followUps", await db.select().from(followUps).where(eq(followUps.contactId, loser.id))],
      ["drafts", await db.select().from(messageDrafts).where(eq(messageDrafts.contactId, loser.id))],
      ["interactionLinks", await db.select().from(interactionContacts).where(eq(interactionContacts.contactId, loser.id))],
    ] as const) {
      expect(rows, `${name} still pointing at the merged-away contact`).toHaveLength(0);
    }
  });
});
