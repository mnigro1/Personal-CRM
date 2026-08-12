/**
 * Intros: the only entity relating two contacts to each other.
 *
 * The load-bearing assertion is that double opt-in is derived, not stored.
 * A metric you can set by hand is a metric you will eventually flatter.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("intros (integration)", async () => {
  const { db } = await import("@/db");
  const {
    contacts,
    followUps,
    intros,
    messageDrafts,
    revisions,
    users,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");
  const { isDoubleOptIn } = await import("@/db/repo-intros");

  const run = Date.now();
  let userAId: string, userBId: string, userCId: string;
  let wsAId: string, wsBId: string, wsCId: string;
  let repoA: ReturnType<typeof repoFor>;
  let repoB: ReturnType<typeof repoFor>;
  // Stats assertions need a workspace no other test has written to.
  let repoC: ReturnType<typeof repoFor>;

  beforeAll(async () => {
    const [ua] = await db
      .insert(users)
      .values({ email: `intro-a-${run}@example.test`, timezone: "America/New_York" })
      .returning();
    const [ub] = await db
      .insert(users)
      .values({ email: `intro-b-${run}@example.test`, timezone: "America/New_York" })
      .returning();
    userAId = ua.id;
    userBId = ub.id;
    const [wa] = await db
      .insert(workspaces)
      .values({ ownerUserId: userAId, name: "Intro A" })
      .returning();
    const [wb] = await db
      .insert(workspaces)
      .values({ ownerUserId: userBId, name: "Intro B" })
      .returning();
    const [uc] = await db
      .insert(users)
      .values({ email: `intro-c-${run}@example.test`, timezone: "America/New_York" })
      .returning();
    userCId = uc.id;
    const [wc] = await db
      .insert(workspaces)
      .values({ ownerUserId: userCId, name: "Intro C" })
      .returning();
    wsAId = wa.id;
    wsBId = wb.id;
    wsCId = wc.id;
    repoA = repoFor(wsAId);
    repoB = repoFor(wsBId);
    repoC = repoFor(wsCId);
  });

  afterAll(async () => {
    for (const wsId of [wsAId, wsBId, wsCId]) {
      if (!wsId) continue;
      await db.delete(revisions).where(eq(revisions.workspaceId, wsId));
      await db.delete(messageDrafts).where(eq(messageDrafts.workspaceId, wsId));
      // follow_ups reference intros, so they go first.
      await db.delete(followUps).where(eq(followUps.workspaceId, wsId));
      await db.delete(intros).where(eq(intros.workspaceId, wsId));
      await db.delete(contacts).where(eq(contacts.workspaceId, wsId));
      await db.delete(workspaces).where(eq(workspaces.id, wsId));
    }
    await db.delete(users).where(inArray(users.id, [userAId, userBId, userCId].filter(Boolean)));
  });

  let n = 0;
  async function pair(repo = repoA) {
    n++;
    const a = await repo.createContact({ firstName: `IntroA${n}`, lastName: `T${run}` });
    const b = await repo.createContact({ firstName: `IntroB${n}`, lastName: `T${run}` });
    return { a, b };
  }

  async function proposed(
    reason = "Both work on succession-stage acquisitions",
    repo = repoA,
  ) {
    const { a, b } = await pair(repo);
    const res = await repo.createIntro({
      personAContactId: a.id,
      personBContactId: b.id,
      reason,
    });
    if (res.blocked) throw new Error(`unexpected block: ${res.reason}`);
    return { a, b, intro: res.intro };
  }

  it("requires both people to exist as contacts already", async () => {
    const { a } = await pair();
    const res = await repoA.createIntro({
      personAContactId: a.id,
      personBContactId: "00000000-0000-0000-0000-000000000000",
      reason: "test",
    });
    expect(res.blocked).toBe(true);
    if (!res.blocked) throw new Error("expected block");
    expect(res.reason).toMatch(/create_contact/);
    expect(res.missingContactIds).toEqual([
      "00000000-0000-0000-0000-000000000000",
    ]);
  });

  it("refuses to introduce someone to themselves", async () => {
    const { a } = await pair();
    const res = await repoA.createIntro({
      personAContactId: a.id,
      personBContactId: a.id,
      reason: "test",
    });
    expect(res.blocked).toBe(true);
  });

  it("returns the existing intro for the same unordered pair, either direction", async () => {
    const { a, b, intro } = await proposed();
    // Reversed argument order must still collide.
    const res = await repoA.createIntro({
      personAContactId: b.id,
      personBContactId: a.id,
      reason: "different reason, same two people",
    });
    expect(res.blocked).toBe(true);
    if (!res.blocked) throw new Error("expected block");
    expect(res.existingIntro?.id).toBe(intro.id);

    // Once it reaches a terminal state the pair frees up again.
    await repoA.closeIntro(intro.id, "abandoned");
    const again = await repoA.createIntro({
      personAContactId: a.id,
      personBContactId: b.id,
      reason: "second attempt, later",
    });
    expect(again.blocked).toBe(false);
  });

  it("advances status from the opt-in timestamps, never by hand", async () => {
    const { a, b, intro } = await proposed();
    expect(intro.status).toBe("proposed");

    const one = await repoA.recordOptIn(intro.id, a.id, null, userAId);
    if ("error" in one) throw new Error(one.error);
    expect(one.intro.status).toBe("opt_in_pending");

    const two = await repoA.recordOptIn(intro.id, b.id, null, userAId);
    if ("error" in two) throw new Error(two.error);
    expect(two.intro.status).toBe("opt_in_confirmed");
    expect(two.intro.aOptedInAt).not.toBeNull();
    expect(two.intro.bOptedInAt).not.toBeNull();
  });

  it("survives both opt-ins arriving at once", async () => {
    // Clients batch independent tool calls in parallel. Without a row lock
    // each read "neither has said yes" and the second write erased the
    // first, leaving both people agreed but the intro stuck on pending.
    const { a, b, intro } = await proposed();
    await Promise.all([
      repoA.recordOptIn(intro.id, a.id, null),
      repoA.recordOptIn(intro.id, b.id, null),
    ]);

    const [row] = await db.select().from(intros).where(eq(intros.id, intro.id));
    expect(row.aOptedInAt).not.toBeNull();
    expect(row.bOptedInAt).not.toBeNull();
    expect(row.status).toBe("opt_in_confirmed");
  });

  it("only one of two simultaneous sends wins, so one check-in exists", async () => {
    const { a, b, intro } = await proposed();
    await repoA.recordOptIn(intro.id, a.id, null);
    await repoA.recordOptIn(intro.id, b.id, null);

    const results = await Promise.all([
      repoA.markIntroSent(intro.id),
      repoA.markIntroSent(intro.id),
    ]);
    const succeeded = results.filter(
      (r) => !("error" in r) && !r.blocked,
    );
    expect(succeeded).toHaveLength(1);

    const checkIns = await db
      .select()
      .from(followUps)
      .where(eq(followUps.introId, intro.id));
    expect(checkIns).toHaveLength(1);
  });

  it("rejects an opt-in from someone who is not part of the intro", async () => {
    const { intro } = await proposed();
    const outsider = await repoA.createContact({ firstName: `Outsider${run}` });
    const res = await repoA.recordOptIn(intro.id, outsider.id, null);
    expect("error" in res && res.error).toMatch(/not part of this intro/);
  });

  it("blocks send without both opt-ins, and spawns the check-in when allowed", async () => {
    const { a, b, intro } = await proposed();

    const blocked = await repoA.markIntroSent(intro.id);
    expect("blocked" in blocked && blocked.blocked).toBe(true);

    await repoA.recordOptIn(intro.id, a.id, null);
    const stillBlocked = await repoA.markIntroSent(intro.id);
    expect("blocked" in stillBlocked && stillBlocked.blocked).toBe(true);

    await repoA.recordOptIn(intro.id, b.id, null);
    const sent = await repoA.markIntroSent(intro.id, { channel: "email" });
    if ("error" in sent || sent.blocked) throw new Error("expected send to succeed");

    expect(sent.intro.status).toBe("sent");
    expect(sent.doubleOptIn).toBe(true);
    expect(sent.forced).toBe(false);

    // The 30-day check-in is automatic and points back at the intro.
    expect(sent.followUp).not.toBeNull();
    expect(sent.followUp!.introId).toBe(intro.id);
    expect(sent.followUp!.contactId).toBe(a.id);
    const due = new Date(sent.followUp!.dueDate + "T00:00:00Z").getTime();
    const expected = new Date(sent.intro.sentAt!);
    expected.setUTCDate(expected.getUTCDate() + 30);
    expect(Math.abs(due - Date.UTC(
      expected.getUTCFullYear(), expected.getUTCMonth(), expected.getUTCDate(),
    ))).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it("force-sends but does not let the forced one count", async () => {
    const { intro } = await proposed();
    const sent = await repoA.markIntroSent(intro.id, { force: true });
    if ("error" in sent || sent.blocked) throw new Error("expected forced send");

    expect(sent.intro.status).toBe("sent");
    expect(sent.forced).toBe(true);
    expect(sent.doubleOptIn).toBe(false);
    // Still gets its check-in — it happened, it just doesn't count.
    expect(sent.followUp).not.toBeNull();
  });

  it("does not let an opt-in recorded after the send rescue compliance", async () => {
    const { a, b, intro } = await proposed();
    const sent = await repoA.markIntroSent(intro.id, { force: true });
    if ("error" in sent || sent.blocked) throw new Error("expected forced send");

    // Backdating is impossible here: the yes came in after it went out.
    await repoA.recordOptIn(intro.id, a.id, null);
    await repoA.recordOptIn(intro.id, b.id, null);

    const [row] = await db.select().from(intros).where(eq(intros.id, intro.id));
    expect(row.aOptedInAt).not.toBeNull();
    expect(row.bOptedInAt).not.toBeNull();
    expect(isDoubleOptIn(row)).toBe(false);
    // And the status stays sent rather than sliding back to opt_in_confirmed.
    expect(row.status).toBe("sent");
  });

  it("recording an outcome completes the check-in without a second step", async () => {
    const { a, b, intro } = await proposed();
    await repoA.recordOptIn(intro.id, a.id, null);
    await repoA.recordOptIn(intro.id, b.id, null);
    const sent = await repoA.markIntroSent(intro.id);
    if ("error" in sent || sent.blocked) throw new Error("expected send");

    const res = await repoA.recordIntroOutcome(
      intro.id,
      "met_once",
      "They grabbed coffee in September",
      userAId,
    );
    if ("error" in res) throw new Error(res.error);

    expect(res.intro.status).toBe("completed");
    expect(res.intro.outcome).toBe("met_once");
    expect(res.followUpsCompleted).toBe(1);

    const [f] = await db
      .select()
      .from(followUps)
      .where(eq(followUps.id, sent.followUp!.id));
    expect(f.status).toBe("completed");
    // And it's off the inbox.
    expect((await repoA.listOpenFollowUps()).map((r) => r.followUp.id)).not.toContain(
      sent.followUp!.id,
    );
  });

  it("refuses an outcome for an intro that never went out", async () => {
    const { intro } = await proposed();
    const res = await repoA.recordIntroOutcome(intro.id, "no_response");
    expect("error" in res && res.error).toMatch(/hasn't been sent/);
  });

  it("filters: awaiting opt-in and sent-without-outcome", async () => {
    const waiting = await proposed("waiting on yes");
    const answered = await proposed("already answered");
    await repoA.recordOptIn(answered.intro.id, answered.a.id, null);
    await repoA.recordOptIn(answered.intro.id, answered.b.id, null);
    const sent = await repoA.markIntroSent(answered.intro.id);
    if ("error" in sent || sent.blocked) throw new Error("expected send");

    const awaiting = await repoA.listIntros({ awaitingOptIn: true });
    expect(awaiting.map((r) => r.intro.id)).toContain(waiting.intro.id);
    expect(awaiting.map((r) => r.intro.id)).not.toContain(answered.intro.id);

    const noOutcome = await repoA.listIntros({ sentWithoutOutcome: true });
    expect(noOutcome.map((r) => r.intro.id)).toContain(answered.intro.id);
    expect(noOutcome.map((r) => r.intro.id)).not.toContain(waiting.intro.id);
  });

  it("surfaces an intro from both sides on the contact", async () => {
    const { a, b, intro } = await proposed("complementary theses");
    await repoA.recordOptIn(intro.id, a.id, null);
    await repoA.recordOptIn(intro.id, b.id, null);
    await repoA.markIntroSent(intro.id);

    const fromA = await repoA.listIntrosForContact(a.id);
    const fromB = await repoA.listIntrosForContact(b.id);
    expect(fromA.map((i) => i.id)).toContain(intro.id);
    expect(fromB.map((i) => i.id)).toContain(intro.id);
    // Each side sees who THEY were connected to, not a raw slot.
    expect(fromA.find((i) => i.id === intro.id)!.introducedTo.id).toBe(b.id);
    expect(fromB.find((i) => i.id === intro.id)!.introducedTo.id).toBe(a.id);
  });

  it("counts toward the goal only what actually shipped with both yeses", async () => {
    const clean = await proposed("counts", repoC);
    await repoC.recordOptIn(clean.intro.id, clean.a.id, null);
    await repoC.recordOptIn(clean.intro.id, clean.b.id, null);
    await repoC.markIntroSent(clean.intro.id);

    const forced = await proposed("does not count", repoC);
    await repoC.markIntroSent(forced.intro.id, { force: true });

    // Never sent at all: absent from the numerator and the denominator.
    await proposed("never sent", repoC);

    const stats = await repoC.getIntroStats(12);
    expect(stats.goalPerMonth).toBe(2);
    expect(stats.timezone).toBe("America/New_York");
    expect(stats.doubleOptIn.total).toBe(2);
    expect(stats.doubleOptIn.compliant).toBe(1);
    expect(stats.doubleOptIn.rate).toBe(0.5);
    expect(stats.currentMonth.sent).toBe(2);
    expect(stats.inFlight.sentAwaitingOutcome).toBe(2);
    expect(stats.byMonth).toHaveLength(12);
  });

  it("reads the goal from the owner's settings", async () => {
    await db
      .update(users)
      .set({ settingsJson: { goals: { introsPerMonth: 5 } } })
      .where(eq(users.id, userCId));
    const stats = await repoC.getIntroStats(3);
    expect(stats.goalPerMonth).toBe(5);
    expect(stats.currentMonth.goal).toBe(5);
    await db.update(users).set({ settingsJson: null }).where(eq(users.id, userCId));
  });

  it("keeps intros inside their workspace", async () => {
    const { intro } = await proposed();
    expect(await repoB.getIntro(intro.id)).toBeNull();
    expect((await repoB.listIntros()).map((r) => r.intro.id)).not.toContain(intro.id);
    const optIn = await repoB.recordOptIn(intro.id, intro.personAContactId, null);
    expect("error" in optIn && optIn.error).toMatch(/not found/i);
    const sent = await repoB.markIntroSent(intro.id, { force: true });
    expect("error" in sent && sent.error).toMatch(/not found/i);

    const [untouched] = await db.select().from(intros).where(eq(intros.id, intro.id));
    expect(untouched.status).toBe("proposed");
  });

  it("gives the draft context the other person and the reason", async () => {
    const { a, b, intro } = await proposed("Both are chasing the same wedge");
    await repoA.recordOptIn(intro.id, a.id, null);
    await repoA.recordOptIn(intro.id, b.id, null);
    const sent = await repoA.markIntroSent(intro.id);
    if ("error" in sent || sent.blocked) throw new Error("expected send");

    const draft = await repoA.createDraft({
      contactId: a.id,
      followUpId: sent.followUp!.id,
      channel: "email",
    });
    const ctx = await repoA.buildDraftContext(draft.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.intro).not.toBeNull();
    // The counterpart is a different contact, so it must not be folded into
    // otherOpenFollowUps, which is scoped to this contact.
    expect(ctx!.intro!.otherPersonName).toContain(`IntroB`);
    expect(ctx!.intro!.reason).toBe("Both are chasing the same wedge");

    const { renderDraftContext } = await import("@/lib/drafting");
    const rendered = renderDraftContext(ctx!);
    expect(rendered).toMatch(/THIS IS AN INTRO CHECK-IN/);
    expect(rendered).toContain("Both are chasing the same wedge");
  });

  it("logs a revision for every transition", async () => {
    const { a, b, intro } = await proposed();
    await repoA.recordOptIn(intro.id, a.id, null, userAId);
    await repoA.recordOptIn(intro.id, b.id, null, userAId);
    await repoA.markIntroSent(intro.id, { actorUserId: userAId });
    await repoA.recordIntroOutcome(intro.id, "ongoing", "still talking", userAId);

    const rows = await db
      .select()
      .from(revisions)
      .where(eq(revisions.entityId, intro.id));
    const fields = rows.map((r) => r.field);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(fields).toContain("a_opted_in_at");
    expect(fields).toContain("b_opted_in_at");
    expect(fields).toContain("status");
    expect(fields).toContain("outcome");
    expect(fields).toContain("check_in_follow_up");
    expect(rows.every((r) => r.entityType === "intro")).toBe(true);
  });
});
