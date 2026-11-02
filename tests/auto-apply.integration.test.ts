/**
 * Server-side auto-apply: the "applied automatically" setting with no human
 * in the loop. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("auto-apply (integration)", async () => {
  const { db } = await import("@/db");
  const {
    contacts,
    extractions,
    followUps,
    interactionContacts,
    interactions,
    memories,
    revisions,
    users,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");

  const run = Date.now();
  let userId: string;
  let wsId: string;
  let repo: ReturnType<typeof repoFor>;
  let sam: { id: string };
  let danielA: { id: string };
  let danielB: { id: string };

  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `auto-${run}@example.test`, timezone: "UTC" })
      .returning();
    userId = u.id;
    const [w] = await db
      .insert(workspaces)
      .values({ ownerUserId: userId, name: "Auto" })
      .returning();
    wsId = w.id;
    repo = repoFor(wsId);
    sam = await repo.createContact({ firstName: "Samantha", lastName: "Riverton" });
    danielA = await repo.createContact({ firstName: "Daniel", lastName: "Arnoldsen" });
    danielB = await repo.createContact({ firstName: "Daniel", lastName: "Arnoldson" });
    await repo.addMemory({
      contactId: sam.id,
      text: "Samantha is moving to Denver in March",
      category: "geography",
    });
  });

  afterAll(async () => {
    await db.delete(revisions).where(eq(revisions.workspaceId, wsId));
    await db.delete(extractions).where(eq(extractions.workspaceId, wsId));
    await db.delete(followUps).where(eq(followUps.workspaceId, wsId));
    await db.delete(memories).where(eq(memories.workspaceId, wsId));
    await db.delete(interactionContacts).where(eq(interactionContacts.workspaceId, wsId));
    await db.delete(interactions).where(eq(interactions.workspaceId, wsId));
    await db.delete(contacts).where(eq(contacts.workspaceId, wsId));
    await db.delete(workspaces).where(eq(workspaces.id, wsId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("creates new people, matches near-identical names, skips true ambiguity, drops duplicate memories", async () => {
    const { interaction } = await repo.createInteraction({
      type: "coffee",
      occurredAt: new Date(),
      rawSource: `auto-apply source ${run}`,
      sourceType: "manual_note",
      contactIds: [sam.id],
    });

    const { extraction } = await repo.saveProposal(
      interaction.id,
      {
        contact_bindings: [
          { mention: "Samantha", status: "confident", contact_id: sam.id },
          // Brand new: nobody similar exists → created.
          { mention: "Priya", status: "new", new_contact: { first_name: "Priya", last_name: `Venkataraman${run}` } },
          // Near-identical to Samantha Riverton → matched, not duplicated.
          { mention: "Sam R", status: "new", new_contact: { first_name: "Samantha", last_name: "Rivertonn" } },
          // Two Daniels the extractor couldn't tell apart → skipped.
          {
            mention: "Daniel",
            status: "ambiguous",
            candidates: [
              { contact_id: danielA.id, hint: "Arnoldsen" },
              { contact_id: danielB.id, hint: "Arnoldson" },
            ],
          },
        ],
        new_memories: [
          { contact: "Priya", text: `Priya runs product at Northwind ${run}`, category: "career" },
          { contact: "Sam R", text: `Samantha picked up climbing ${run}`, category: "interests" },
          { contact: "Daniel", text: `Daniel is raising a seed round ${run}`, category: "career" },
          // Probable duplicate of an existing memory → dropped.
          { contact: sam.id, text: "Samantha is moving to Denver in March", category: "geography" },
        ],
        follow_ups: [
          { contact: "Priya", description: `Send Priya the deck ${run}`, reason: "She asked for it" },
        ],
      },
      { model: "test" },
    );

    const result = await repo.autoApplyExtraction(extraction.id, userId);

    // Priya was created; Sam R was matched to Samantha; Daniel was skipped.
    expect(result.createdContacts).toHaveLength(1);
    expect(result.createdContacts[0].mention).toBe("Priya");
    expect(result.matchedExisting).toEqual([
      expect.objectContaining({ mention: "Sam R", contactId: sam.id }),
    ]);
    expect(result.skippedMentions.map((s) => s.mention)).toEqual(["Daniel"]);
    expect(result.skippedDuplicateMemories).toBe(1);

    const priya = await repo.getContact(result.createdContacts[0].contactId);
    expect(priya?.firstName).toBe("Priya");
    expect(priya?.memories.map((m) => m.text)).toEqual([`Priya runs product at Northwind ${run}`]);
    expect(priya?.followUps).toHaveLength(1);

    const samFull = await repo.getContact(sam.id);
    const samTexts = samFull!.memories.map((m) => m.text);
    expect(samTexts).toContain(`Samantha picked up climbing ${run}`);
    // Dropped as a probable duplicate: still exactly one Denver memory.
    expect(samTexts.filter((t) => t.includes("Denver"))).toHaveLength(1);

    // Nothing landed on either Daniel.
    for (const d of [danielA, danielB]) {
      const full = await repo.getContact(d.id);
      expect(full?.memories).toHaveLength(0);
    }

    // The extraction is applied, and undo still works on the whole batch.
    const after = await repo.getExtraction(extraction.id);
    expect(after?.extraction.status).toBe("applied");
    const undo = await repo.undoBatch(result.batchId, userId);
    expect(undo.reverted).toBeGreaterThan(0);
  });

  it("takes the single candidate of an ambiguous mention", async () => {
    const { interaction } = await repo.createInteraction({
      type: "call",
      occurredAt: new Date(),
      rawSource: `auto-apply single candidate ${run}`,
      sourceType: "manual_note",
      contactIds: [],
    });
    const { extraction } = await repo.saveProposal(
      interaction.id,
      {
        contact_bindings: [
          { mention: "Dan A", status: "ambiguous", candidates: [{ contact_id: danielA.id }] },
        ],
        new_memories: [{ contact: "Dan A", text: `Dan A hired a CFO ${run}`, category: "career" }],
      },
      { model: "test" },
    );
    const result = await repo.autoApplyExtraction(extraction.id, userId);
    expect(result.skippedMentions).toEqual([]);
    const full = await repo.getContact(danielA.id);
    expect(full?.memories.map((m) => m.text)).toContain(`Dan A hired a CFO ${run}`);
  });
});
