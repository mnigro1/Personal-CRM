import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  max,
  or,
  sql,
  SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  contacts,
  followUps,
  interactionContacts,
  interactions,
  invites,
  memories,
} from "@/db/schema";
import { normalizeDate, normalizeTagName, sourceHash } from "@/lib/normalize";
import { revisions } from "@/db/schema";
import { extractionOpsFor } from "@/db/repo-extraction";
import { draftOpsFor } from "@/db/repo-drafts";
import { mergeOpsFor } from "@/db/repo-merge";

const camelToSnake = (s: string) =>
  s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export type ContactFilters = {
  q?: string;
  location?: string;
  company?: string;
  relationshipCategory?: string;
  lastInteractionBefore?: Date;
  lastInteractionAfter?: Date;
  dateFirstMetFrom?: string;
  dateFirstMetTo?: string;
  hasOpenFollowUps?: boolean;
};

export type NewContact = Omit<
  typeof contacts.$inferInsert,
  "id" | "workspaceId" | "createdAt" | "updatedAt" | "deletedAt"
>;

export type NewInteraction = {
  type: (typeof interactions.$inferInsert)["type"];
  occurredAt: Date;
  location?: string | null;
  rawSource: string;
  sourceType: (typeof interactions.$inferInsert)["sourceType"];
  extractionStatus?: (typeof interactions.$inferInsert)["extractionStatus"];
  contactIds: string[];
};

/**
 * All data access goes through this factory. Every query it produces filters
 * on the given workspace_id — routes, actions, and the MCP server never touch
 * Drizzle directly, so no code path can forget the scope.
 */
