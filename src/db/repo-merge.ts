import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contactTags,
  contacts,
  followUps,
  interactionContacts,
  memories,
  messageDrafts,
  revisions,
} from "@/db/schema";

/** Base-repo methods the merge ops depend on. */
type BaseRepo = {
  recomputeLastInteraction(contactIds: string[]): Promise<void>;
};

/**
 * Scalar fields where a blank on the survivor can be filled from the loser.
 * The survivor always wins a real conflict — merging must never silently
 * overwrite a value the user can still see on the surviving record.
 */
const FILLABLE = [
  "lastName",
  "preferredName",
  "phone",
  "currentCompany",
  "currentRole",
  "location",
  "linkedinUrl",
  "website",
  "howWeMet",
  "dateFirstMet",
  "relationshipCategory",
] as const;

export type MergeSummary = {
  survivorId: string;
  loserId: string;
  batchId: string;
  moved: {
    memories: number;
    interactions: number;
    followUps: number;
    drafts: number;
    tags: number;
  };
  /** Interaction links dropped because both records were on the same one. */
  deduped: { interactions: number; tags: number };
  fieldsFilled: string[];
  emailsAdded: string[];
  notesAppended: boolean;
};

export function mergeOpsFor(workspaceId: string, base: BaseRepo) {
  const inWs = (id: string) =>
    and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId));

  async function load(id: string) {
    const [row] = await db.select().from(contacts).where(inWs(id));
    return row ?? null;
  }

  return {
    /** What a merge would move, so the user can see it before committing. */
    async previewMerge(survivorId: string, loserId: string) {
      const [survivor, loser] = await Promise.all([
        load(survivorId),
        load(loserId),
      ]);
      if (!survivor || !loser) return null;

      const count = async (table: typeof memories | typeof followUps | typeof messageDrafts, id: string) => {
        const [r] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(table)
          .where(and(eq(table.contactId, id), eq(table.workspaceId, workspaceId)));
        return r?.n ?? 0;
      };
      const interactionCount = async (id: string) => {
        const [r] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(interactionContacts)
          .where(
            and(
              eq(interactionContacts.contactId, id),
              eq(interactionContacts.workspaceId, workspaceId),
            ),
          );
        return r?.n ?? 0;
      };

      const [sm, lm, sf, lf, sd, ld, si, li] = await Promise.all([
        count(memories, survivorId),
        count(memories, loserId),
        count(followUps, survivorId),
        count(followUps, loserId),
        count(messageDrafts, survivorId),
        count(messageDrafts, loserId),
        interactionCount(survivorId),
        interactionCount(loserId),
      ]);

      return {
        survivor: { ...survivor, memories: sm, followUps: sf, drafts: sd, interactions: si },
        loser: { ...loser, memories: lm, followUps: lf, drafts: ld, interactions: li },
      };
    },

    /**
     * Consolidate two records for the same person into one.
     *
     * Everything the loser owns — memories, interaction links, follow-ups,
     * drafts — is repointed at the survivor, blanks on the survivor are
     * filled from the loser, and the loser is soft-deleted with a tombstone
     * pointing home. Nothing is destroyed: the losing row stays in the table
     * and every moved id is recorded in a revisions batch.
     *
     * The whole thing is one transaction — a half-merged contact is worse
     * than two duplicates.
     */
    async mergeContacts(opts: {
      survivorId: string;
      loserId: string;
      actorUserId?: string | null;
    }): Promise<MergeSummary> {
      const { survivorId, loserId, actorUserId } = opts;

      if (survivorId === loserId) {
        throw new Error("Cannot merge a contact into itself");
      }
      const [survivor, loser] = await Promise.all([
        load(survivorId),
        load(loserId),
      ]);
      // Both lookups are workspace-scoped, so a cross-workspace id reads as
      // "not found" here rather than leaking that it exists elsewhere.
      if (!survivor) throw new Error("Surviving contact not found");
      if (!loser) throw new Error("Contact to merge not found");
      if (survivor.deletedAt) throw new Error("The surviving contact is deleted");
      if (loser.deletedAt) throw new Error("That contact was already merged or deleted");

      const batchId = crypto.randomUUID();

      const summary = await db.transaction(async (tx) => {
        // --- 1. Fill blanks on the survivor, never overwrite -------------
        const patch: Record<string, unknown> = {};
        const fieldsFilled: string[] = [];
        for (const f of FILLABLE) {
          if (!survivor[f] && loser[f]) {
            patch[f] = loser[f];
            fieldsFilled.push(f);
          }
        }

        // Emails are a set, not a scalar — union them.
        const have = new Set(survivor.emails.map((e) => e.toLowerCase()));
        const emailsAdded = loser.emails.filter(
          (e) => !have.has(e.toLowerCase()),
        );
        if (emailsAdded.length > 0) {
          patch.emails = [...survivor.emails, ...emailsAdded];
        }

        // Free-text notes can't be merged by rule — keep both, labelled,
        // rather than picking a winner and losing what the user wrote.
        let notesAppended = false;
        if (loser.notes?.trim()) {
          patch.notes = survivor.notes?.trim()
            ? `${survivor.notes.trim()}\n\n--- merged from duplicate record ---\n${loser.notes.trim()}`
            : loser.notes;
          notesAppended = true;
        }

        // The survivor's snapshot describes a subset of what it now owns.
        patch.aiSummaryStale = true;
        patch.updatedAt = new Date();
        await tx.update(contacts).set(patch).where(eq(contacts.id, survivorId));

        // --- 2. Repoint the composite-PK join tables ---------------------
        // Both records may sit on the SAME interaction (a common way the
        // duplicate got created). Repointing blindly would violate
        // (interaction_id, contact_id), so drop the loser's link where the
        // survivor is already attached, then move what's left.
        const sharedInteractions = await tx
          .select({ id: interactionContacts.interactionId })
          .from(interactionContacts)
          .where(
            and(
              eq(interactionContacts.contactId, loserId),
              eq(interactionContacts.workspaceId, workspaceId),
              sql`exists (select 1 from ${interactionContacts} ic2
                    where ic2.interaction_id = ${interactionContacts.interactionId}
                      and ic2.contact_id = ${survivorId})`,
            ),
          );
        if (sharedInteractions.length > 0) {
          await tx.delete(interactionContacts).where(
            and(
              eq(interactionContacts.contactId, loserId),
              eq(interactionContacts.workspaceId, workspaceId),
              inArray(
                interactionContacts.interactionId,
                sharedInteractions.map((r) => r.id),
              ),
            ),
          );
        }
        const movedInteractions = await tx
          .update(interactionContacts)
          .set({ contactId: survivorId })
          .where(
            and(
              eq(interactionContacts.contactId, loserId),
              eq(interactionContacts.workspaceId, workspaceId),
            ),
          )
          .returning({ id: interactionContacts.interactionId });

        // contact_tags is the same shape. The tags feature was removed, but
        // the table and its FK still exist — rows here would block the merge.
        const sharedTags = await tx
          .select({ id: contactTags.tagId })
          .from(contactTags)
          .where(
            and(
              eq(contactTags.contactId, loserId),
              eq(contactTags.workspaceId, workspaceId),
              sql`exists (select 1 from ${contactTags} ct2
                    where ct2.tag_id = ${contactTags.tagId}
                      and ct2.contact_id = ${survivorId})`,
            ),
          );
        if (sharedTags.length > 0) {
          await tx.delete(contactTags).where(
            and(
              eq(contactTags.contactId, loserId),
              eq(contactTags.workspaceId, workspaceId),
              inArray(contactTags.tagId, sharedTags.map((r) => r.id)),
            ),
          );
        }
        const movedTags = await tx
          .update(contactTags)
          .set({ contactId: survivorId })
          .where(
            and(
              eq(contactTags.contactId, loserId),
              eq(contactTags.workspaceId, workspaceId),
            ),
          )
          .returning({ id: contactTags.tagId });

        // --- 3. Repoint the plain FK tables ------------------------------
        const movedMemories = await tx
          .update(memories)
          .set({ contactId: survivorId })
          .where(
            and(
              eq(memories.contactId, loserId),
              eq(memories.workspaceId, workspaceId),
            ),
          )
          .returning({ id: memories.id });

        const movedFollowUps = await tx
          .update(followUps)
          .set({ contactId: survivorId })
          .where(
            and(
              eq(followUps.contactId, loserId),
              eq(followUps.workspaceId, workspaceId),
            ),
          )
          .returning({ id: followUps.id });

        const movedDrafts = await tx
          .update(messageDrafts)
          .set({ contactId: survivorId })
          .where(
            and(
              eq(messageDrafts.contactId, loserId),
              eq(messageDrafts.workspaceId, workspaceId),
            ),
          )
          .returning({ id: messageDrafts.id });

        // --- 4. Tombstone the loser --------------------------------------
        await tx
          .update(contacts)
          .set({
            deletedAt: new Date(),
            mergedIntoContactId: survivorId,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, loserId));

        // --- 5. Audit: enough detail to reconstruct this by hand ---------
        await tx.insert(revisions).values([
          {
            workspaceId,
            entityType: "contact",
            entityId: loserId,
            field: "merged_into_contact_id",
            oldValue: { contact: loser },
            newValue: {
              mergedInto: survivorId,
              movedMemoryIds: movedMemories.map((r) => r.id),
              movedInteractionIds: movedInteractions.map((r) => r.id),
              movedFollowUpIds: movedFollowUps.map((r) => r.id),
              movedDraftIds: movedDrafts.map((r) => r.id),
              droppedSharedInteractionIds: sharedInteractions.map((r) => r.id),
            },
            changeSource: "user" as const,
            batchId,
            actorUserId: actorUserId ?? null,
          },
          {
            workspaceId,
            entityType: "contact",
            entityId: survivorId,
            field: "merge_absorbed",
            oldValue: {
              emails: survivor.emails,
              notes: survivor.notes,
              ...Object.fromEntries(FILLABLE.map((f) => [f, survivor[f]])),
            },
            newValue: { absorbed: loserId, fieldsFilled, emailsAdded },
            changeSource: "user" as const,
            batchId,
            actorUserId: actorUserId ?? null,
          },
        ]);

        return {
          survivorId,
          loserId,
          batchId,
          moved: {
            memories: movedMemories.length,
            interactions: movedInteractions.length,
            followUps: movedFollowUps.length,
            drafts: movedDrafts.length,
            tags: movedTags.length,
          },
          deduped: {
            interactions: sharedInteractions.length,
            tags: sharedTags.length,
          },
          fieldsFilled,
          emailsAdded,
          notesAppended,
        } satisfies MergeSummary;
      });

      // Outside the transaction: the survivor's cached last-interaction date
      // is now wrong in the "loser had the more recent one" case.
      await base.recomputeLastInteraction([survivorId]);

      return summary;
    },

    /** Where a merged-away contact went, so old links can redirect. */
    async resolveMergedContact(contactId: string) {
      const row = await load(contactId);
      if (!row?.mergedIntoContactId) return null;
      // Follow the chain: A merged into B, B later merged into C.
      const seen = new Set([contactId]);
      let target = row.mergedIntoContactId;
      while (!seen.has(target)) {
        seen.add(target);
        const next = await load(target);
        if (!next?.mergedIntoContactId) break;
        target = next.mergedIntoContactId;
      }
      return target;
    },
  };
}
