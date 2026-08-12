import { and, desc, eq, gte, inArray, isNull, isNotNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  contacts,
  followUps,
  intros,
  revisions,
  users,
  workspaces,
  type introOutcome,
  type introStatus,
  type messageChannel,
} from "@/db/schema";

type IntroStatus = (typeof introStatus.enumValues)[number];
type IntroOutcome = (typeof introOutcome.enumValues)[number];
type Channel = (typeof messageChannel.enumValues)[number];

/** Statuses that mean the intro is finished, one way or another. */
export const TERMINAL_INTRO_STATUSES: IntroStatus[] = [
  "completed",
  "declined",
  "abandoned",
];

/** How many intros a month counts as on target, when nothing is configured. */
export const DEFAULT_INTROS_PER_MONTH = 2;

/** Base-repo methods the intro ops depend on. */
type BaseRepo = {
  addFollowUp(data: {
    contactId: string;
    description: string;
    reason: string;
    dueDate?: string | null;
    priority?: "low" | "medium" | "high";
    createdBy?: "user" | "ai";
    introId?: string | null;
  }): Promise<typeof followUps.$inferSelect>;
  completeFollowUp(
    followUpId: string,
  ): Promise<typeof followUps.$inferSelect | null>;
};

/**
 * The double opt-in rule, in one place.
 *
 * An intro only counts if BOTH sides said yes BEFORE it went out. Deriving it
 * from the timestamps rather than storing a boolean means the metric can't
 * drift from the evidence, and recording an opt-in after the fact correctly
 * fails to rescue a non-compliant intro.
 */
export function isDoubleOptIn(intro: {
  aOptedInAt: Date | null;
  bOptedInAt: Date | null;
  sentAt: Date | null;
}): boolean {
  const { aOptedInAt, bOptedInAt, sentAt } = intro;
  if (!aOptedInAt || !bOptedInAt || !sentAt) return false;
  return aOptedInAt < sentAt && bOptedInAt < sentAt;
}

/** Status implied by the opt-in timestamps, so the two can never disagree. */
function statusFromOptIns(a: Date | null, b: Date | null): IntroStatus {
  if (a && b) return "opt_in_confirmed";
  if (a || b) return "opt_in_pending";
  return "proposed";
}

