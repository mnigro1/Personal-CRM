/**
 * Integration tests against the real database (DATABASE_URL from .env.local).
 * Creates two isolated workspaces, exercises the repo layer, and cleans up.
 * Skipped entirely when DATABASE_URL is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("repository layer (integration)", async () => {
  const { db } = await import("@/db");
  const {
    contactTags,
    contacts,
    followUps,
    interactionContacts,
    interactions,
    memories,
    tags,
    users,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");

  const run = Date.now();
  let userAId: string, userBId: string;
  let wsAId: string, wsBId: string;
  let repoA: ReturnType<typeof repoFor>;
  let repoB: ReturnType<typeof repoFor>;

  beforeAll(async () => {
    const [userA] = await db
      .insert(users)
      .values({ email: `test-a-${run}@example.test`, timezone: "America/New_York" })
      .returning();
    const [userB] = await db
      .insert(users)
      .values({ email: `test-b-${run}@example.test`, timezone: "America/New_York" })
      .returning();
    userAId = userA.id;
    userBId = userB.id;
    const [wsA] = await db
      .insert(workspaces)
      .values({ ownerUserId: userAId, name: "Test A" })
      .returning();
    const [wsB] = await db
      .insert(workspaces)
      .values({ ownerUserId: userBId, name: "Test B" })
      .returning();
    wsAId = wsA.id;
    wsBId = wsB.id;
    repoA = repoFor(wsAId);
    repoB = repoFor(wsBId);
  });

  afterAll(async () => {
    for (const wsId of [wsAId, wsBId]) {
      if (!wsId) continue;
      const { revisions, extractions, messageDrafts } = await import(
        "@/db/schema"
      );
      await db.delete(revisions).where(eq(revisions.workspaceId, wsId));
      await db.delete(extractions).where(eq(extractions.workspaceId, wsId));
      await db.delete(messageDrafts).where(eq(messageDrafts.workspaceId, wsId));
      await db.delete(contactTags).where(eq(contactTags.workspaceId, wsId));
      await db.delete(followUps).where(eq(followUps.workspaceId, wsId));
      await db.delete(memories).where(eq(memories.workspaceId, wsId));
      await db
        .delete(interactionContacts)
        .where(eq(interactionContacts.workspaceId, wsId));
      await db.delete(interactions).where(eq(interactions.workspaceId, wsId));
      await db.delete(tags).where(eq(tags.workspaceId, wsId));
      await db.delete(contacts).where(eq(contacts.workspaceId, wsId));
      await db.delete(workspaces).where(eq(workspaces.id, wsId));
    }
    await db.delete(users).where(inArray(users.id, [userAId, userBId].filter(Boolean)));
  });

  it("enforces workspace isolation: B sees none of A's data", async () => {
    const contact = await repoA.createContact({ firstName: "Sarah", lastName: "Johnson" });
    await repoA.addMemory({ contactId: contact.id, text: "Interested in healthcare entrepreneurship", category: "goals" });
    await repoA.addFollowUp({ contactId: contact.id, description: "Send intro", reason: "She asked" });
    await repoA.createInteraction({
      type: "coffee",
      occurredAt: new Date("2026-07-01T10:00:00Z"),
      rawSource: `Coffee with Sarah ${run}`,
      sourceType: "manual_note",
      contactIds: [contact.id],
    });

    expect(await repoB.listContacts()).toHaveLength(0);
    expect(await repoB.listOpenFollowUps()).toHaveLength(0);
    expect(await repoB.listInteractions()).toHaveLength(0);
    expect(await repoB.getContact(contact.id)).toBeNull();

    // A still sees everything.
    const full = await repoA.getContact(contact.id);
    expect(full).not.toBeNull();
    expect(full!.memories).toHaveLength(1);
    expect(full!.interactions).toHaveLength(1);
  });

  it("detects duplicate pastes by hash within a workspace, not across", async () => {
    const text = `Dinner with Mike, talked about his move to Denver ${run}`;
    const first = await repoA.createInteraction({
      type: "meal",
      occurredAt: new Date(),
      rawSource: text,
      sourceType: "manual_note",
      contactIds: [],
    });
    expect(first.duplicate).toBe(false);

    // Same content, extra whitespace — still a duplicate.
    const second = await repoA.createInteraction({
      type: "meal",
      occurredAt: new Date(),
      rawSource: `  ${text.replace(" ", "\n")}  `,
      sourceType: "manual_note",
      contactIds: [],
    });
    expect(second.duplicate).toBe(true);
    expect(second.interaction.id).toBe(first.interaction.id);

    // Same content in B's workspace is not a duplicate.
    const inB = await repoB.createInteraction({
      type: "meal",
      occurredAt: new Date(),
      rawSource: text,
      sourceType: "manual_note",
      contactIds: [],
    });
    expect(inB.duplicate).toBe(false);
  });

  it("recomputes last_interaction_date on create, edit, and delete", async () => {
    const contact = await repoA.createContact({ firstName: "Recompute" });
    const july = new Date("2026-07-10T12:00:00Z");
    const may = new Date("2026-05-01T12:00:00Z");

    const a = await repoA.createInteraction({
      type: "call",
      occurredAt: july,
      rawSource: `call one ${run}`,
      sourceType: "manual_note",
      contactIds: [contact.id],
    });
    await repoA.createInteraction({
      type: "call",
      occurredAt: may,
      rawSource: `call two ${run}`,
      sourceType: "manual_note",
      contactIds: [contact.id],
    });

    let c = await repoA.getContact(contact.id);
    expect(c!.lastInteractionDate?.toISOString()).toBe(july.toISOString());

    // Editing the newest interaction's date back recomputes to MAX, not increment.
    const march = new Date("2026-03-01T12:00:00Z");
    await repoA.updateInteractionMeta(a.interaction.id, { occurredAt: march });
    c = await repoA.getContact(contact.id);
    expect(c!.lastInteractionDate?.toISOString()).toBe(may.toISOString());

    // Deleting all interactions nulls it.
    for (const i of c!.interactions) await repoA.deleteInteraction(i.id);
    c = await repoA.getContact(contact.id);
    expect(c!.lastInteractionDate).toBeNull();
  });

  it("finds similar contacts and duplicate pairs", async () => {
    const original = await repoA.createContact({
      firstName: "Jonathan",
      lastName: "Smithfield",
      currentCompany: "Smithfield Widgets",
    });

    // Near-identical name → similar match.
    const similar = await repoA.findSimilarContacts("Jonathon", "Smithfield");
    expect(similar.map((s) => s.id)).toContain(original.id);

    // Same first name, no last name — the "Matt" vs "Matt Weinstein" case.
    // Nothing can rule these apart, so it's still worth asking about.
    const firstNameOnly = await repoA.findSimilarContacts("Jonathan");
    expect(firstNameOnly.map((s) => s.id)).toContain(original.id);

    // But a shared first name with a clearly different surname is a
    // DIFFERENT PERSON. Flagging it forced the user to confirm something
    // both they and the AI already knew ("Daniel Soper" vs "Daniel Arnold").
    const differentSurname = await repoA.findSimilarContacts("Jonathan", "Kowalski");
    expect(differentSurname.map((s) => s.id)).not.toContain(original.id);

    // A misspelt surname is still caught — that's the case worth protecting.
    const typo = await repoA.findSimilarContacts("Jonathan", "Smithfeld");
    expect(typo.map((s) => s.id)).toContain(original.id);

    // Pair scan sees a duplicate once a second Jonathan exists.
    const dupe = await repoA.createContact({ firstName: "Jonathan", lastName: "Smithfield" });
    const pairs = await repoA.findDuplicateContactPairs();
    expect(
      pairs.some(
        (p) =>
          (p.aId === original.id && p.bId === dupe.id) ||
          (p.aId === dupe.id && p.bId === original.id),
      ),
    ).toBe(true);

    // B's workspace sees none of it.
    expect(await repoB.findSimilarContacts("Jonathan", "Smithfield")).toHaveLength(0);

    await repoA.softDeleteContact(dupe.id);
  });

  it("lists recent contacts newest-first, excluding deleted", async () => {
    const older = await repoA.createContact({ firstName: "RecentOlder" });
    const newer = await repoA.createContact({ firstName: "RecentNewer" });

    const recent = await repoA.listRecentContacts(20);
    const idx = (id: string) => recent.findIndex((c) => c.id === id);
    expect(idx(newer.id)).toBeGreaterThanOrEqual(0);
    expect(idx(newer.id)).toBeLessThan(idx(older.id));

    await repoA.softDeleteContact(newer.id);
    expect(
      (await repoA.listRecentContacts(20)).some((c) => c.id === newer.id),
    ).toBe(false);

    // Workspace-scoped.
    expect(
      (await repoB.listRecentContacts(20)).some((c) => c.id === older.id),
    ).toBe(false);
  });

  it("soft-deleted contacts disappear from reads", async () => {
    const contact = await repoA.createContact({ firstName: "Ghost" });
    await repoA.softDeleteContact(contact.id);
    expect(await repoA.getContact(contact.id)).toBeNull();
    const list = await repoA.listContacts({ q: "Ghost" });
    expect(list).toHaveLength(0);
  });

  it("filters: company, open follow-ups", async () => {
    const boston = await repoA.createContact({ firstName: "FilterBoston", currentCompany: "Acme", location: "Boston" });
    const denver = await repoA.createContact({ firstName: "FilterDenver", location: "Denver" });
    await repoA.addFollowUp({ contactId: denver.id, description: "ping", reason: "test" });

    const byCompany = await repoA.listContacts({ company: "acme" });
    expect(byCompany.map((c) => c.firstName)).toEqual(["FilterBoston"]);

    const withFollowUps = await repoA.listContacts({ hasOpenFollowUps: true, q: "Filter" });
    expect(withFollowUps.map((c) => c.firstName)).toEqual(["FilterDenver"]);
  });

  // Follow-ups used to be write-once: no way to edit one, so rescheduling
  // meant completing and recreating, which abandons the attached draft.
  describe("updateFollowUp", () => {
    const makeFollowUp = async (over: Record<string, unknown> = {}) => {
      const contact = await repoA.createContact({ firstName: "Reschedule" });
      const followUp = await repoA.addFollowUp({
        contactId: contact.id,
        description: "Send the deck",
        reason: "she asked",
        dueDate: "2026-09-14",
        priority: "medium",
        ...over,
      });
      return { contact, followUp };
    };

    it("reschedules in place, keeping the draft attached", async () => {
      const { contact, followUp } = await makeFollowUp();
      const draft = await repoA.createDraft({
        contactId: contact.id,
        followUpId: followUp.id,
        channel: "email",
      });
      await repoA.saveDraftBody(draft.id, { body: "Written already" });

      const updated = await repoA.updateFollowUp(followUp.id, {
        dueDate: "2026-08-14",
      });

      expect(updated!.id).toBe(followUp.id);
      expect(updated!.dueDate).toBe("2026-08-14");
      // The whole point: same row, so the draft is still reachable.
      const still = await repoA.getDraft(draft.id);
      expect(still!.draft.followUpId).toBe(followUp.id);
      expect(still!.draft.body).toBe("Written already");
    });

    it("touches only the fields passed", async () => {
      const { followUp } = await makeFollowUp();
      const updated = await repoA.updateFollowUp(followUp.id, {
        priority: "high",
      });
      expect(updated!.priority).toBe("high");
      expect(updated!.dueDate).toBe("2026-09-14");
      expect(updated!.description).toBe("Send the deck");
      expect(updated!.reason).toBe("she asked");
    });

    it("normalizes a partial due date and can clear it", async () => {
      const { followUp } = await makeFollowUp();
      const partial = await repoA.updateFollowUp(followUp.id, {
        dueDate: "2026-09",
      });
      expect(partial!.dueDate).toBe("2026-09-01");

      const cleared = await repoA.updateFollowUp(followUp.id, {
        dueDate: null,
      });
      expect(cleared!.dueDate).toBeNull();
    });

    it("reopens a follow-up closed by mistake", async () => {
      const { followUp } = await makeFollowUp();
      await repoA.completeFollowUp(followUp.id);

      const reopened = await repoA.updateFollowUp(followUp.id, {
        status: "open",
      });
      expect(reopened!.status).toBe("open");
      // completedAt must follow status or the row contradicts itself.
      expect(reopened!.completedAt).toBeNull();
      const open = await repoA.listOpenFollowUps();
      expect(open.map((r) => r.followUp.id)).toContain(followUp.id);
    });

    it("records each change so a reschedule is auditable", async () => {
      const { revisions } = await import("@/db/schema");
      const { followUp } = await makeFollowUp();
      await repoA.updateFollowUp(
        followUp.id,
        { dueDate: "2026-08-14", priority: "high" },
        userAId,
      );

      const rows = await db
        .select()
        .from(revisions)
        .where(eq(revisions.entityId, followUp.id));
      const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
      expect(byField.due_date.oldValue).toBe("2026-09-14");
      expect(byField.due_date.newValue).toBe("2026-08-14");
      expect(byField.priority.newValue).toBe("high");
    });

    it("is workspace-scoped and returns null for anything else", async () => {
      const { followUp } = await makeFollowUp();
      expect(
        await repoB.updateFollowUp(followUp.id, { dueDate: "2026-01-01" }),
      ).toBeNull();
      expect(
        await repoA.updateFollowUp(
          "00000000-0000-0000-0000-000000000000",
          { priority: "low" },
        ),
      ).toBeNull();
      // Untouched by the rejected write.
      const [row] = await db
        .select()
        .from(followUps)
        .where(eq(followUps.id, followUp.id));
      expect(row.dueDate).toBe("2026-09-14");
    });
  });
});
