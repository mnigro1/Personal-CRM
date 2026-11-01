/**
 * Settings → Your data: the export route and account deletion.
 *
 * Two users, two workspaces. A's export must hold every one of A's rows and
 * none of B's; deleting A must empty every table of A while B stays exactly
 * as it was. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, or } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

// The route reads the signed-in user through requireSession, which needs a
// browser session. Stand it in: the test decides who is signed in.
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));

describe.skipIf(!hasDb)("your data: export and account deletion (integration)", async () => {
  const { db } = await import("@/db");
  const {
    accounts,
    contactTags,
    contacts,
    extractions,
    followUps,
    interactionContacts,
    interactions,
    intros,
    invites,
    mcpTokens,
    memories,
    messageDrafts,
    rateLimits,
    revisions,
    sessions,
    tags,
    users,
    verificationTokens,
    workspaces,
  } = await import("@/db/schema");
  const { repoFor } = await import("@/db/repo");
  const { deleteUserAccount } = await import("@/db/users");
  const { createMcpToken, resolveMcpToken } = await import("@/db/tokens");
  const { consumeRateLimit } = await import("@/db/rate-limit");
  const { requireSession } = await import("@/lib/session");
  const { GET } = await import("@/app/api/export/route");

  type Session = Awaited<ReturnType<typeof requireSession>>;

  const run = Date.now();
  const emailA = `yourdata-a-${run}@example.test`;
  const emailB = `yourdata-b-${run}@example.test`;
  const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  let a: Session, b: Session;
  let tokenA: string, tokenB: string;
  let alice: { id: string }, bob: { id: string }, carol: { id: string };
  let dave: { id: string }, daveTwin: { id: string };
  let interactionA: { id: string }, memoryA: { id: string };
  let followUpA: { id: string }, introA: { id: string }, draftA: { id: string };
  let extractionA: { id: string };
  let bContact: { id: string };
  const rawSourceA = `Coffee with Alice ${run}: she is moving to Boston in spring`;

  beforeAll(async () => {
    const [ua] = await db
      .insert(users)
      .values({
        email: emailA,
        name: "Person A",
        timezone: "America/New_York",
        settingsJson: {
          drafting: { voice: "Short and warm.", signOff: "-A", emoji: "never" },
          goals: { introsPerMonth: 3 },
          extraction: { autoApply: false },
        },
      })
      .returning();
    const [ub] = await db
      .insert(users)
      .values({ email: emailB, timezone: "UTC" })
      .returning();
    const [wa] = await db
      .insert(workspaces)
      .values({ ownerUserId: ua.id, name: "Your Data A" })
      .returning();
    const [wb] = await db
      .insert(workspaces)
      .values({ ownerUserId: ub.id, name: "Your Data B" })
      .returning();
    a = { user: ua, workspace: wa };
    b = { user: ub, workspace: wb };
    const repoA = repoFor(wa.id);
    const repoB = repoFor(wb.id);

    // --- A: one of everything, including the states the UI hides. -----------
    alice = await repoA.createContact({
      firstName: "Alice",
      lastName: `Export${run}`,
      emails: ["alice@example.test", "alice@work.test"],
      notes: 'Met at "the" summit, loves commas',
    });
    bob = await repoA.createContact({ firstName: "Bob", lastName: `Export${run}` });
    carol = await repoA.createContact({ firstName: "Carol", lastName: `Export${run}` });
    await repoA.softDeleteContact(carol.id);
    dave = await repoA.createContact({ firstName: "Dave", lastName: `Export${run}` });
    daveTwin = await repoA.createContact({ firstName: "Dave", lastName: `Export${run}`, phone: "+1 555 0100" });
    await repoA.mergeContacts({ survivorId: dave.id, loserId: daveTwin.id, actorUserId: ua.id });
    // A user-made edit, so revisions carries a row naming A as the actor.
    await repoA.updateContact(alice.id, { location: "Boston" }, ua.id);

    const created = await repoA.createInteraction({
      type: "coffee",
      occurredAt: new Date("2026-10-30T15:00:00Z"),
      rawSource: rawSourceA,
      sourceType: "manual_note",
      contactIds: [alice.id],
    });
    interactionA = created.interaction;
    memoryA = await repoA.addMemory({
      contactId: alice.id,
      text: "Moving to Boston in spring",
      category: "geography",
      sourceInteractionId: interactionA.id,
    });
    followUpA = await repoA.addFollowUp({
      contactId: alice.id,
      description: "Send the Boston list",
      reason: "She asked for it",
    });
    const intro = await repoA.createIntro({
      personAContactId: alice.id,
      personBContactId: bob.id,
      reason: "Both moving to Boston",
    });
    if (intro.blocked) throw new Error(intro.reason);
    introA = intro.intro;
    draftA = await repoA.createDraft({
      contactId: alice.id,
      followUpId: followUpA.id,
      channel: "email",
    });
    [extractionA] = await db
      .insert(extractions)
      .values({
        workspaceId: wa.id,
        interactionId: interactionA.id,
        model: "test",
        promptVersion: "test",
        status: "proposed",
        proposalJson: { new_memories: [] },
      })
      .returning();
    // The tags feature is gone, but old workspaces may still carry rows.
    const [tag] = await db
      .insert(tags)
      .values({ workspaceId: wa.id, name: "Old tag", normalizedName: `old tag ${run}` })
      .returning();
    await db
      .insert(contactTags)
      .values({ contactId: alice.id, tagId: tag.id, workspaceId: wa.id });

    tokenA = await createMcpToken(ua.id, "A's Claude");
    await db
      .insert(sessions)
      .values({ sessionToken: `yourdata-sess-a-${run}`, userId: ua.id, expires: inAWeek });
    await db.insert(accounts).values({
      userId: ua.id,
      type: "email",
      provider: "email",
      providerAccountId: `yourdata-acct-a-${run}`,
    });
    await db
      .insert(verificationTokens)
      .values({ identifier: emailA, token: `yourdata-vt-a-${run}`, expires: inAWeek });
    await repoA.createInvite(`friend-of-a-${run}@example.test`, ua.id);
    // The invite that let A in was sent by B and names A's address.
    await repoB.createInvite(emailA, ub.id);
    await consumeRateLimit(`signin:email:${emailA}`, { limit: 5, windowSeconds: 60 });

    // --- B: a mirror image that must not move. ------------------------------
    bContact = await repoB.createContact({ firstName: "BobsPerson", lastName: `Other${run}` });
    await repoB.updateContact(bContact.id, { location: "Denver" }, ub.id);
    const bInteraction = await repoB.createInteraction({
      type: "call",
      occurredAt: new Date("2026-10-29T15:00:00Z"),
      rawSource: `Call with BobsPerson ${run}`,
      sourceType: "manual_note",
      contactIds: [bContact.id],
    });
    await repoB.addMemory({
      contactId: bContact.id,
      text: "Likes Denver",
      category: "geography",
      sourceInteractionId: bInteraction.interaction.id,
    });
    await repoB.addFollowUp({ contactId: bContact.id, description: "Call back", reason: "Said so" });
    tokenB = await createMcpToken(ub.id, "B's Claude");
    await db
      .insert(sessions)
      .values({ sessionToken: `yourdata-sess-b-${run}`, userId: ub.id, expires: inAWeek });
    await repoB.createInvite(`friend-of-b-${run}@example.test`, ub.id);
    await consumeRateLimit(`signin:email:${emailB}`, { limit: 5, windowSeconds: 60 });
  });

  afterAll(async () => {
    // Belt and braces: A should already be gone; B must be cleaned by hand.
    for (const s of [a, b]) {
      if (!s) continue;
      const ws = s.workspace.id;
      await db.delete(revisions).where(eq(revisions.workspaceId, ws));
      await db.delete(extractions).where(eq(extractions.workspaceId, ws));
      await db.delete(messageDrafts).where(eq(messageDrafts.workspaceId, ws));
      await db.delete(followUps).where(eq(followUps.workspaceId, ws));
      await db.delete(intros).where(eq(intros.workspaceId, ws));
      await db.delete(memories).where(eq(memories.workspaceId, ws));
      await db.delete(interactionContacts).where(eq(interactionContacts.workspaceId, ws));
      await db.delete(interactions).where(eq(interactions.workspaceId, ws));
      await db.delete(contactTags).where(eq(contactTags.workspaceId, ws));
      await db.delete(tags).where(eq(tags.workspaceId, ws));
      await db.delete(contacts).where(eq(contacts.workspaceId, ws));
      await db.delete(workspaces).where(eq(workspaces.id, ws));
      await db.delete(mcpTokens).where(eq(mcpTokens.userId, s.user.id));
      await db
        .delete(invites)
        .where(or(eq(invites.invitedByUserId, s.user.id), eq(invites.email, s.user.email)));
      await db.delete(sessions).where(eq(sessions.userId, s.user.id));
      await db.delete(accounts).where(eq(accounts.userId, s.user.id));
      await db.delete(verificationTokens).where(eq(verificationTokens.identifier, s.user.email));
      await db
        .delete(rateLimits)
        .where(inArray(rateLimits.key, [`signin:email:${s.user.email}`, `export:${s.user.id}`]));
      await db.delete(users).where(eq(users.id, s.user.id));
    }
  });

  let exportCalls = 0;
  const download = async (query = "") => {
    exportCalls++;
    return GET(new Request(`http://localhost/api/export${query}`));
  };

  it("exports every table of the signed-in workspace and nothing from another", async () => {
    vi.mocked(requireSession).mockResolvedValue(a);
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="personal-crm-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = JSON.parse(await res.text());
    expect(body.format).toBe("personal-crm-export");
    expect(body.version).toBe(1);
    expect(body.profile).toMatchObject({
      email: emailA,
      name: "Person A",
      timezone: "America/New_York",
      settings: {
        drafting: { voice: "Short and warm.", signOff: "-A", emoji: "never" },
        goals: { introsPerMonth: 3 },
        extraction: { autoApply: false },
      },
    });
    expect(body.workspace).toMatchObject({ id: a.workspace.id, name: "Your Data A" });

    // Every contact, including the archived one and the merged-away twin,
    // each carrying the flag that says so.
    const byId = Object.fromEntries(
      (body.contacts as { id: string }[]).map((c) => [c.id, c]),
    ) as Record<string, Record<string, unknown>>;
    expect(Object.keys(byId).sort()).toEqual(
      [alice.id, bob.id, carol.id, dave.id, daveTwin.id].sort(),
    );
    expect(byId[alice.id].deletedAt).toBeNull();
    expect(byId[alice.id].notes).toBe('Met at "the" summit, loves commas');
    expect(byId[alice.id].emails).toEqual(["alice@example.test", "alice@work.test"]);
    expect(byId[carol.id].deletedAt).not.toBeNull();
    expect(byId[daveTwin.id].deletedAt).not.toBeNull();
    expect(byId[daveTwin.id].mergedIntoContactId).toBe(dave.id);

    // Layer 1 comes out verbatim, with its links.
    expect(body.interactions.map((i: { id: string }) => i.id)).toEqual([interactionA.id]);
    expect(body.interactions[0].rawSource).toBe(rawSourceA);
    expect(body.interactionContacts).toEqual([
      expect.objectContaining({ interactionId: interactionA.id, contactId: alice.id }),
    ]);
    expect(body.memories.map((m: { id: string }) => m.id)).toEqual([memoryA.id]);
    expect(body.memories[0].sourceInteractionId).toBe(interactionA.id);
    expect(body.followUps.map((f: { id: string }) => f.id)).toEqual([followUpA.id]);
    expect(body.intros.map((i: { id: string }) => i.id)).toEqual([introA.id]);
    expect(body.messageDrafts.map((d: { id: string }) => d.id)).toEqual([draftA.id]);
    expect(body.extractions.map((e: { id: string }) => e.id)).toEqual([extractionA.id]);
    expect(body.revisions.length).toBeGreaterThan(0);
    expect(
      body.revisions.some(
        (r: { entityId: string; field: string | null }) =>
          r.entityId === alice.id && r.field === "location",
      ),
    ).toBe(true);

    // Everything in the file belongs to A's workspace.
    for (const section of [
      "contacts", "interactions", "interactionContacts", "memories", "followUps",
      "intros", "messageDrafts", "extractions", "revisions",
    ]) {
      for (const row of body[section] as { workspaceId: string }[]) {
        expect(row.workspaceId, section).toBe(a.workspace.id);
      }
    }
    // And nothing of B's leaked in by id or by name.
    const text = JSON.stringify(body);
    expect(text).not.toContain(b.workspace.id);
    expect(text).not.toContain(bContact.id);
    expect(text).not.toContain("BobsPerson");
    expect(text).not.toContain(emailB);
  });

  it("the CSV has one row per live contact in the documented columns", async () => {
    vi.mocked(requireSession).mockResolvedValue(a);
    const res = await download("?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="personal-crm-contacts-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");

    // Response.text() strips a byte-order mark by spec, so check the bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const lines = text.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "First name,Last name,Preferred name,Emails,Phone,Company,Role,Location,LinkedIn,Website,How we met,Date first met,Category,Notes,Last interaction",
    );
    // Alice, Bob, Dave. Not Carol (archived), not the Dave that was merged away.
    expect(lines).toHaveLength(4);
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual(["Alice", "Bob", "Dave"]);
    const aliceLine = lines.find((l) => l.startsWith("Alice,"))!;
    expect(aliceLine).toContain("alice@example.test; alice@work.test");
    expect(aliceLine).toContain('"Met at ""the"" summit, loves commas"');
    expect(aliceLine).toContain(",Boston,");
    // Last interaction: Oct 30 15:00 UTC is Oct 30 in New York.
    expect(aliceLine).toMatch(/,2026-10-30$/);
    // The merge filled Dave's blank phone from the twin; the twin itself is gone.
    expect(lines.find((l) => l.startsWith("Dave,"))).toContain(",+1 555 0100,");
  });

  it("refuses a fourth download inside ten minutes with a friendly 429", async () => {
    vi.mocked(requireSession).mockResolvedValue(a);
    const statuses: number[] = [];
    while (statuses.at(-1) !== 429 && statuses.length < 6) {
      statuses.push((await download("?format=csv")).status);
    }
    expect(statuses.at(-1)).toBe(429);
    // Three downloads went through across this file; the fourth was refused.
    expect(exportCalls).toBe(4);

    const res = await download();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toMatch(/downloaded your data 3 times in the last 10 minutes/);

    // The limit is per user: B is unaffected.
    vi.mocked(requireSession).mockResolvedValue(b);
    const forB = await GET(new Request("http://localhost/api/export?format=csv"));
    expect(forB.status).toBe(200);
    expect((await forB.text()).split("\r\n")[1]).toMatch(/^BobsPerson,/);
  });

  it("deleting A removes every row tied to A and leaves B untouched", async () => {
    expect(await resolveMcpToken(tokenA)).not.toBeNull();
    const bRevisionsBefore = await db
      .select()
      .from(revisions)
      .where(eq(revisions.workspaceId, b.workspace.id));
    expect(bRevisionsBefore.length).toBeGreaterThan(0);

    await deleteUserAccount(a.user.id);

    const ws = a.workspace.id;
    const uid = a.user.id;
    const gone = {
      users: await db.select().from(users).where(eq(users.id, uid)),
      workspaces: await db.select().from(workspaces).where(eq(workspaces.ownerUserId, uid)),
      contacts: await db.select().from(contacts).where(eq(contacts.workspaceId, ws)),
      interactions: await db.select().from(interactions).where(eq(interactions.workspaceId, ws)),
      interactionContacts: await db
        .select()
        .from(interactionContacts)
        .where(eq(interactionContacts.workspaceId, ws)),
      memories: await db.select().from(memories).where(eq(memories.workspaceId, ws)),
      followUps: await db.select().from(followUps).where(eq(followUps.workspaceId, ws)),
      intros: await db.select().from(intros).where(eq(intros.workspaceId, ws)),
      messageDrafts: await db.select().from(messageDrafts).where(eq(messageDrafts.workspaceId, ws)),
      extractions: await db.select().from(extractions).where(eq(extractions.workspaceId, ws)),
      revisions: await db.select().from(revisions).where(eq(revisions.workspaceId, ws)),
      revisionsAsActor: await db.select().from(revisions).where(eq(revisions.actorUserId, uid)),
      tags: await db.select().from(tags).where(eq(tags.workspaceId, ws)),
      contactTags: await db.select().from(contactTags).where(eq(contactTags.workspaceId, ws)),
      mcpTokens: await db.select().from(mcpTokens).where(eq(mcpTokens.userId, uid)),
      invitesSent: await db.select().from(invites).where(eq(invites.invitedByUserId, uid)),
      invitesReceived: await db.select().from(invites).where(eq(invites.email, emailA)),
      sessions: await db.select().from(sessions).where(eq(sessions.userId, uid)),
      accounts: await db.select().from(accounts).where(eq(accounts.userId, uid)),
      verificationTokens: await db
        .select()
        .from(verificationTokens)
        .where(eq(verificationTokens.identifier, emailA)),
      rateLimits: await db
        .select()
        .from(rateLimits)
        .where(inArray(rateLimits.key, [`signin:email:${emailA}`, `export:${uid}`])),
    };
    for (const [table, rows] of Object.entries(gone)) {
      expect(rows, table).toHaveLength(0);
    }
    // The connector is cut off, not merely orphaned.
    expect(await resolveMcpToken(tokenA)).toBeNull();

    // B: still whole.
    const wsB = b.workspace.id;
    const uidB = b.user.id;
    expect(await db.select().from(users).where(eq(users.id, uidB))).toHaveLength(1);
    expect(await db.select().from(workspaces).where(eq(workspaces.id, wsB))).toHaveLength(1);
    expect(await db.select().from(contacts).where(eq(contacts.workspaceId, wsB))).toHaveLength(1);
    expect(await db.select().from(interactions).where(eq(interactions.workspaceId, wsB))).toHaveLength(1);
    expect(
      await db.select().from(interactionContacts).where(eq(interactionContacts.workspaceId, wsB)),
    ).toHaveLength(1);
    expect(await db.select().from(memories).where(eq(memories.workspaceId, wsB))).toHaveLength(1);
    expect(await db.select().from(followUps).where(eq(followUps.workspaceId, wsB))).toHaveLength(1);
    expect(await db.select().from(revisions).where(eq(revisions.workspaceId, wsB))).toEqual(
      bRevisionsBefore,
    );
    expect(await db.select().from(mcpTokens).where(eq(mcpTokens.userId, uidB))).toHaveLength(1);
    expect(await resolveMcpToken(tokenB)).not.toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, uidB))).toHaveLength(1);
    // B's invite to someone else survives; only the one addressed to A went.
    expect(
      (await db.select().from(invites).where(eq(invites.invitedByUserId, uidB))).map((i) => i.email),
    ).toEqual([`friend-of-b-${run}@example.test`]);
    expect(
      await db.select().from(rateLimits).where(eq(rateLimits.key, `signin:email:${emailB}`)),
    ).toHaveLength(1);

    // Deleting again is a no-op, not an error.
    await expect(deleteUserAccount(uid)).resolves.toBeUndefined();
  });
});