export function repoFor(workspaceId: string) {
  const wsContacts = () =>
    and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt));

  async function recomputeLastInteraction(contactIds: string[]) {
    if (contactIds.length === 0) return;
    for (const contactId of contactIds) {
      const [row] = await db
        .select({ last: max(interactions.occurredAt) })
        .from(interactions)
        .innerJoin(
          interactionContacts,
          eq(interactionContacts.interactionId, interactions.id),
        )
        .where(
          and(
            eq(interactionContacts.contactId, contactId),
            eq(interactions.workspaceId, workspaceId),
          ),
        );
      await db
        .update(contacts)
        .set({ lastInteractionDate: row?.last ?? null })
        .where(and(eq(contacts.id, contactId), wsContacts()));
    }
  }

  /**
   * User-sourced change log. Field names are stored snake_case so they match
   * revisions written by extraction apply — undo's "edited since" check
   * compares (entity_type, entity_id, field) across both sources.
   */
  async function logUserRevision(row: {
    entityType: string;
    entityId: string;
    field?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    actorUserId?: string | null;
  }) {
    await db.insert(revisions).values({
      workspaceId,
      entityType: row.entityType,
      entityId: row.entityId,
      field: row.field ? camelToSnake(row.field) : null,
      oldValue: JSON.parse(JSON.stringify(row.oldValue ?? null)),
      newValue: JSON.parse(JSON.stringify(row.newValue ?? null)),
      changeSource: "user",
      actorUserId: row.actorUserId ?? null,
    });
  }

  const base = {
    workspaceId,

    // ---------------------------------------------------------------- contacts

    async listContacts(filters: ContactFilters = {}) {
      const conds: (SQL | undefined)[] = [wsContacts()];

      if (filters.q) {
        const pat = `%${filters.q}%`;
        conds.push(
          or(
            ilike(contacts.firstName, pat),
            ilike(contacts.lastName, pat),
            ilike(contacts.preferredName, pat),
            ilike(contacts.notes, pat),
            ilike(contacts.currentCompany, pat),
            ilike(contacts.currentRole, pat),
            ilike(contacts.location, pat),
            ilike(contacts.howWeMet, pat),
            exists(
              db
                .select({ one: sql`1` })
                .from(memories)
                .where(
                  and(
                    eq(memories.contactId, contacts.id),
                    eq(memories.workspaceId, workspaceId),
                    ilike(memories.text, pat),
                  ),
                ),
            ),
          ),
        );
      }
      if (filters.location)
        conds.push(ilike(contacts.location, `%${filters.location}%`));
      if (filters.company)
        conds.push(ilike(contacts.currentCompany, `%${filters.company}%`));
      if (filters.relationshipCategory)
        conds.push(
          eq(contacts.relationshipCategory, filters.relationshipCategory),
        );
      if (filters.lastInteractionBefore)
        conds.push(
          lte(contacts.lastInteractionDate, filters.lastInteractionBefore),
        );
      if (filters.lastInteractionAfter)
        conds.push(
          gte(contacts.lastInteractionDate, filters.lastInteractionAfter),
        );
      if (filters.dateFirstMetFrom)
        conds.push(gte(contacts.dateFirstMet, filters.dateFirstMetFrom));
      if (filters.dateFirstMetTo)
        conds.push(lte(contacts.dateFirstMet, filters.dateFirstMetTo));
      if (filters.hasOpenFollowUps)
        conds.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(followUps)
              .where(
                and(
                  eq(followUps.contactId, contacts.id),
                  eq(followUps.workspaceId, workspaceId),
                  eq(followUps.status, "open"),
                ),
              ),
          ),
        );

      const rows = await db
        .select()
        .from(contacts)
        .where(and(...conds))
        .orderBy(asc(contacts.firstName), asc(contacts.lastName));

      return rows;
    },

    /** Most recently added contacts — the Home view's "recently added" list. */
    async listRecentContacts(limit = 5) {
      return db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          preferredName: contacts.preferredName,
          currentCompany: contacts.currentCompany,
          currentRole: contacts.currentRole,
          createdAt: contacts.createdAt,
        })
        .from(contacts)
        .where(wsContacts())
        .orderBy(desc(contacts.createdAt))
        .limit(limit);
    },

    async getContact(contactId: string) {
      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), wsContacts()));
      if (!contact) return null;

      const [memoryRows, followUpRows, interactionRows] =
        await Promise.all([
          db
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.contactId, contactId),
                eq(memories.workspaceId, workspaceId),
              ),
            )
            .orderBy(desc(memories.createdAt)),
          db
            .select()
            .from(followUps)
            .where(
              and(
                eq(followUps.contactId, contactId),
                eq(followUps.workspaceId, workspaceId),
              ),
            )
            .orderBy(asc(followUps.dueDate)),
          db
            .select({ interaction: interactions })
            .from(interactions)
            .innerJoin(
              interactionContacts,
              eq(interactionContacts.interactionId, interactions.id),
            )
            .where(
              and(
                eq(interactionContacts.contactId, contactId),
                eq(interactions.workspaceId, workspaceId),
              ),
            )
            .orderBy(desc(interactions.occurredAt)),
        ]);

      return {
        ...contact,
        memories: memoryRows,
        followUps: followUpRows,
        interactions: interactionRows.map((r) => r.interaction),
      };
    },

    /**
     * Likely-same-person matches for a name, via trigram similarity plus a
     * first-name-exact fallback (short names score poorly on trigrams).
     */
    async findSimilarContacts(
      firstName: string,
      lastName?: string | null,
      threshold = 0.4,
    ) {
      const full = `${firstName} ${lastName ?? ""}`.trim();
      const nameExpr = sql`trim(coalesce(${contacts.firstName},'') || ' ' || coalesce(${contacts.lastName},''))`;
      return db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          currentCompany: contacts.currentCompany,
          currentRole: contacts.currentRole,
          location: contacts.location,
          lastInteractionDate: contacts.lastInteractionDate,
          similarity: sql<number>`similarity(${nameExpr}, ${full})`,
        })
        .from(contacts)
        .where(
          and(
            wsContacts(),
            or(
              sql`similarity(${nameExpr}, ${full}) >= ${threshold}`,
              // Same first name is worth a look ONLY when a last name can't
              // rule it out — otherwise every Daniel collides with every
              // other Daniel and the user gets asked a question they, and
              // the AI, already know the answer to. Two different last names
              // are the strongest "different person" signal there is.
              and(
                sql`lower(${contacts.firstName}) = lower(${firstName})`,
                or(
                  // One side has no surname: genuinely can't tell them apart.
                  sql`${lastName ?? ""} = ''`,
                  sql`${contacts.lastName} is null or ${contacts.lastName} = ''`,
                  // Both have one, so they must actually look alike
                  // (catches "Soper" vs "Sopher", rejects "Soper" vs "Arnold").
                  sql`similarity(lower(${contacts.lastName}), lower(${lastName ?? ""})) >= ${threshold}`,
                ),
              ),
            ),
          ),
        )
        .orderBy(desc(sql`similarity(${nameExpr}, ${full})`))
        .limit(5);
    },

    /** Workspace-wide scan for contact pairs that look like the same person. */
    async findDuplicateContactPairs(threshold = 0.5) {
      const a = alias(contacts, "a");
      const b = alias(contacts, "b");
      const nameA = sql`trim(coalesce(${a.firstName},'') || ' ' || coalesce(${a.lastName},''))`;
      const nameB = sql`trim(coalesce(${b.firstName},'') || ' ' || coalesce(${b.lastName},''))`;
      return db
        .select({
          aId: a.id,
          aName: nameA.as("a_name"),
          aCompany: a.currentCompany,
          bId: b.id,
          bName: nameB.as("b_name"),
          bCompany: b.currentCompany,
          similarity: sql<number>`similarity(${nameA}, ${nameB})`,
        })
        .from(a)
        .innerJoin(
          b,
          and(
            eq(b.workspaceId, workspaceId),
            sql`${a.id} < ${b.id}`,
            isNull(b.deletedAt),
            or(
              sql`similarity(${nameA}, ${nameB}) >= ${threshold}`,
              sql`lower(${a.firstName}) = lower(${b.firstName}) AND coalesce(lower(${a.lastName}),'') = coalesce(lower(${b.lastName}),'')`,
            ),
          ),
        )
        .where(and(eq(a.workspaceId, workspaceId), isNull(a.deletedAt)))
        .orderBy(desc(sql`similarity(${nameA}, ${nameB})`))
        .limit(25);
    },

    async createContact(data: NewContact) {
      const [row] = await db
        .insert(contacts)
        .values({ ...data, workspaceId })
        .returning();
      return row;
    },

    async updateContact(
      contactId: string,
      data: Partial<NewContact>,
      actorUserId?: string,
    ) {
      const [old] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), wsContacts()));
      if (!old) return null;
      const [row] = await db
        .update(contacts)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(contacts.id, contactId), wsContacts()))
        .returning();
      for (const key of Object.keys(data) as (keyof NewContact)[]) {
        const before = old[key];
        const after = data[key];
        if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
          await logUserRevision({
            entityType: "contact",
            entityId: contactId,
            field: key,
            oldValue: before,
            newValue: after,
            actorUserId,
          });
        }
      }
      return row ?? null;
    },

    /**
     * Layer 3 cache write: the AI snapshot is regenerable and never a
     * substitute for Layer 1/2, so it needs no approval flow or revisions.
     */
    async updateContactSummary(contactId: string, summary: string) {
      const [row] = await db
        .update(contacts)
        .set({
          aiSummary: summary,
          aiSummaryStale: false,
          aiSummaryGeneratedAt: new Date(),
        })
        .where(and(eq(contacts.id, contactId), wsContacts()))
        .returning();
      return row ?? null;
    },

    /** Contacts whose snapshot is missing or invalidated by newer data. */
    async listStaleSummaries(limit = 20) {
      return db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          preferredName: contacts.preferredName,
          aiSummaryGeneratedAt: contacts.aiSummaryGeneratedAt,
        })
        .from(contacts)
        .where(
          and(
            wsContacts(),
            or(
              eq(contacts.aiSummaryStale, true),
              and(
                isNull(contacts.aiSummary),
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(memories)
                    .where(eq(memories.contactId, contacts.id)),
                ),
              ),
            ),
          ),
        )
        .limit(limit);
    },

    async softDeleteContact(contactId: string) {
      await db
        .update(contacts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(contacts.id, contactId), wsContacts()));
    },

    // ------------------------------------------------------------ interactions

    /**
     * Persist-first capture. Checks the source hash for a duplicate paste;
     * on collision returns the existing interaction instead of creating.
     */
    async createInteraction(data: NewInteraction) {
      const hash = sourceHash(data.rawSource);

      const [dupe] = await db
        .select()
        .from(interactions)
        .where(
          and(
            eq(interactions.workspaceId, workspaceId),
            eq(interactions.rawSourceHash, hash),
          ),
        );
      if (dupe) return { duplicate: true as const, interaction: dupe };

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(interactions)
          .values({
            workspaceId,
            type: data.type,
            occurredAt: data.occurredAt,
            location: data.location,
            rawSource: data.rawSource,
            rawSourceHash: hash,
            sourceType: data.sourceType,
            extractionStatus: data.extractionStatus ?? "skipped",
          })
          .returning();
        for (const contactId of new Set(data.contactIds)) {
          await tx
            .insert(interactionContacts)
            .values({ interactionId: row.id, contactId, workspaceId });
        }
        return row;
      });

      await recomputeLastInteraction(data.contactIds);
      return { duplicate: false as const, interaction: created };
    },

    async getInteraction(interactionId: string) {
      const [row] = await db
        .select()
        .from(interactions)
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.workspaceId, workspaceId),
          ),
        );
      if (!row) return null;
      const linked = await db
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(interactionContacts)
        .innerJoin(contacts, eq(contacts.id, interactionContacts.contactId))
        .where(eq(interactionContacts.interactionId, interactionId));
      return { ...row, contacts: linked };
    },

    /** Metadata is editable; raw_source never is. */
    async updateInteractionMeta(
      interactionId: string,
      data: {
        type?: NewInteraction["type"];
        occurredAt?: Date;
        location?: string | null;
        contactIds?: string[];
      },
      actorUserId?: string,
    ) {
      const existing = await this.getInteraction(interactionId);
      if (!existing) return null;

      const affected = new Set(existing.contacts.map((c) => c.id));
      const fieldChanges: { field: string; oldValue: unknown; newValue: unknown }[] = [];
      if (data.type && data.type !== existing.type)
        fieldChanges.push({ field: "type", oldValue: existing.type, newValue: data.type });
      if (
        data.occurredAt &&
        data.occurredAt.getTime() !== existing.occurredAt.getTime()
      )
        fieldChanges.push({
          field: "occurredAt",
          oldValue: existing.occurredAt.toISOString(),
          newValue: data.occurredAt.toISOString(),
        });
      if (data.location !== undefined && data.location !== existing.location)
        fieldChanges.push({ field: "location", oldValue: existing.location, newValue: data.location });

      await db.transaction(async (tx) => {
        await tx
          .update(interactions)
          .set({
            ...(data.type ? { type: data.type } : {}),
            ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}),
            ...(data.location !== undefined ? { location: data.location } : {}),
          })
          .where(
            and(
              eq(interactions.id, interactionId),
              eq(interactions.workspaceId, workspaceId),
            ),
          );
        if (data.contactIds) {
          await tx
            .delete(interactionContacts)
            .where(
              and(
                eq(interactionContacts.interactionId, interactionId),
                eq(interactionContacts.workspaceId, workspaceId),
              ),
            );
          for (const contactId of new Set(data.contactIds)) {
            await tx
              .insert(interactionContacts)
              .values({ interactionId, contactId, workspaceId });
            affected.add(contactId);
          }
        }
      });

      for (const change of fieldChanges) {
        await logUserRevision({
          entityType: "interaction",
          entityId: interactionId,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          actorUserId,
        });
      }
      if (data.contactIds) {
        const beforeIds = existing.contacts.map((c) => c.id).sort();
        const afterIds = [...new Set(data.contactIds)].sort();
        if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
          await logUserRevision({
            entityType: "interaction_contact",
            entityId: interactionId,
            field: "contact",
            oldValue: beforeIds,
            newValue: afterIds,
            actorUserId,
          });
        }
      }

      await recomputeLastInteraction([...affected]);
      return this.getInteraction(interactionId);
    },

    async deleteInteraction(interactionId: string) {
      const existing = await this.getInteraction(interactionId);
      if (!existing) return;
      const affected = existing.contacts.map((c) => c.id);
      await db
        .delete(interactions)
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.workspaceId, workspaceId),
          ),
        );
      await recomputeLastInteraction(affected);
    },

    async listInteractions(limit = 50) {
      return db
        .select()
        .from(interactions)
        .where(eq(interactions.workspaceId, workspaceId))
        .orderBy(desc(interactions.occurredAt))
        .limit(limit);
    },

    recomputeLastInteraction,

    // ---------------------------------------------------------------- memories

    async addMemory(data: {
      contactId: string;
      text: string;
      category: (typeof memories.$inferInsert)["category"];
      eventDate?: string | null;
      eventDatePrecision?: (typeof memories.$inferInsert)["eventDatePrecision"];
      learnedAt?: string | null;
      sourceInteractionId?: string | null;
      createdBy?: "user" | "ai";
    }) {
      const [row] = await db
        .insert(memories)
        .values({
          workspaceId,
          contactId: data.contactId,
          text: data.text,
          category: data.category,
          eventDate: data.eventDate ?? null,
          eventDatePrecision: data.eventDatePrecision ?? "none",
          learnedAt: data.learnedAt ?? new Date().toISOString().slice(0, 10),
          sourceInteractionId: data.sourceInteractionId ?? null,
          createdBy: data.createdBy ?? "user",
        })
        .returning();
      return row;
    },

    /**
     * Every revision that ever touched this contact: the contact row itself,
     * its tags, its memories and follow-ups (including deleted ones, matched
     * via the snapshot stored in the revision), newest first.
     */
    async getRevisionsForContact(contactId: string, limit = 200) {
      const memoryIdsQ = db
        .select({ id: memories.id })
        .from(memories)
        .where(eq(memories.contactId, contactId));
      const followUpIdsQ = db
        .select({ id: followUps.id })
        .from(followUps)
        .where(eq(followUps.contactId, contactId));

      return db
        .select()
        .from(revisions)
        .where(
          and(
            eq(revisions.workspaceId, workspaceId),
            or(
              eq(revisions.entityId, contactId),
              inArray(revisions.entityId, memoryIdsQ),
              inArray(revisions.entityId, followUpIdsQ),
              // Deleted memories/follow-ups: their rows are gone, but the
              // revision snapshots carry the contact id.
              sql`(${revisions.oldValue} ->> 'contactId' = ${contactId} OR ${revisions.newValue} ->> 'contactId' = ${contactId})`,
            ),
          ),
        )
        .orderBy(desc(revisions.createdAt))
        .limit(limit);
    },

    async getMemoriesByIds(memoryIds: string[]) {
      if (memoryIds.length === 0) return [];
      return db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.workspaceId, workspaceId),
            inArray(memories.id, memoryIds),
          ),
        );
    },

    async updateMemory(
      memoryId: string,
      data: Partial<{
        text: string;
        category: (typeof memories.$inferInsert)["category"];
        status: (typeof memories.$inferInsert)["status"];
        eventDate: string | null;
        eventDatePrecision: (typeof memories.$inferInsert)["eventDatePrecision"];
      }>,
      actorUserId?: string,
    ) {
      const [old] = await db
        .select()
        .from(memories)
        .where(
          and(eq(memories.id, memoryId), eq(memories.workspaceId, workspaceId)),
        );
      if (!old) return null;
      const [row] = await db
        .update(memories)
        .set(data)
        .where(
          and(eq(memories.id, memoryId), eq(memories.workspaceId, workspaceId)),
        )
        .returning();
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        if (old[key] !== data[key]) {
          await logUserRevision({
            entityType: "memory",
            entityId: memoryId,
            field: key,
            oldValue: old[key],
            newValue: data[key],
            actorUserId,
          });
        }
      }
      return row ?? null;
    },

    async deleteMemory(memoryId: string, actorUserId?: string) {
      const [old] = await db
        .select()
        .from(memories)
        .where(
          and(eq(memories.id, memoryId), eq(memories.workspaceId, workspaceId)),
        );
      if (!old) return;
      await db
        .delete(memories)
        .where(
          and(eq(memories.id, memoryId), eq(memories.workspaceId, workspaceId)),
        );
      await logUserRevision({
        entityType: "memory",
        entityId: memoryId,
        oldValue: old,
        newValue: null,
        actorUserId,
      });
    },

    // -------------------------------------------------------------- follow-ups

    async addFollowUp(data: {
      contactId: string;
      description: string;
      reason: string;
      dueDate?: string | null;
      priority?: (typeof followUps.$inferInsert)["priority"];
      createdBy?: "user" | "ai";
    }) {
      const [row] = await db
        .insert(followUps)
        .values({
          workspaceId,
          contactId: data.contactId,
          description: data.description,
          reason: data.reason,
          dueDate: data.dueDate ?? null,
          priority: data.priority ?? "medium",
          createdBy: data.createdBy ?? "user",
        })
        .returning();
      return row;
    },

    /**
     * Edit an existing follow-up in place.
     *
     * Without this a follow-up was write-once: the only exits were complete
     * or dismiss, so correcting a due date meant completing the row and
     * recreating it — which orphans any draft attached to the old id.
     *
     * Setting status back to "open" is the inverse of completeFollowUp, so a
     * follow-up closed by mistake can be recovered.
     */
    async updateFollowUp(
      followUpId: string,
      data: {
        description?: string;
        reason?: string;
        // undefined = leave alone; null = clear the date.
        dueDate?: string | null;
        priority?: (typeof followUps.$inferInsert)["priority"];
        status?: (typeof followUps.$inferInsert)["status"];
      },
      actorUserId?: string,
    ) {
      const [existing] = await db
        .select()
        .from(followUps)
        .where(
          and(
            eq(followUps.id, followUpId),
            eq(followUps.workspaceId, workspaceId),
          ),
        );
      if (!existing) return null;

      const patch: Partial<typeof followUps.$inferInsert> = {};
      const changes: { field: string; oldValue: unknown; newValue: unknown }[] =
        [];
      const track = (field: string, oldValue: unknown, newValue: unknown) => {
        if (oldValue === newValue) return;
        (patch as Record<string, unknown>)[field] = newValue;
        changes.push({ field, oldValue, newValue });
      };

      if (data.description !== undefined)
        track("description", existing.description, data.description);
      if (data.reason !== undefined)
        track("reason", existing.reason, data.reason);
      if (data.dueDate !== undefined) {
        // Same normalizer the extraction pipeline uses, so "2026" or
        // "2026-09" can't reach a date column and fail the write.
        track("dueDate", existing.dueDate, normalizeDate(data.dueDate));
      }
      if (data.priority !== undefined)
        track("priority", existing.priority, data.priority);
      if (data.status !== undefined && data.status !== existing.status) {
        track("status", existing.status, data.status);
        // completedAt has to follow status or the row contradicts itself.
        patch.completedAt = data.status === "completed" ? new Date() : null;
      }

      if (changes.length === 0) return existing;

      const [row] = await db
        .update(followUps)
        .set(patch)
        .where(
          and(
            eq(followUps.id, followUpId),
            eq(followUps.workspaceId, workspaceId),
          ),
        )
        .returning();

      for (const c of changes) {
        await logUserRevision({
          entityType: "follow_up",
          entityId: followUpId,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          actorUserId,
        });
      }
      return row ?? null;
    },

    async completeFollowUp(followUpId: string) {
      const [row] = await db
        .update(followUps)
        .set({ status: "completed", completedAt: new Date() })
        .where(
          and(
            eq(followUps.id, followUpId),
            eq(followUps.workspaceId, workspaceId),
          ),
        )
        .returning();
      return row ?? null;
    },

    async listOpenFollowUps() {
      return db
        .select({
          followUp: followUps,
          contact: {
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            preferredName: contacts.preferredName,
            // Drafting needs these to know which channels are usable.
            phone: contacts.phone,
            emails: contacts.emails,
          },
        })
        .from(followUps)
        .innerJoin(contacts, eq(contacts.id, followUps.contactId))
        .where(
          and(
            eq(followUps.workspaceId, workspaceId),
            eq(followUps.status, "open"),
            // Deleting a contact must not leave ghost follow-ups behind.
            isNull(contacts.deletedAt),
          ),
        )
        .orderBy(asc(followUps.dueDate));
    },

    // ----------------------------------------------------------------- invites

    async createInvite(email: string, invitedByUserId: string) {
      const token = crypto.randomUUID().replace(/-/g, "");
      const [row] = await db
        .insert(invites)
        .values({
          email,
          token,
          invitedByUserId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        .returning();
      return row;
    },

    async listInvites(invitedByUserId: string) {
      return db
        .select()
        .from(invites)
        .where(eq(invites.invitedByUserId, invitedByUserId))
        .orderBy(desc(invites.createdAt));
    },
  };

  return {
    ...base,
    ...extractionOpsFor(workspaceId, base),
    ...draftOpsFor(workspaceId, base),
    ...mergeOpsFor(workspaceId, base),
  };
}

export type Repo = ReturnType<typeof repoFor>;
