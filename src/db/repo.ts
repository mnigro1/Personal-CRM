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
import { db } from "@/db";
import {
  contacts,
  contactTags,
  followUps,
  interactionContacts,
  interactions,
  invites,
  memories,
  tags,
} from "@/db/schema";
import { normalizeTagName, sourceHash } from "@/lib/normalize";

export type ContactFilters = {
  q?: string;
  tagIds?: string[];
  tagMode?: "and" | "or";
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

  return {
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

      if (filters.tagIds && filters.tagIds.length > 0) {
        if ((filters.tagMode ?? "or") === "or") {
          conds.push(
            exists(
              db
                .select({ one: sql`1` })
                .from(contactTags)
                .where(
                  and(
                    eq(contactTags.contactId, contacts.id),
                    inArray(contactTags.tagId, filters.tagIds),
                  ),
                ),
            ),
          );
        } else {
          for (const tagId of filters.tagIds) {
            conds.push(
              exists(
                db
                  .select({ one: sql`1` })
                  .from(contactTags)
                  .where(
                    and(
                      eq(contactTags.contactId, contacts.id),
                      eq(contactTags.tagId, tagId),
                    ),
                  ),
              ),
            );
          }
        }
      }

      const rows = await db
        .select()
        .from(contacts)
        .where(and(...conds))
        .orderBy(asc(contacts.firstName), asc(contacts.lastName));

      const tagRows =
        rows.length === 0
          ? []
          : await db
              .select({
                contactId: contactTags.contactId,
                id: tags.id,
                name: tags.name,
              })
              .from(contactTags)
              .innerJoin(tags, eq(tags.id, contactTags.tagId))
              .where(
                and(
                  eq(contactTags.workspaceId, workspaceId),
                  inArray(
                    contactTags.contactId,
                    rows.map((r) => r.id),
                  ),
                ),
              );

      return rows.map((c) => ({
        ...c,
        tags: tagRows.filter((t) => t.contactId === c.id),
      }));
    },

    async getContact(contactId: string) {
      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), wsContacts()));
      if (!contact) return null;

      const [contactTagRows, memoryRows, followUpRows, interactionRows] =
        await Promise.all([
          db
            .select({ id: tags.id, name: tags.name })
            .from(contactTags)
            .innerJoin(tags, eq(tags.id, contactTags.tagId))
            .where(
              and(
                eq(contactTags.contactId, contactId),
                eq(contactTags.workspaceId, workspaceId),
              ),
            ),
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
        tags: contactTagRows,
        memories: memoryRows,
        followUps: followUpRows,
        interactions: interactionRows.map((r) => r.interaction),
      };
    },

    async createContact(data: NewContact) {
      const [row] = await db
        .insert(contacts)
        .values({ ...data, workspaceId })
        .returning();
      return row;
    },

    async updateContact(contactId: string, data: Partial<NewContact>) {
      const [row] = await db
        .update(contacts)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(contacts.id, contactId), wsContacts()))
        .returning();
      return row ?? null;
    },

    async softDeleteContact(contactId: string) {
      await db
        .update(contacts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(contacts.id, contactId), wsContacts()));
    },

    // -------------------------------------------------------------------- tags

    async listTags() {
      return db
        .select()
        .from(tags)
        .where(and(eq(tags.workspaceId, workspaceId), isNull(tags.deletedAt)))
        .orderBy(asc(tags.normalizedName));
    },

    /**
     * Resolves a tag by name, following merge tombstones so a merged-away
     * name lands on its target instead of resurrecting. Creates if missing.
     */
    async findOrCreateTag(name: string, createdBy: "user" | "ai" = "user") {
      const normalized = normalizeTagName(name);
      if (!normalized) throw new Error("Tag name is empty after normalization");

      const [existing] = await db
        .select()
        .from(tags)
        .where(
          and(
            eq(tags.workspaceId, workspaceId),
            eq(tags.normalizedName, normalized),
          ),
        );
      if (existing) {
        if (existing.mergedIntoTagId) {
          const [target] = await db
            .select()
            .from(tags)
            .where(
              and(
                eq(tags.id, existing.mergedIntoTagId),
                eq(tags.workspaceId, workspaceId),
              ),
            );
          if (target) return target;
        }
        return existing;
      }

      const [created] = await db
        .insert(tags)
        .values({ workspaceId, name: name.trim(), normalizedName: normalized, createdBy })
        .returning();
      return created;
    },

    /**
     * Merge tag A into B per spec: repoint contact_tags to B, set A's
     * merged_into_tag_id, soft-delete A. Runs in a transaction.
     */
    async mergeTags(sourceTagId: string, targetTagId: string) {
      if (sourceTagId === targetTagId)
        throw new Error("Cannot merge a tag into itself");

      await db.transaction(async (tx) => {
        const found = await tx
          .select()
          .from(tags)
          .where(
            and(
              eq(tags.workspaceId, workspaceId),
              inArray(tags.id, [sourceTagId, targetTagId]),
              isNull(tags.deletedAt),
            ),
          );
        if (found.length !== 2)
          throw new Error("Both tags must exist in this workspace");

        const sourceLinks = await tx
          .select({ contactId: contactTags.contactId })
          .from(contactTags)
          .where(
            and(
              eq(contactTags.tagId, sourceTagId),
              eq(contactTags.workspaceId, workspaceId),
            ),
          );

        for (const { contactId } of sourceLinks) {
          await tx
            .insert(contactTags)
            .values({ contactId, tagId: targetTagId, workspaceId })
            .onConflictDoNothing();
        }
        await tx
          .delete(contactTags)
          .where(
            and(
              eq(contactTags.tagId, sourceTagId),
              eq(contactTags.workspaceId, workspaceId),
            ),
          );
        await tx
          .update(tags)
          .set({ mergedIntoTagId: targetTagId, deletedAt: new Date() })
          .where(and(eq(tags.id, sourceTagId), eq(tags.workspaceId, workspaceId)));
      });
    },

    async setContactTags(contactId: string, tagNames: string[]) {
      const resolved = [];
      for (const name of tagNames) {
        if (normalizeTagName(name)) resolved.push(await this.findOrCreateTag(name));
      }
      const tagIds = [...new Set(resolved.map((t) => t.id))];

      await db.transaction(async (tx) => {
        await tx
          .delete(contactTags)
          .where(
            and(
              eq(contactTags.contactId, contactId),
              eq(contactTags.workspaceId, workspaceId),
            ),
          );
        for (const tagId of tagIds) {
          await tx
            .insert(contactTags)
            .values({ contactId, tagId, workspaceId })
            .onConflictDoNothing();
        }
      });
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
    ) {
      const existing = await this.getInteraction(interactionId);
      if (!existing) return null;

      const affected = new Set(existing.contacts.map((c) => c.id));

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

    async updateMemory(
      memoryId: string,
      data: Partial<{
        text: string;
        category: (typeof memories.$inferInsert)["category"];
        status: (typeof memories.$inferInsert)["status"];
        eventDate: string | null;
        eventDatePrecision: (typeof memories.$inferInsert)["eventDatePrecision"];
      }>,
    ) {
      const [row] = await db
        .update(memories)
        .set(data)
        .where(
          and(eq(memories.id, memoryId), eq(memories.workspaceId, workspaceId)),
        )
        .returning();
      return row ?? null;
    },

    async deleteMemory(memoryId: string) {
      await db
        .delete(memories)
        .where(
          and(eq(memories.id, memoryId), eq(memories.workspaceId, workspaceId)),
        );
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
          },
        })
        .from(followUps)
        .innerJoin(contacts, eq(contacts.id, followUps.contactId))
        .where(
          and(
            eq(followUps.workspaceId, workspaceId),
            eq(followUps.status, "open"),
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
}

export type Repo = ReturnType<typeof repoFor>;