export function introOpsFor(workspaceId: string, base: BaseRepo) {
  const inWs = (id: string) =>
    and(eq(intros.id, id), eq(intros.workspaceId, workspaceId));

  async function load(id: string) {
    const [row] = await db.select().from(intros).where(inWs(id));
    return row ?? null;
  }

  /** Both people must already exist here. Mirrors create_contact's block. */
  async function requireContacts(ids: string[]) {
    const found = await db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          isNull(contacts.deletedAt),
          inArray(contacts.id, ids),
        ),
      );
    const missing = ids.filter((id) => !found.some((f) => f.id === id));
    return { found, missing };
  }

  async function logRevision(row: {
    entityId: string;
    field?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    actorUserId?: string | null;
  }) {
    await db.insert(revisions).values({
      workspaceId,
      entityType: "intro",
      entityId: row.entityId,
      field: row.field ?? null,
      oldValue: JSON.parse(JSON.stringify(row.oldValue ?? null)),
      newValue: JSON.parse(JSON.stringify(row.newValue ?? null)),
      changeSource: "user",
      actorUserId: row.actorUserId ?? null,
    });
  }

  const nameOf = (c: { firstName: string; lastName: string | null }) =>
    `${c.firstName} ${c.lastName ?? ""}`.trim();

  return {
    /**
     * Create an intro. Blocks on a live intro for the same unordered pair and
     * returns it, rather than forking a second record for one relationship.
     */
    async createIntro(data: {
      personAContactId: string;
      personBContactId: string;
      reason: string;
      channel?: Channel | null;
      channelLabel?: string | null;
      aOptedInAt?: Date | null;
      bOptedInAt?: Date | null;
      /** Backfill path: the intro already went out before this feature existed. */
      sentAt?: Date | null;
      introInteractionId?: string | null;
      actorUserId?: string | null;
    }) {
      if (data.personAContactId === data.personBContactId) {
        return {
          blocked: true as const,
          reason: "An intro needs two different people.",
        };
      }

      const { found, missing } = await requireContacts([
        data.personAContactId,
        data.personBContactId,
      ]);
      if (missing.length > 0) {
        return {
          blocked: true as const,
          reason:
            "Both people must already be contacts before you can log an intro. Call create_contact for the missing one first, then retry with the id it returns.",
          missingContactIds: missing,
        };
      }

      // Unordered-pair check. The partial unique index enforces this against
      // races too; this exists to return the existing intro instead of an error.
      const [existing] = await db
        .select()
        .from(intros)
        .where(
          and(
            eq(intros.workspaceId, workspaceId),
            sql`least(${intros.personAContactId}, ${intros.personBContactId}) = least(${data.personAContactId}::uuid, ${data.personBContactId}::uuid)`,
            sql`greatest(${intros.personAContactId}, ${intros.personBContactId}) = greatest(${data.personAContactId}::uuid, ${data.personBContactId}::uuid)`,
            sql`${intros.status} NOT IN ('completed', 'declined', 'abandoned')`,
          ),
        )
        .limit(1);
      if (existing) {
        return {
          blocked: true as const,
          reason:
            "These two already have an intro in flight. Use that one rather than starting a second — an intro is a single relationship, not an event log.",
          existingIntro: existing,
        };
      }

      const a = data.aOptedInAt ?? null;
      const b = data.bOptedInAt ?? null;
      const sentAt = data.sentAt ?? null;
      const status: IntroStatus = sentAt ? "sent" : statusFromOptIns(a, b);

      const [row] = await db
        .insert(intros)
        .values({
          workspaceId,
          personAContactId: data.personAContactId,
          personBContactId: data.personBContactId,
          reason: data.reason,
          status,
          aOptedInAt: a,
          bOptedInAt: b,
          sentAt,
          channel: data.channel ?? null,
          channelLabel: data.channelLabel ?? null,
          introInteractionId: data.introInteractionId ?? null,
        })
        .returning();

      await logRevision({
        entityId: row.id,
        newValue: row,
        actorUserId: data.actorUserId,
      });

      // A backfilled intro that is already sent still deserves its check-in.
      let followUp: typeof followUps.$inferSelect | null = null;
      if (sentAt) {
        followUp = await spawnCheckIn(row, found, data.actorUserId ?? null);
      }

      return { blocked: false as const, intro: row, followUp };
    },

    /**
     * Record one side's yes. Status follows the timestamps automatically.
     *
     * Locks the row for the read-modify-write: clients batch independent tool
     * calls in parallel, and without the lock two simultaneous opt-ins each
     * read "neither has said yes", so the second write erases the first and
     * the intro sits at opt_in_pending with both people having agreed.
     */
    async recordOptIn(
      introId: string,
      contactId: string,
      optedInAt: Date | null,
      actorUserId?: string | null,
    ) {
      const outcome = await db.transaction(async (tx) => {
        const [intro] = await tx
          .select()
          .from(intros)
          .where(inWs(introId))
          .for("update");
        if (!intro) return { error: "Intro not found" as const };
        if (TERMINAL_INTRO_STATUSES.includes(intro.status)) {
          return { error: "That intro is already finished" as const };
        }
        const isA = intro.personAContactId === contactId;
        const isB = intro.personBContactId === contactId;
        if (!isA && !isB) {
          return { error: "That contact is not part of this intro" as const };
        }

        const at = optedInAt ?? new Date();
        const a = isA ? at : intro.aOptedInAt;
        const b = isB ? at : intro.bOptedInAt;
        // Never downgrade a sent intro back into the opt-in states.
        const status: IntroStatus =
          intro.status === "sent" ? "sent" : statusFromOptIns(a, b);

        const [row] = await tx
          .update(intros)
          .set({
            aOptedInAt: a,
            bOptedInAt: b,
            status,
            updatedAt: new Date(),
          })
          .where(inWs(introId))
          .returning();

        return {
          intro: row,
          field: isA ? ("a_opted_in_at" as const) : ("b_opted_in_at" as const),
          previous:
            (isA ? intro.aOptedInAt : intro.bOptedInAt)?.toISOString() ?? null,
          at,
        };
      });

      if ("error" in outcome) return outcome;
      await logRevision({
        entityId: introId,
        field: outcome.field,
        oldValue: outcome.previous,
        newValue: outcome.at.toISOString(),
        actorUserId,
      });
      return { intro: outcome.intro };
    },

    /**
     * Send it. Refuses without both opt-ins recorded before now, unless
     * forced — a metric that silently counts un-asked intros is worthless.
     */
    async markIntroSent(
      introId: string,
      opts: {
        sentAt?: Date | null;
        channel?: Channel | null;
        channelLabel?: string | null;
        introInteractionId?: string | null;
        force?: boolean;
        actorUserId?: string | null;
      } = {},
    ) {
      // Locked for the same reason as recordOptIn: without it two parallel
      // sends both pass the status check and both spawn a check-in.
      type SendTx =
        | { kind: "error"; error: string }
        | { kind: "blocked"; reason: string }
        | {
            kind: "ok";
            row: typeof intros.$inferSelect;
            previousStatus: IntroStatus;
            wouldComply: boolean;
          };

      const outcome: SendTx = await db.transaction(async (tx): Promise<SendTx> => {
        const [intro] = await tx
          .select()
          .from(intros)
          .where(inWs(introId))
          .for("update");
        if (!intro) return { kind: "error", error: "Intro not found" };
        if (intro.status === "sent") {
          return { kind: "error", error: "That intro was already marked sent" };
        }
        if (TERMINAL_INTRO_STATUSES.includes(intro.status)) {
          return { kind: "error", error: "That intro is already finished" };
        }

        const sentAt = opts.sentAt ?? new Date();
        const wouldComply = isDoubleOptIn({
          aOptedInAt: intro.aOptedInAt,
          bOptedInAt: intro.bOptedInAt,
          sentAt,
        });
        if (!wouldComply && !opts.force) {
          const which = [
            !intro.aOptedInAt ? "person A" : null,
            !intro.bOptedInAt ? "person B" : null,
          ].filter(Boolean);
          return {
            kind: "blocked",
            reason:
              which.length > 0
                ? `${which.join(" and ")} has not opted in yet. Record it with record_intro_opt_in first. If it genuinely went out without asking, retry with force: true — it will be logged and excluded from the double opt-in rate.`
                : "The opt-ins are dated at or after this send time, so this would not count as double opt-in. Fix the timestamps, or retry with force: true.",
          };
        }

        const [row] = await tx
          .update(intros)
          .set({
            status: "sent",
            sentAt,
            channel: opts.channel ?? intro.channel,
            channelLabel: opts.channelLabel ?? intro.channelLabel,
            introInteractionId:
              opts.introInteractionId ?? intro.introInteractionId,
            updatedAt: new Date(),
          })
          .where(inWs(introId))
          .returning();

        return {
          kind: "ok",
          row,
          previousStatus: intro.status,
          wouldComply,
        };
      });

      if (outcome.kind === "error") return { error: outcome.error };
      if (outcome.kind === "blocked") {
        return { blocked: true as const, reason: outcome.reason };
      }
      const { row, previousStatus, wouldComply } = outcome;

      await logRevision({
        entityId: introId,
        field: "status",
        oldValue: previousStatus,
        newValue: "sent",
        actorUserId: opts.actorUserId,
      });

      const { found } = await requireContacts([
        row.personAContactId,
        row.personBContactId,
      ]);
      const followUp = await spawnCheckIn(row, found, opts.actorUserId ?? null);

      return {
        blocked: false as const,
        intro: row,
        followUp,
        doubleOptIn: isDoubleOptIn(row),
        forced: !wouldComply,
      };
    },

    /** Record what actually happened, and close the check-in in one step. */
    async recordIntroOutcome(
      introId: string,
      outcome: IntroOutcome,
      note?: string | null,
      actorUserId?: string | null,
    ) {
      const intro = await load(introId);
      if (!intro) return { error: "Intro not found" as const };
      if (!intro.sentAt) {
        return {
          error:
            "That intro hasn't been sent yet, so there is no outcome to record" as const,
        };
      }

      const [row] = await db
        .update(intros)
        .set({
          outcome,
          outcomeNote: note ?? null,
          outcomeRecordedAt: new Date(),
          status: "completed",
          updatedAt: new Date(),
        })
        .where(inWs(introId))
        .returning();

      await logRevision({
        entityId: introId,
        field: "outcome",
        oldValue: intro.outcome,
        newValue: outcome,
        actorUserId,
      });

      // Recording the outcome IS closing the loop; don't make the user do it
      // twice. Only the intro's own check-ins, and only ones still open.
      const linked = await db
        .select()
        .from(followUps)
        .where(
          and(
            eq(followUps.workspaceId, workspaceId),
            eq(followUps.introId, introId),
            eq(followUps.status, "open"),
          ),
        );
      for (const f of linked) await base.completeFollowUp(f.id);

      return { intro: row, followUpsCompleted: linked.length };
    },

    /** Close an intro without an outcome: declined, or quietly dropped. */
    async closeIntro(
      introId: string,
      status: Extract<IntroStatus, "declined" | "abandoned">,
      actorUserId?: string | null,
    ) {
      const intro = await load(introId);
      if (!intro) return { error: "Intro not found" as const };
      const [row] = await db
        .update(intros)
        .set({ status, updatedAt: new Date() })
        .where(inWs(introId))
        .returning();
      await logRevision({
        entityId: introId,
        field: "status",
        oldValue: intro.status,
        newValue: status,
        actorUserId,
      });
      const linked = await db
        .select()
        .from(followUps)
        .where(
          and(
            eq(followUps.workspaceId, workspaceId),
            eq(followUps.introId, introId),
            eq(followUps.status, "open"),
          ),
        );
      for (const f of linked) await base.completeFollowUp(f.id);
      return { intro: row };
    },

    async getIntro(introId: string) {
      const a = alias(contacts, "person_a");
      const b = alias(contacts, "person_b");
      const [row] = await db
        .select({ intro: intros, personA: a, personB: b })
        .from(intros)
        .innerJoin(a, eq(a.id, intros.personAContactId))
        .innerJoin(b, eq(b.id, intros.personBContactId))
        .where(inWs(introId));
      return row ?? null;
    },

    async listIntros(
      filters: {
        status?: IntroStatus[];
        awaitingOptIn?: boolean;
        sentWithoutOutcome?: boolean;
        contactId?: string;
        from?: Date;
        to?: Date;
      } = {},
    ) {
      const a = alias(contacts, "person_a");
      const b = alias(contacts, "person_b");
      const where = [eq(intros.workspaceId, workspaceId)];

      if (filters.status?.length) where.push(inArray(intros.status, filters.status));
      if (filters.awaitingOptIn) {
        where.push(
          sql`${intros.status} NOT IN ('completed', 'declined', 'abandoned', 'sent')`,
        );
        where.push(
          or(isNull(intros.aOptedInAt), isNull(intros.bOptedInAt))!,
        );
      }
      if (filters.sentWithoutOutcome) {
        where.push(isNotNull(intros.sentAt));
        where.push(isNull(intros.outcome));
      }
      if (filters.contactId) {
        where.push(
          or(
            eq(intros.personAContactId, filters.contactId),
            eq(intros.personBContactId, filters.contactId),
          )!,
        );
      }
      // Range applies to when it went out, which is what the goal counts.
      if (filters.from) where.push(gte(intros.sentAt, filters.from));
      if (filters.to) where.push(lte(intros.sentAt, filters.to));

      return db
        .select({ intro: intros, personA: a, personB: b })
        .from(intros)
        .innerJoin(a, eq(a.id, intros.personAContactId))
        .innerJoin(b, eq(b.id, intros.personBContactId))
        .where(and(...where))
        .orderBy(desc(sql`coalesce(${intros.sentAt}, ${intros.createdAt})`));
    },

    /** Every intro touching one person, in either direction. */
    async listIntrosForContact(contactId: string) {
      const a = alias(contacts, "person_a");
      const b = alias(contacts, "person_b");
      const rows = await db
        .select({ intro: intros, personA: a, personB: b })
        .from(intros)
        .innerJoin(a, eq(a.id, intros.personAContactId))
        .innerJoin(b, eq(b.id, intros.personBContactId))
        .where(
          and(
            eq(intros.workspaceId, workspaceId),
            or(
              eq(intros.personAContactId, contactId),
              eq(intros.personBContactId, contactId),
            ),
          ),
        )
        .orderBy(desc(sql`coalesce(${intros.sentAt}, ${intros.createdAt})`));

      return rows.map(({ intro, personA, personB }) => {
        const isA = intro.personAContactId === contactId;
        const other = isA ? personB : personA;
        return {
          id: intro.id,
          status: intro.status,
          reason: intro.reason,
          // The useful framing from this contact's page: who they were
          // connected to, not which arbitrary slot they occupy.
          introducedTo: { id: other.id, name: nameOf(other) },
          sentAt: intro.sentAt,
          doubleOptIn: isDoubleOptIn(intro),
          outcome: intro.outcome,
          outcomeNote: intro.outcomeNote,
        };
      });
    },

    /**
     * Goal tracking. Months are bucketed in the owner's timezone, not UTC,
     * or an intro sent late on the 31st lands in the wrong month.
     */
    async getIntroStats(monthsBack = 12) {
      const [owner] = await db
        .select({ tz: users.timezone, settings: users.settingsJson })
        .from(workspaces)
        .innerJoin(users, eq(users.id, workspaces.ownerUserId))
        .where(eq(workspaces.id, workspaceId));

      const tz = owner?.tz ?? "UTC";
      const settings = (owner?.settings ?? {}) as Record<string, unknown>;
      const goals = (settings.goals ?? {}) as Record<string, unknown>;
      const goalPerMonth =
        typeof goals.introsPerMonth === "number" && goals.introsPerMonth > 0
          ? goals.introsPerMonth
          : DEFAULT_INTROS_PER_MONTH;

      const sent = await db
        .select()
        .from(intros)
        .where(
          and(eq(intros.workspaceId, workspaceId), isNotNull(intros.sentAt)),
        );

      const monthKey = (d: Date) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
        }).format(d);

      const byMonth = new Map<string, { sent: number; doubleOptIn: number }>();
      for (const i of sent) {
        const k = monthKey(i.sentAt!);
        const e = byMonth.get(k) ?? { sent: 0, doubleOptIn: 0 };
        e.sent++;
        if (isDoubleOptIn(i)) e.doubleOptIn++;
        byMonth.set(k, e);
      }

      // Walk back real calendar months so empty ones still appear as zero.
      const now = new Date();
      const months: { month: string; sent: number; doubleOptIn: number; goal: number; metGoal: boolean }[] = [];
      const cursor = new Date(now);
      for (let n = 0; n < monthsBack; n++) {
        const k = monthKey(cursor);
        const e = byMonth.get(k) ?? { sent: 0, doubleOptIn: 0 };
        months.push({
          month: k,
          sent: e.sent,
          doubleOptIn: e.doubleOptIn,
          goal: goalPerMonth,
          metGoal: e.sent >= goalPerMonth,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() - 1, 15);
      }

      const thisMonth = months[0];
      const rolling = months.reduce((n, m) => n + m.sent, 0);
      const rollingCompliant = months.reduce((n, m) => n + m.doubleOptIn, 0);

      const outcomes: Record<string, number> = {};
      for (const i of sent) {
        const key = i.outcome ?? "not_yet_recorded";
        outcomes[key] = (outcomes[key] ?? 0) + 1;
      }

      const [awaitingOptIn] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(intros)
        .where(
          and(
            eq(intros.workspaceId, workspaceId),
            sql`${intros.status} NOT IN ('completed', 'declined', 'abandoned', 'sent')`,
          ),
        );
      const [awaitingOutcome] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(intros)
        .where(
          and(
            eq(intros.workspaceId, workspaceId),
            isNotNull(intros.sentAt),
            isNull(intros.outcome),
          ),
        );

      return {
        timezone: tz,
        goalPerMonth,
        currentMonth: {
          month: thisMonth.month,
          sent: thisMonth.sent,
          goal: goalPerMonth,
          remaining: Math.max(0, goalPerMonth - thisMonth.sent),
          metGoal: thisMonth.metGoal,
        },
        rolling: {
          months: monthsBack,
          sent: rolling,
          goal: goalPerMonth * monthsBack,
          onPace: rolling >= goalPerMonth * monthsBack,
        },
        doubleOptIn: {
          compliant: rollingCompliant,
          total: rolling,
          // Honest by construction: forced sends fail the derived check.
          rate: rolling === 0 ? null : Number((rollingCompliant / rolling).toFixed(2)),
        },
        outcomeDistribution: outcomes,
        inFlight: {
          awaitingOptIn: awaitingOptIn?.n ?? 0,
          sentAwaitingOutcome: awaitingOutcome?.n ?? 0,
        },
        byMonth: months,
      };
    },
  };

  /** The 30-day check-in. Callers never have to remember it. */
  async function spawnCheckIn(
    intro: typeof intros.$inferSelect,
    people: { id: string; firstName: string; lastName: string | null }[],
    actorUserId: string | null,
  ) {
    const a = people.find((p) => p.id === intro.personAContactId);
    const b = people.find((p) => p.id === intro.personBContactId);
    const aName = a ? nameOf(a) : "them";
    const bName = b ? nameOf(b) : "the other person";

    const due = new Date(intro.sentAt ?? new Date());
    due.setUTCDate(due.getUTCDate() + 30);

    const followUp = await base.addFollowUp({
      contactId: intro.personAContactId,
      description: `Ask ${aName} and ${bName} whether the intro went anywhere`,
      reason: `You introduced them on ${(intro.sentAt ?? new Date())
        .toISOString()
        .slice(0, 10)} because: ${intro.reason}`,
      dueDate: due.toISOString().slice(0, 10),
      priority: "medium",
      // No 'system' value on the created_by enum; intro_id is the marker.
      createdBy: "ai",
      introId: intro.id,
    });

    await logRevision({
      entityId: intro.id,
      field: "check_in_follow_up",
      newValue: { followUpId: followUp.id, dueDate: followUp.dueDate },
      actorUserId,
    });
    return followUp;
  }
}
