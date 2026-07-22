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
      const { revisions, extractions } = await import("@/db/schema");
      await db.delete(revisions).where(eq(revisions.workspaceId, wsId));
      await db.delete(extractions).where(eq(extractions.workspaceId, wsId));
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
    await repoA.setContactTags(contact.id, ["HBS", "Healthcare"]);
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
    expect(await repoB.listTags()).toHaveLength(0);
    expect(await repoB.listOpenFollowUps()).toHaveLength(0);
    expect(await repoB.listInteractions()).toHaveLength(0);
    expect(await repoB.getContact(contact.id)).toBeNull();

    // A still sees everything.
    const full = await repoA.getContact(contact.id);
    expect(full).not.toBeNull();
    expect(full!.memories).toHaveLength(1);
    expect(full!.tags).toHaveLength(2);
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

  it("merges tags: repoints contacts, tombstones source, resolves future uses", async () => {
    const c1 = await repoA.createContact({ firstName: "TagOne" });
    const c2 = await repoA.createContact({ firstName: "TagTwo" });
    const vc = await repoA.findOrCreateTag("VC");
    const venture = await repoA.findOrCreateTag("Venture Capital");
    await repoA.setContactTags(c1.id, ["VC"]);
    await repoA.setContactTags(c2.id, ["VC", "Venture Capital"]);

    await repoA.mergeTags(vc.id, venture.id);

    const full1 = await repoA.getContact(c1.id);
    const full2 = await repoA.getContact(c2.id);
    expect(full1!.tags.map((t) => t.name)).toEqual(["Venture Capital"]);
    expect(full2!.tags.map((t) => t.name)).toEqual(["Venture Capital"]);

    // Active tag list hides the tombstone.
    const active = await repoA.listTags();
    expect(active.some((t) => t.id === vc.id)).toBe(false);

    // Re-using the merged-away name resolves to the target, not a new tag.
    const resolved = await repoA.findOrCreateTag("vc");
    expect(resolved.id).toBe(venture.id);
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
    const firstNameOnly = await repoA.findSimilarContacts("Jonathan");
    expect(firstNameOnly.map((s) => s.id)).toContain(original.id);

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

  it("deleteTag unlinks contacts and tombstones the tag", async () => {
    const c = await repoA.createContact({ firstName: "TagDelete" });
    await repoA.setContactTags(c.id, ["junktag", "keeptag"]);
    const junk = (await repoA.listTags()).find((t) => t.normalizedName === "junktag")!;

    await repoA.deleteTag(junk.id);

    const remaining = (await repoA.getContact(c.id))!.tags.map((t) => t.name);
    expect(remaining).toEqual(["keeptag"]);
    expect((await repoA.listTags()).some((t) => t.id === junk.id)).toBe(false);

    // Cross-workspace delete is rejected.
    const keep = (await repoA.listTags()).find((t) => t.normalizedName === "keeptag")!;
    await expect(repoB.deleteTag(keep.id)).rejects.toThrow(/not found/i);
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

  it("lists tags with contact counts", async () => {
    const c = await repoA.createContact({ firstName: "TagCount" });
    await repoA.setContactTags(c.id, ["countme", "countme2"]);
    const withCounts = await repoA.listTagsWithCounts();
    const countme = withCounts.find((t) => t.normalizedName === "countme");
    expect(countme?.contactCount).toBe(1);
  });

  it("soft-deleted contacts disappear from reads", async () => {
    const contact = await repoA.createContact({ firstName: "Ghost" });
    await repoA.softDeleteContact(contact.id);
    expect(await repoA.getContact(contact.id)).toBeNull();
    const list = await repoA.listContacts({ q: "Ghost" });
    expect(list).toHaveLength(0);
  });

  it("filters: tag AND/OR, company, open follow-ups", async () => {
    const boston = await repoA.createContact({ firstName: "FilterBoston", currentCompany: "Acme", location: "Boston" });
    const denver = await repoA.createContact({ firstName: "FilterDenver", location: "Denver" });
    await repoA.setContactTags(boston.id, ["investor", "boston"]);
    await repoA.setContactTags(denver.id, ["investor"]);
    await repoA.addFollowUp({ contactId: denver.id, description: "ping", reason: "test" });

    const tagList = await repoA.listTags();
    const investorId = tagList.find((t) => t.normalizedName === "investor")!.id;
    const bostonId = tagList.find((t) => t.normalizedName === "boston")!.id;

    const orMatch = await repoA.listContacts({ tagIds: [investorId, bostonId], tagMode: "or" });
    expect(orMatch.map((c) => c.firstName).sort()).toEqual(["FilterBoston", "FilterDenver"]);

    const andMatch = await repoA.listContacts({ tagIds: [investorId, bostonId], tagMode: "and" });
    expect(andMatch.map((c) => c.firstName)).toEqual(["FilterBoston"]);

    const byCompany = await repoA.listContacts({ company: "acme" });
    expect(byCompany.map((c) => c.firstName)).toEqual(["FilterBoston"]);

    const withFollowUps = await repoA.listContacts({ hasOpenFollowUps: true, q: "Filter" });
    expect(withFollowUps.map((c) => c.firstName)).toEqual(["FilterDenver"]);
  });
});
