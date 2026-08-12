import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  contacts,
  followUps,
  interactions,
  interactionContacts,
  intros,
  memories,
  messageDrafts,
  users,
  workspaces,
} from "@/db/schema";
import {
  CHANNEL_SPECS,
  DRAFT_PROMPT_VERSION,
  selectMemories,
  voiceFor,
  type Channel,
  type DraftContext,
} from "@/lib/drafting";

/** Base-repo methods the draft ops depend on. */
type BaseRepo = {
  createInteraction(data: {
    type: (typeof interactions.$inferInsert)["type"];
    occurredAt: Date;
    location?: string | null;
    rawSource: string;
    sourceType: (typeof interactions.$inferInsert)["sourceType"];
    extractionStatus?: (typeof interactions.$inferInsert)["extractionStatus"];
    contactIds: string[];
  }): Promise<{
    duplicate: boolean;
    interaction: typeof interactions.$inferSelect;
  }>;
  completeFollowUp(
    followUpId: string,
  ): Promise<typeof followUps.$inferSelect | null>;
};

/**
 * What the user says actually went out. There is no default — a caller that
 * forgets to decide fails to compile rather than silently writing an
 * unsent AI draft into immutable Layer 1.
 */
export type SentOutcome =
  /** The draft's text is what went out. Logged verbatim. */
  | { kind: "as_written" }
  /** Something else went out. Logged only if the user pasted it. */
  | { kind: "different"; text?: string | null }
  /** Called, met, wrote it fresh elsewhere. Nothing is logged, ever. */
  | { kind: "other_channel" };

