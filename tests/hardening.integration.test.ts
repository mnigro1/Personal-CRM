/**
 * Cross-workspace id rejection, write-time URL sanitization, invite email
 * normalization, and the rate limiter. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("hardening (integration)", async () => {
  const { db } = await import("@/db");
  const {
    contacts,
    followUps,
    interactionContacts,
    interactions,
    invites,
    memories,
    rateLimits,
    revisions,
    users,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");
  const { consumeRateLimit } = await import("@/db/rate-limit");

  const run = Date.now();
  let userAId: string, userBId: string, wsAId: string, wsBId: string;
  let repoA: ReturnType<typeof repoFor>;
  let repoB: ReturnType<typeof repoFor>;
  let foreignContactId: string;

  beforeAll(async () => {
    const [ua] = await db
      .insert(users)
      .values({ email: `hard-a-${run}@example.test` })
      .returning();
    const [ub] = await db
      .insert(users)
      .values({ email: `hard-b-${run}@example.test` })
      .returning();
    userAId = ua.id;
    userBId = ub.id;
    const [wa] = await db
      .insert(workspaces)
      .values({ ownerUserId: userAId, name: "Hardening A" })
      .returning();
    const [wb] = await db
      .insert(workspaces)
      .values({ ownerUserId: userBId, name: "Hardening B" })
      .returning();
    wsAId = wa.id;
    wsBId = wb.id;
    repoA = repoFor(wsAId);
    repoB = repoFor(wsBId);
    const theirs = await repoB.createContact({ firstName: "TheirPerson" });
    foreignContactId = theirs.id;
  });

  afterAll(async () => {
    for (const wsId of [wsAId, wsBId]) {
      if (!wsId) continue;
      await db.delete(revisions).where(eq(revisions.workspaceId, wsId));
      await db.delete(followUps).where(eq(followUps.workspaceId, wsId));
      await db.delete(memories).where(eq(memories.workspaceId, wsId));
      await db
        .delete(interactionContacts)
        .where(eq(interactionContacts.workspaceId, wsId));
      await db.delete(interactions).where(eq(interactions.workspaceId, wsId));
      await db.delete(contacts).where(eq(contacts.workspaceId, wsId));
      await db.delete(workspaces).where(eq(workspaces.id, wsId));
    }
    await db.delete(invites).where(eq(invites.invitedByUserId, userAId));
    await db
      .delete(users)
      .where(inArray(users.id, [userAId, userBId].filter(Boolean)));
    await db.delete(rateLimits).where(like(rateLimits.key, `test:${run}:%`));
  });

  describe("ids from the client must belong to the workspace", () => {
    it("createInteraction refuses a foreign contact id", async () => {
      await expect(
        repoA.createInteraction({
          type: "call",
          occurredAt: new Date(),
          rawSource: `foreign link ${run}`,
          sourceType: "manual_note",
          contactIds: [foreignContactId],
        }),
      ).rejects.toThrow(/Contact not found/);
    });

    it("addMemory and addFollowUp refuse a foreign contact id", async () => {
      await expect(
        repoA.addMemory({ contactId: foreignContactId, text: "x", category: "other" }),
      ).rejects.toThrow(/Contact not found/);
      await expect(
        repoA.addFollowUp({ contactId: foreignContactId, description: "x", reason: "y" }),
      ).rejects.toThrow(/Contact not found/);
    });

    it("addMemory refuses a foreign source interaction", async () => {
      const mine = await repoA.createContact({ firstName: "MinePerson" });
      const theirs = await repoB.createInteraction({
        type: "call",
        occurredAt: new Date(),
        rawSource: `their interaction ${run}`,
        sourceType: "manual_note",
        contactIds: [foreignContactId],
      });
      await expect(
        repoA.addMemory({
          contactId: mine.id,
          text: "x",
          category: "other",
          sourceInteractionId: theirs.interaction.id,
        }),
      ).rejects.toThrow(/Interaction not found/);
    });

    it("updateInteractionMeta refuses to relink to a foreign contact", async () => {
      const mine = await repoA.createContact({ firstName: "RelinkPerson" });
      const created = await repoA.createInteraction({
        type: "call",
        occurredAt: new Date(),
        rawSource: `relink ${run}`,
        sourceType: "manual_note",
        contactIds: [mine.id],
      });
      await expect(
        repoA.updateInteractionMeta(created.interaction.id, {
          contactIds: [foreignContactId],
        }),
      ).rejects.toThrow(/Contact not found/);
      // Nothing changed.
      const after = await repoA.getInteraction(created.interaction.id);
      expect(after?.contacts.map((c) => c.id)).toEqual([mine.id]);
    });
  });

  describe("URL fields", () => {
    it("drops javascript: links on create and update, keeps real ones", async () => {
      const c = await repoA.createContact({
        firstName: "LinkPerson",
        linkedinUrl: "javascript:alert(1)",
        website: "example.com",
      });
      expect(c.linkedinUrl).toBeNull();
      expect(c.website).toBe("https://example.com");

      const updated = await repoA.updateContact(c.id, {
        linkedinUrl: "https://linkedin.com/in/ok",
        website: "data:text/html,hi",
      });
      expect(updated?.linkedinUrl).toBe("https://linkedin.com/in/ok");
      expect(updated?.website).toBeNull();
    });
  });

  describe("invites", () => {
    it("stores the address lowercased so sign-in can match it", async () => {
      const inv = await repoA.createInvite(`  Hard-Invite-${run}@Example.TEST `, userAId);
      expect(inv.email).toBe(`hard-invite-${run}@example.test`);
      await expect(repoA.createInvite("not an email", userAId)).rejects.toThrow();
    });
  });

  describe("rate limiter", () => {
    it("allows up to the limit in a window, then refuses", async () => {
      const key = `test:${run}:limit`;
      const rule = { limit: 3, windowSeconds: 60 };
      const results = [];
      for (let i = 0; i < 5; i++) results.push(await consumeRateLimit(key, rule));
      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
      expect(results[2].remaining).toBe(0);
      expect(results[3].retryAfterSeconds).toBeGreaterThan(0);
      expect(results[3].retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it("keys are independent", async () => {
      const rule = { limit: 1, windowSeconds: 60 };
      expect((await consumeRateLimit(`test:${run}:a`, rule)).allowed).toBe(true);
      expect((await consumeRateLimit(`test:${run}:b`, rule)).allowed).toBe(true);
      expect((await consumeRateLimit(`test:${run}:a`, rule)).allowed).toBe(false);
    });

    it("starts a fresh window once the old one has lapsed", async () => {
      const key = `test:${run}:lapse`;
      const rule = { limit: 1, windowSeconds: 1 };
      expect((await consumeRateLimit(key, rule)).allowed).toBe(true);
      expect((await consumeRateLimit(key, rule)).allowed).toBe(false);
      await new Promise((r) => setTimeout(r, 1500));
      expect((await consumeRateLimit(key, rule)).allowed).toBe(true);
    });
  });
});