export function draftOpsFor(workspaceId: string, base: BaseRepo) {
  const ws = (col: typeof messageDrafts.workspaceId) =>
    eq(col, workspaceId);

  /**
   * Voice and timezone live on the workspace owner. Resolved here rather than
   * passed in, so the web page and the hosted MCP endpoint (which only ever
   * holds a token-resolved id) build byte-identical context.
   */
  async function loadOwner(): Promise<typeof users.$inferSelect | null> {
    const [row] = await db
      .select({ user: users })
      .from(workspaces)
      .innerJoin(users, eq(users.id, workspaces.ownerUserId))
      .where(eq(workspaces.id, workspaceId));
    return row?.user ?? null;
  }

  /** Rows the UI treats as "live" — a draft in flight for this follow-up. */
  const ACTIVE: ("requested" | "drafted")[] = ["requested", "drafted"];

  return {
    async createDraft(data: {
      contactId?: string;
      followUpId?: string | null;
      channel: Channel;
      channelLabel?: string | null;
      instruction?: string | null;
      createdBy?: "user" | "ai";
      /** Confirms replacing a draft the user has edited by hand. */
      force?: boolean;
    }) {
      let contactId = data.contactId;

      // A follow-up that's already closed can't be drafted against. Enforced
      // here rather than in the UI so the MCP path is covered too.
      if (data.followUpId) {
        const [followUp] = await db
          .select()
          .from(followUps)
          .where(
            and(
              eq(followUps.id, data.followUpId),
              eq(followUps.workspaceId, workspaceId),
            ),
          );
        if (!followUp) throw new Error("Follow-up not found");
        if (followUp.status !== "open") {
          throw new Error("That follow-up is already closed");
        }
        // The follow-up is the source of truth for who this message is to.
        // A caller-supplied contactId that disagrees would build context for
        // one person and a draft addressed to another.
        contactId = followUp.contactId;

        // One live draft per follow-up: a double-click or a repeated call
        // continues the draft in flight instead of forking a second.
        const [existing] = await db
          .select()
          .from(messageDrafts)
          .where(
            and(
              ws(messageDrafts.workspaceId),
              eq(messageDrafts.followUpId, data.followUpId),
              inArray(messageDrafts.status, ACTIVE),
            ),
          )
          .orderBy(desc(messageDrafts.requestedAt))
          .limit(1);

        if (existing) {
          // Asking again for a draft that's already WRITTEN means "write it
          // again" (new notes, different channel, a fresh angle). Returning
          // it untouched froze it: saveDraftBody only accepts `requested`,
          // so the caller could never write and had no way back.
          if (existing.status === "drafted") {
            const edited =
              existing.aiBody !== null && existing.body !== existing.aiBody;
            // Silently discarding the user's own rewrite is the worst thing
            // this feature could do, so that case has to be confirmed.
            if (edited && !data.force) {
              throw new Error(
                "That draft has edits the user made themselves, and re-drafting would replace them. Ask the user to confirm, then retry with force: true.",
              );
            }
            const [reset] = await db
              .update(messageDrafts)
              .set({
                status: "requested",
                channel: data.channel,
                channelLabel: data.channelLabel ?? null,
                instruction: data.instruction?.trim() || null,
                requestedAt: new Date(),
                draftedAt: null,
              })
              .where(eq(messageDrafts.id, existing.id))
              .returning();
            return reset;
          }

          // Still `requested` and unwritten: nothing to lose, so let a
          // repeat call correct the channel or add a steer.
          const [updated] = await db
            .update(messageDrafts)
            .set({
              channel: data.channel,
              channelLabel: data.channelLabel ?? null,
              instruction: data.instruction?.trim() || existing.instruction,
            })
            .where(eq(messageDrafts.id, existing.id))
            .returning();
          return updated;
        }
      }

      if (!contactId) {
        throw new Error("A draft needs a contactId or a followUpId");
      }

      const [row] = await db
        .insert(messageDrafts)
        .values({
          workspaceId,
          contactId,
          followUpId: data.followUpId ?? null,
          channel: data.channel,
          channelLabel: data.channelLabel ?? null,
          instruction: data.instruction ?? null,
          createdBy: data.createdBy ?? "user",
          status: "requested",
        })
        .returning();
      return row;
    },

    async getDraft(draftId: string) {
      const [row] = await db
        .select({
          draft: messageDrafts,
          contact: contacts,
          followUp: followUps,
        })
        .from(messageDrafts)
        .innerJoin(contacts, eq(contacts.id, messageDrafts.contactId))
        .leftJoin(followUps, eq(followUps.id, messageDrafts.followUpId))
        .where(
          and(eq(messageDrafts.id, draftId), ws(messageDrafts.workspaceId)),
        );
      return row ?? null;
    },

    /** Live drafts keyed by follow-up id, so rows can show "Draft ready". */
    async activeDraftsByFollowUp(followUpIds: string[]) {
      if (followUpIds.length === 0) return new Map<string, typeof messageDrafts.$inferSelect>();
      const rows = await db
        .select()
        .from(messageDrafts)
        .where(
          and(
            ws(messageDrafts.workspaceId),
            inArray(messageDrafts.followUpId, followUpIds),
            inArray(messageDrafts.status, ACTIVE),
          ),
        )
        .orderBy(desc(messageDrafts.requestedAt));
      const map = new Map<string, typeof messageDrafts.$inferSelect>();
      for (const r of rows) {
        // Newest first, so the first one seen per follow-up wins.
        if (r.followUpId && !map.has(r.followUpId)) map.set(r.followUpId, r);
      }
      return map;
    },

    async listPendingDrafts() {
      return db
        .select({
          draft: messageDrafts,
          contact: {
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            preferredName: contacts.preferredName,
          },
          followUp: followUps,
        })
        .from(messageDrafts)
        .innerJoin(contacts, eq(contacts.id, messageDrafts.contactId))
        .leftJoin(followUps, eq(followUps.id, messageDrafts.followUpId))
        .where(
          and(
            ws(messageDrafts.workspaceId),
            eq(messageDrafts.status, "requested"),
            isNull(contacts.deletedAt),
          ),
        )
        .orderBy(desc(messageDrafts.requestedAt));
    },

    /**
     * Everything the model needs, assembled server-side so the MCP client and
     * any direct-API provider see byte-identical context.
     */
    async buildDraftContext(draftId: string): Promise<DraftContext | null> {
      const owner = await loadOwner();
      if (!owner) return null;
      const [row] = await db
        .select({
          draft: messageDrafts,
          contact: contacts,
          followUp: followUps,
        })
        .from(messageDrafts)
        .innerJoin(contacts, eq(contacts.id, messageDrafts.contactId))
        .leftJoin(followUps, eq(followUps.id, messageDrafts.followUpId))
        .where(
          and(eq(messageDrafts.id, draftId), ws(messageDrafts.workspaceId)),
        );
      if (!row) return null;

      const [memoryRows, lastRows, otherFollowUps] = await Promise.all([
        db
          .select()
          .from(memories)
          .where(
            and(
              eq(memories.contactId, row.contact.id),
              eq(memories.workspaceId, workspaceId),
            ),
          ),
        db
          .select({ interaction: interactions })
          .from(interactions)
          .innerJoin(
            interactionContacts,
            eq(interactionContacts.interactionId, interactions.id),
          )
          .where(
            and(
              eq(interactionContacts.contactId, row.contact.id),
              eq(interactions.workspaceId, workspaceId),
            ),
          )
          .orderBy(desc(interactions.occurredAt))
          .limit(1),
        db
          .select({ description: followUps.description })
          .from(followUps)
          .where(
            and(
              eq(followUps.contactId, row.contact.id),
              eq(followUps.workspaceId, workspaceId),
              eq(followUps.status, "open"),
              row.followUp
                ? ne(followUps.id, row.followUp.id)
                : undefined,
            ),
          ),
      ]);

      const last = lastRows[0]?.interaction ?? null;
      const c = row.contact;

      // An intro check-in is about two people, but the follow-up hangs off
      // one. Pull the counterpart so the draft can name them.
      let intro: DraftContext["intro"] = null;
      if (row.followUp?.introId) {
        const [introRow] = await db
          .select()
          .from(intros)
          .where(
            and(
              eq(intros.id, row.followUp.introId),
              eq(intros.workspaceId, workspaceId),
            ),
          );
        if (introRow) {
          const otherId =
            introRow.personAContactId === c.id
              ? introRow.personBContactId
              : introRow.personAContactId;
          const [other] = await db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.id, otherId),
                eq(contacts.workspaceId, workspaceId),
              ),
            );
          if (other) {
            intro = {
              otherPersonName: `${other.preferredName ?? other.firstName} ${other.lastName ?? ""}`.trim(),
              reason: introRow.reason,
              sentAt: introRow.sentAt?.toISOString().slice(0, 10) ?? null,
              outcome: introRow.outcome,
            };
          }
        }
      }

      return {
        channel: row.draft.channel,
        channelLabel: row.draft.channelLabel,
        instruction: row.draft.instruction,
        contact: {
          id: c.id,
          name: `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim(),
          role: c.currentRole,
          company: c.currentCompany,
          location: c.location,
          howWeMet: c.howWeMet,
          relationshipCategory: c.relationshipCategory,
        },
        followUp: row.followUp
          ? {
              description: row.followUp.description,
              reason: row.followUp.reason,
              dueDate: row.followUp.dueDate,
            }
          : null,
        intro,
        otherOpenFollowUps: otherFollowUps.map((f) => f.description),
        memories: selectMemories(memoryRows),
        lastInteraction: last
          ? {
              date: last.occurredAt.toISOString().slice(0, 10),
              type: last.type,
              summary: last.aiSummary,
            }
          : null,
        daysSinceLastContact: last
          ? Math.floor(
              (Date.now() - last.occurredAt.getTime()) / (24 * 60 * 60 * 1000),
            )
          : null,
        voice: voiceFor(owner),
        timezone: owner.timezone,
      };
    },

    /** The model writing back. Sets both body and the untouched ai_body. */
    async saveDraftBody(
      draftId: string,
      data: {
        body: string;
        subject?: string | null;
        model?: string | null;
        contextJson?: unknown;
      },
    ) {
      const [row] = await db
        .update(messageDrafts)
        .set({
          body: data.body,
          aiBody: data.body,
          subject: data.subject ?? null,
          model: data.model ?? "mcp-client",
          promptVersion: DRAFT_PROMPT_VERSION,
          contextJson: (data.contextJson ?? null) as never,
          status: "drafted",
          draftedAt: new Date(),
        })
        .where(
          and(
            eq(messageDrafts.id, draftId),
            ws(messageDrafts.workspaceId),
            // Only a draft still waiting can be filled — a late tool call
            // must not clobber text the user has already edited or sent.
            eq(messageDrafts.status, "requested"),
          ),
        )
        .returning();
      return row ?? null;
    },

    /** User edits. Never touches ai_body, never advances status. */
    async updateDraftText(
      draftId: string,
      data: { body?: string; subject?: string | null },
    ) {
      const [row] = await db
        .update(messageDrafts)
        .set({
          ...(data.body !== undefined ? { body: data.body } : {}),
          ...(data.subject !== undefined ? { subject: data.subject } : {}),
        })
        .where(
          and(
            eq(messageDrafts.id, draftId),
            ws(messageDrafts.workspaceId),
            eq(messageDrafts.status, "drafted"),
          ),
        )
        .returning();
      return row ?? null;
    },

    async revertDraft(draftId: string) {
      const [current] = await db
        .select()
        .from(messageDrafts)
        .where(
          and(eq(messageDrafts.id, draftId), ws(messageDrafts.workspaceId)),
        );
      if (!current?.aiBody) return null;
      const [row] = await db
        .update(messageDrafts)
        .set({ body: current.aiBody })
        .where(
          and(
            eq(messageDrafts.id, draftId),
            ws(messageDrafts.workspaceId),
            // A sent draft's body is the record of what went out — immutable.
            eq(messageDrafts.status, "drafted"),
          ),
        )
        .returning();
      return row ?? null;
    },

    /** Send it back for another pass, optionally with a steer. */
    async regenerateDraft(draftId: string, instruction?: string | null) {
      const [row] = await db
        .update(messageDrafts)
        .set({
          status: "requested",
          instruction: instruction?.trim() || null,
          requestedAt: new Date(),
          draftedAt: null,
        })
        .where(
          and(
            eq(messageDrafts.id, draftId),
            ws(messageDrafts.workspaceId),
            // Only a live draft can go back for another pass. sent/sent_other
            // are records of what happened; discarded is a decision made.
            inArray(messageDrafts.status, ACTIVE),
          ),
        )
        .returning();
      return row ?? null;
    },

    async discardDraft(draftId: string) {
      const [row] = await db
        .update(messageDrafts)
        .set({ status: "discarded" })
        .where(
          and(
            eq(messageDrafts.id, draftId),
            ws(messageDrafts.workspaceId),
            // A sent draft can't be discarded — that would erase the record
            // of an outreach that actually happened.
            inArray(messageDrafts.status, ACTIVE),
          ),
        )
        .returning();
      return row ?? null;
    },

    /**
     * The honest close. `outcome` decides whether anything reaches Layer 1:
     * only "as_written", or "different" with text the user actually pasted,
     * ever produces an interaction. "other_channel" writes nothing.
     *
     * The follow-up is completed in every case — that part always happens.
     */
    async markDraftSent(
      draftId: string,
      outcome: SentOutcome,
      opts: { completeFollowUp?: boolean } = {},
    ) {
      const [draft] = await db
        .select()
        .from(messageDrafts)
        .where(
          and(eq(messageDrafts.id, draftId), ws(messageDrafts.workspaceId)),
        );
      if (!draft) return null;
      if (draft.status === "sent" || draft.status === "sent_other") {
        return { draft, interaction: null, alreadyClosed: true as const };
      }
      // discarded = already resolved; closing it again is a caller bug.
      if (draft.status === "discarded") {
        throw new Error("This draft was discarded — complete the follow-up directly");
      }
      // requested = no body was ever written, so "as written" has nothing to
      // describe. The other two outcomes are still honest: you may well have
      // reached out yourself before the AI got around to drafting.
      if (draft.status === "requested" && outcome.kind === "as_written") {
        throw new Error("Only a written draft can be marked sent as written");
      }

      // Decide the Layer 1 write first, explicitly, so there is exactly one
      // place in the codebase where a draft can become source material.
      let rawSource: string | null = null;
      if (outcome.kind === "as_written") {
        rawSource = draft.body?.trim() || null;
      } else if (outcome.kind === "different") {
        rawSource = outcome.text?.trim() || null;
      }

      const spec = CHANNEL_SPECS[draft.channel];
      let interaction: typeof interactions.$inferSelect | null = null;
      if (rawSource) {
        const result = await base.createInteraction({
          type: spec.interactionType,
          occurredAt: new Date(),
          rawSource,
          sourceType: "manual_note",
          // Outbound messages are already-known text, not something to mine
          // for new facts — skip the extraction queue.
          extractionStatus: "skipped",
          contactIds: [draft.contactId],
        });
        interaction = result.interaction;
      }

      const [row] = await db
        .update(messageDrafts)
        .set({
          status: outcome.kind === "as_written" ? "sent" : "sent_other",
          sentAt: new Date(),
        })
        .where(
          and(eq(messageDrafts.id, draftId), ws(messageDrafts.workspaceId)),
        )
        .returning();

      if (draft.followUpId && opts.completeFollowUp !== false) {
        await base.completeFollowUp(draft.followUpId);
      }

      return { draft: row, interaction, alreadyClosed: false as const };
    },
  };
}
