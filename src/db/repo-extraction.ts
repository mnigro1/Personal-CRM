import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  contacts,
  extractions,
  followUps,
  interactionContacts,
  interactions,
  memories,
  revisions,
  users,
  workspaces,
} from "@/db/schema";
import {
  PROMPT_VERSION,
  proposalSchema,
  selectionsSchema,
  type Proposal,
  type ProposalFlags,
  type Selections,
  type StagedProposal,
} from "@/lib/proposal";

const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

/** Base-repo methods the extraction ops depend on. */
type BaseRepo = {
  recomputeLastInteraction(contactIds: string[]): Promise<void>;
  findSimilarContacts(
    firstName: string,
    lastName?: string | null,
    threshold?: number,
  ): Promise<
    {
      id: string;
      firstName: string;
      lastName: string | null;
      currentCompany: string | null;
      similarity: number;
    }[]
  >;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

const CONTACT_FIELD_MAP = {
  current_company: "currentCompany",
  current_role: "currentRole",
  location: "location",
  phone: "phone",
  linkedin_url: "linkedinUrl",
  website: "website",
} as const;

const HISTORICAL_MEMORY_CATEGORY: Record<
  keyof typeof CONTACT_FIELD_MAP,
  (typeof memories.$inferInsert)["category"]
> = {
  current_company: "career",
  current_role: "career",
  location: "geography",
  phone: "other",
  linkedin_url: "other",
  website: "other",
};

export function extractionOpsFor(workspaceId: string, base: BaseRepo) {
  async function writeRevision(
    tx: Tx,
    row: {
      entityType: string;
      entityId: string;
      field?: string | null;
      oldValue?: unknown;
      newValue?: unknown;
      changeSource: "user" | "ai_applied" | "ai_auto" | "undo";
      batchId?: string | null;
      actorUserId?: string | null;
    },
  ) {
    await tx.insert(revisions).values({
      workspaceId,
      entityType: row.entityType,
      entityId: row.entityId,
      field: row.field ?? null,
      oldValue: jsonSafe(row.oldValue),
      newValue: jsonSafe(row.newValue),
      changeSource: row.changeSource,
      batchId: row.batchId ?? null,
      actorUserId: row.actorUserId ?? null,
    });
  }

  async function markSummariesStale(tx: Tx, contactIds: string[]) {
    if (contactIds.length === 0) return;
    await tx
      .update(contacts)
      .set({ aiSummaryStale: true })
      .where(
        and(
          inArray(contacts.id, contactIds),
          eq(contacts.workspaceId, workspaceId),
        ),
      );
  }

  return {
    // ------------------------------------------------------------- queues

    async listPendingCaptures() {
      return db
        .select()
        .from(interactions)
        .where(
          and(
            eq(interactions.workspaceId, workspaceId),
            eq(interactions.extractionStatus, "pending"),
          ),
        )
        .orderBy(asc(interactions.occurredAt));
    },

    async listProposedExtractions() {
      return db
        .select({ extraction: extractions, interaction: interactions })
        .from(extractions)
        .innerJoin(interactions, eq(interactions.id, extractions.interactionId))
        .where(
          and(
            eq(extractions.workspaceId, workspaceId),
            eq(extractions.status, "proposed"),
          ),
        )
        .orderBy(desc(extractions.createdAt));
    },

    async listFailedExtractions() {
      return db
        .select({ extraction: extractions, interaction: interactions })
        .from(extractions)
        .innerJoin(interactions, eq(interactions.id, extractions.interactionId))
        .where(
          and(
            eq(extractions.workspaceId, workspaceId),
            eq(extractions.status, "failed"),
            eq(interactions.extractionStatus, "failed"),
          ),
        )
        .orderBy(desc(extractions.createdAt));
    },

    async getExtraction(extractionId: string) {
      const [row] = await db
        .select({ extraction: extractions, interaction: interactions })
        .from(extractions)
        .innerJoin(interactions, eq(interactions.id, extractions.interactionId))
        .where(
          and(
            eq(extractions.id, extractionId),
            eq(extractions.workspaceId, workspaceId),
          ),
        );
      return row ?? null;
    },

    async getExtractionsForInteraction(interactionId: string) {
      return db
        .select()
        .from(extractions)
        .where(
          and(
            eq(extractions.workspaceId, workspaceId),
            eq(extractions.interactionId, interactionId),
          ),
        )
        .orderBy(desc(extractions.createdAt));
    },

    async getRevisionsForBatch(batchId: string) {
      return db
        .select()
        .from(revisions)
        .where(
          and(
            eq(revisions.workspaceId, workspaceId),
            eq(revisions.batchId, batchId),
          ),
        )
        .orderBy(asc(revisions.createdAt));
    },

    /** Re-run escape hatch: mark pending again; prior extraction rows remain for comparison. */
    async reRunExtraction(interactionId: string) {
      await db
        .update(interactions)
        .set({ extractionStatus: "pending" })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.workspaceId, workspaceId),
          ),
        );
    },

    // ------------------------------------------------------------ context

    /**
     * Everything Claude needs to extract: raw source, the roster for entity
     * resolution, and current memories for the linked contacts only (AI
     * payload minimization per spec §8 — other candidates via get_contact).
     */
    async getExtractionContext(interactionId: string) {
      const [interaction] = await db
        .select()
        .from(interactions)
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.workspaceId, workspaceId),
          ),
        );
      if (!interaction) return null;

      const [workspace] = await db
        .select({ ownerUserId: workspaces.ownerUserId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      const [owner] = await db
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, workspace.ownerUserId));

      const linked = await db
        .select({ contactId: interactionContacts.contactId })
        .from(interactionContacts)
        .where(eq(interactionContacts.interactionId, interactionId));
      const linkedIds = linked.map((l) => l.contactId);

      const roster = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          preferredName: contacts.preferredName,
          currentCompany: contacts.currentCompany,
          currentRole: contacts.currentRole,
          location: contacts.location,
          lastInteractionDate: contacts.lastInteractionDate,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, workspaceId),
            sql`${contacts.deletedAt} IS NULL`,
          ),
        );

      const linkedMemories =
        linkedIds.length === 0
          ? []
          : await db
              .select({
                id: memories.id,
                contactId: memories.contactId,
                text: memories.text,
                category: memories.category,
                status: memories.status,
              })
              .from(memories)
              .where(
                and(
                  eq(memories.workspaceId, workspaceId),
                  inArray(memories.contactId, linkedIds),
                  eq(memories.status, "current"),
                ),
              );

      const linkedFollowUps =
        linkedIds.length === 0
          ? []
          : await db
              .select({
                id: followUps.id,
                contactId: followUps.contactId,
                description: followUps.description,
                status: followUps.status,
              })
              .from(followUps)
              .where(
                and(
                  eq(followUps.workspaceId, workspaceId),
                  inArray(followUps.contactId, linkedIds),
                  eq(followUps.status, "open"),
                ),
              );

      return {
        interaction: {
          id: interaction.id,
          type: interaction.type,
          occurredAt: interaction.occurredAt,
          location: interaction.location,
          rawSource: interaction.rawSource,
          sourceType: interaction.sourceType,
        },
        userTimezone: owner?.timezone ?? "America/New_York",
        linkedContactIds: linkedIds,
        roster,
        currentMemories: linkedMemories,
        openFollowUps: linkedFollowUps,
        promptVersion: PROMPT_VERSION,
      };
    },

    // ------------------------------------------------------------ staging

    /**
     * Validate and stage a proposal. Computes apply-time dedup flags via
     * trigram similarity against the target contact's current memories.
     */
    async saveProposal(
      interactionId: string,
      rawProposal: unknown,
      meta: { model: string },
    ) {
      const [interaction] = await db
        .select({ id: interactions.id })
        .from(interactions)
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.workspaceId, workspaceId),
          ),
        );
      if (!interaction) throw new Error("Interaction not found");

      const proposal: Proposal = proposalSchema.parse(rawProposal);

      // Workspace-scope every referenced id — a proposal can never touch
      // another workspace's rows.
      const referencedMemoryIds = [
        ...proposal.supersessions.map((s) => s.existing_memory_id),
        ...proposal.already_known.map((a) => a.existing_memory_id),
      ];
      if (referencedMemoryIds.length > 0) {
        const found = await db
          .select({ id: memories.id })
          .from(memories)
          .where(
            and(
              eq(memories.workspaceId, workspaceId),
              inArray(memories.id, referencedMemoryIds),
            ),
          );
        if (found.length !== new Set(referencedMemoryIds).size)
          throw new Error("Proposal references a memory not in this workspace");
      }

      // Same check for follow-ups the proposal wants to close. Apply is also
      // workspace-scoped, but failing here gives a real error instead of
      // silently dropping the item at apply time.
      const referencedFollowUpIds = proposal.completed_follow_ups.map(
        (c) => c.follow_up_id,
      );
      if (referencedFollowUpIds.length > 0) {
        const found = await db
          .select({ id: followUps.id })
          .from(followUps)
          .where(
            and(
              eq(followUps.workspaceId, workspaceId),
              inArray(followUps.id, referencedFollowUpIds),
            ),
          );
        if (found.length !== new Set(referencedFollowUpIds).size)
          throw new Error(
            "Proposal references a follow-up not in this workspace",
          );
      }
      const referencedContactIds = new Set<string>();
      for (const b of proposal.contact_bindings)
        if (b.contact_id) referencedContactIds.add(b.contact_id);
      for (const u of proposal.contact_field_updates)
        referencedContactIds.add(u.contact_id);
      for (const item of [
        ...proposal.new_memories,
        ...[],
        ...proposal.follow_ups,
      ]) {
        if (/^[0-9a-f-]{36}$/i.test(item.contact))
          referencedContactIds.add(item.contact);
      }
      if (referencedContactIds.size > 0) {
        const ids = [...referencedContactIds];
        const found = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(eq(contacts.workspaceId, workspaceId), inArray(contacts.id, ids)),
          );
        if (found.length !== ids.length)
          throw new Error("Proposal references a contact not in this workspace");
      }

      const flags: ProposalFlags = { new_memories: {} };
      for (let i = 0; i < proposal.new_memories.length; i++) {
        const m = proposal.new_memories[i];
        if (!/^[0-9a-f-]{36}$/i.test(m.contact)) continue;
        const [match] = await db
          .select({
            id: memories.id,
            text: memories.text,
            similarity: sql<number>`similarity(${memories.text}, ${m.text})`,
          })
          .from(memories)
          .where(
            and(
              eq(memories.workspaceId, workspaceId),
              eq(memories.contactId, m.contact),
              eq(memories.status, "current"),
            ),
          )
          .orderBy(sql`similarity(${memories.text}, ${m.text}) DESC`)
          .limit(1);
        if (match && match.similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
          flags.new_memories[i] = {
            probableDuplicate: true,
            matchMemoryId: match.id,
            matchText: match.text,
            similarity: Number(match.similarity),
          };
        }
      }

      // A proposed "new" person may already exist — surface candidates now,
      // while the user is deciding, rather than creating a second record.
      for (const b of proposal.contact_bindings) {
        if (b.status !== "new" || !b.new_contact) continue;
        const similar = await base.findSimilarContacts(
          b.new_contact.first_name,
          b.new_contact.last_name,
        );
        if (similar.length === 0) continue;
        flags.new_contacts ??= {};
        flags.new_contacts[b.mention] = similar.map((s) => ({
          contactId: s.id,
          name: `${s.firstName} ${s.lastName ?? ""}`.trim(),
          company: s.currentCompany,
          similarity: Number(s.similarity),
        }));
      }

      const staged: StagedProposal = { proposal, flags };
      const prior = await db
        .select({ id: extractions.id })
        .from(extractions)
        .where(
          and(
            eq(extractions.workspaceId, workspaceId),
            eq(extractions.interactionId, interactionId),
          ),
        );

      const [row] = await db
        .insert(extractions)
        .values({
          workspaceId,
          interactionId,
          model: meta.model,
          promptVersion: PROMPT_VERSION,
          rawResponseJson: jsonSafe(rawProposal),
          proposalJson: jsonSafe(staged),
          status: "proposed",
          attempt: prior.length + 1,
        })
        .returning();
      await db
        .update(interactions)
        .set({ extractionStatus: "succeeded" })
        .where(eq(interactions.id, interactionId));

      return { extraction: row, staged };
    },

    /** Spec §5 failure handling: extraction failure is never capture failure. */
    async markExtractionFailed(
      interactionId: string,
      error: string,
      meta: { model: string },
    ) {
      const prior = await db
        .select({ id: extractions.id })
        .from(extractions)
        .where(
          and(
            eq(extractions.workspaceId, workspaceId),
            eq(extractions.interactionId, interactionId),
          ),
        );
      await db.insert(extractions).values({
        workspaceId,
        interactionId,
        model: meta.model,
        promptVersion: PROMPT_VERSION,
        status: "failed",
        error,
        attempt: prior.length + 1,
      });
      await db
        .update(interactions)
        .set({ extractionStatus: "failed" })
        .where(
          and(
            eq(interactions.id, interactionId),
            eq(interactions.workspaceId, workspaceId),
          ),
        );
    },

    // ------------------------------------------------------------- apply

    /**
     * Apply the approved subset in one transaction, emitting a revisions row
     * for every write under a shared batch_id (the basis of one-tap undo).
     * Ambiguous and new-contact bindings must be resolved in selections.
     */
    async applyExtraction(
      extractionId: string,
      rawSelections: unknown,
      actorUserId: string,
    ) {
      const selections: Selections = selectionsSchema.parse(rawSelections);
      const found = await this.getExtraction(extractionId);
      if (!found) throw new Error("Extraction not found");
      if (found.extraction.status !== "proposed")
        throw new Error(`Extraction is ${found.extraction.status}, not proposed`);
      const staged = found.extraction.proposalJson as StagedProposal;
      const proposal = proposalSchema.parse(staged.proposal);
      const interaction = found.interaction;

      // Resolve every mention up front; blocking rules enforced here.
      const mentionMap = new Map<string, string | null>();
      const pendingCreates = new Map<
        string,
        NonNullable<Proposal["contact_bindings"][number]["new_contact"]>
      >();
      for (const b of proposal.contact_bindings) {
        const resolution = selections.binding_resolutions[b.mention];
        if (b.status === "confident" && b.contact_id) {
          mentionMap.set(
            b.mention,
            resolution && resolution !== "create" && resolution !== "skip"
              ? resolution
              : b.contact_id,
          );
        } else if (resolution === "skip") {
          mentionMap.set(b.mention, null);
        } else if (resolution === "create") {
          if (b.status !== "new" || !b.new_contact)
            throw new Error(`No new-contact details for "${b.mention}"`);
          pendingCreates.set(b.mention, b.new_contact);
        } else if (resolution) {
          mentionMap.set(b.mention, resolution);
        } else if (b.status === "ambiguous") {
          throw new Error(
            `Ambiguous contact "${b.mention}" must be resolved before applying`,
          );
        } else if (b.status === "new") {
          throw new Error(
            `New contact "${b.mention}" must be confirmed or skipped before applying`,
          );
        }
      }

      const batchId = crypto.randomUUID();
      const touchedContacts = new Set<string>();
      const counts = {
        contactsCreated: 0,
        contactsLinked: 0,
        memoriesAdded: 0,
        memoriesSuperseded: 0,
        memoriesConfirmed: 0,
        followUpsAdded: 0,
        followUpsCompleted: 0,
        fieldsUpdated: 0,
      };

      await db.transaction(async (tx) => {
        const rev = (
          r: Omit<
            Parameters<typeof writeRevision>[1],
            "changeSource" | "batchId" | "actorUserId"
          >,
        ) =>
          writeRevision(tx, {
            ...r,
            changeSource: "ai_applied",
            batchId,
            actorUserId,
          });

        // Confirmed new contacts.
        for (const [mention, nc] of pendingCreates) {
          const [created] = await tx
            .insert(contacts)
            .values({
              workspaceId,
              firstName: nc.first_name,
              lastName: nc.last_name,
              currentCompany: nc.current_company,
              currentRole: nc.current_role,
              location: nc.location,
              relationshipCategory: nc.relationship_category,
              howWeMet: nc.how_we_met,
            })
            .returning();
          mentionMap.set(mention, created.id);
          touchedContacts.add(created.id);
          counts.contactsCreated++;
          await rev({
            entityType: "contact",
            entityId: created.id,
            newValue: created,
          });
        }

        const resolveRef = (ref: string): string | null => {
          if (/^[0-9a-f-]{36}$/i.test(ref)) return ref;
          return mentionMap.get(ref) ?? null;
        };

        // Link resolved contacts to the interaction.
        const alreadyLinked = new Set(
          (
            await tx
              .select({ contactId: interactionContacts.contactId })
              .from(interactionContacts)
              .where(eq(interactionContacts.interactionId, interaction.id))
          ).map((r) => r.contactId),
        );
        for (const contactId of mentionMap.values()) {
          if (!contactId || alreadyLinked.has(contactId)) continue;
          await tx.insert(interactionContacts).values({
            interactionId: interaction.id,
            contactId,
            workspaceId,
          });
          alreadyLinked.add(contactId);
          touchedContacts.add(contactId);
          counts.contactsLinked++;
          await rev({
            entityType: "interaction_contact",
            entityId: interaction.id,
            field: "contact",
            newValue: { contactId },
          });
        }

        // Interaction metadata (editable; raw_source never touched).
        if (selections.interaction_meta && proposal.interaction) {
          const meta = proposal.interaction;
          const updates: Partial<typeof interactions.$inferInsert> = {};
          if (meta.type && meta.type !== interaction.type) {
            updates.type = meta.type;
            await rev({
              entityType: "interaction",
              entityId: interaction.id,
              field: "type",
              oldValue: interaction.type,
              newValue: meta.type,
            });
          }
          if (meta.occurred_at) {
            const next = new Date(meta.occurred_at);
            if (
              !isNaN(next.getTime()) &&
              next.getTime() !== interaction.occurredAt.getTime()
            ) {
              updates.occurredAt = next;
              await rev({
                entityType: "interaction",
                entityId: interaction.id,
                field: "occurred_at",
                oldValue: interaction.occurredAt.toISOString(),
                newValue: next.toISOString(),
              });
            }
          }
          if (
            meta.location !== undefined &&
            meta.location !== interaction.location
          ) {
            updates.location = meta.location;
            await rev({
              entityType: "interaction",
              entityId: interaction.id,
              field: "location",
              oldValue: interaction.location,
              newValue: meta.location,
            });
          }
          if (meta.summary && meta.summary !== interaction.aiSummary) {
            updates.aiSummary = meta.summary;
            await rev({
              entityType: "interaction",
              entityId: interaction.id,
              field: "ai_summary",
              oldValue: interaction.aiSummary,
              newValue: meta.summary,
            });
          }
          if (Object.keys(updates).length > 0) {
            await tx
              .update(interactions)
              .set(updates)
              .where(eq(interactions.id, interaction.id));
          }
        }

        // New memories (with user edits applied).
        const learnedAt = interaction.occurredAt.toISOString().slice(0, 10);
        const memoryIdByIndex = new Map<number, string>();
        for (const i of selections.new_memories) {
          const m = proposal.new_memories[i];
          if (!m) continue;
          const contactId = resolveRef(m.contact);
          if (!contactId) continue;
          const edit = selections.edits.new_memories[String(i)] ?? {};
          const [created] = await tx
            .insert(memories)
            .values({
              workspaceId,
              contactId,
              text: edit.text ?? m.text,
              category: edit.category ?? m.category,
              eventDate: edit.event_date !== undefined ? edit.event_date : m.event_date ?? null,
              eventDatePrecision: m.event_date_precision,
              learnedAt,
              sourceInteractionId: interaction.id,
              createdBy: "ai",
            })
            .returning();
          memoryIdByIndex.set(i, created.id);
          touchedContacts.add(contactId);
          counts.memoriesAdded++;
          await rev({
            entityType: "memory",
            entityId: created.id,
            newValue: created,
          });
        }

        // Supersessions — old memory preserved forever, never deleted.
        for (const i of selections.supersessions) {
          const s = proposal.supersessions[i];
          if (!s) continue;
          const replacementId = memoryIdByIndex.get(s.replacement_memory_index);
          if (!replacementId) continue;
          const [old] = await tx
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.id, s.existing_memory_id),
                eq(memories.workspaceId, workspaceId),
              ),
            );
          if (!old) continue;
          await tx
            .update(memories)
            .set({ status: "superseded", supersededByMemoryId: replacementId })
            .where(eq(memories.id, old.id));
          touchedContacts.add(old.contactId);
          counts.memoriesSuperseded++;
          await rev({
            entityType: "memory",
            entityId: old.id,
            field: "supersession",
            oldValue: { status: old.status, superseded_by_memory_id: old.supersededByMemoryId },
            newValue: { status: "superseded", superseded_by_memory_id: replacementId, reason: s.reason },
          });
        }

        // Already-known facts: bump last_confirmed_at (re-confirmed facts are load-bearing).
        for (const i of selections.already_known) {
          const a = proposal.already_known[i];
          if (!a) continue;
          const [old] = await tx
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.id, a.existing_memory_id),
                eq(memories.workspaceId, workspaceId),
              ),
            );
          if (!old) continue;
          await tx
            .update(memories)
            .set({ lastConfirmedAt: interaction.occurredAt })
            .where(eq(memories.id, old.id));
          touchedContacts.add(old.contactId);
          counts.memoriesConfirmed++;
          await rev({
            entityType: "memory",
            entityId: old.id,
            field: "last_confirmed_at",
            oldValue: old.lastConfirmedAt?.toISOString() ?? null,
            newValue: interaction.occurredAt.toISOString(),
          });
        }

        // Follow-ups — reason always required by the schema.
        for (const i of selections.follow_ups) {
          const f = proposal.follow_ups[i];
          if (!f) continue;
          const contactId = resolveRef(f.contact);
          if (!contactId) continue;
          const edit = selections.edits.follow_ups[String(i)] ?? {};
          const [created] = await tx
            .insert(followUps)
            .values({
              workspaceId,
              contactId,
              description: edit.description ?? f.description,
              reason: f.reason,
              dueDate: edit.due_date !== undefined ? edit.due_date : f.due_date ?? null,
              priority: f.priority,
              createdBy: "ai",
            })
            .returning();
          touchedContacts.add(contactId);
          counts.followUpsAdded++;
          await rev({
            entityType: "follow_up",
            entityId: created.id,
            newValue: created,
          });
        }

        // Closing the loop: the source text IS what an open follow-up was
        // waiting on. Scoped to the workspace and to still-open rows, so a
        // stale proposal can't reach across workspaces or double-close.
        for (const i of selections.completed_follow_ups) {
          const c = proposal.completed_follow_ups[i];
          if (!c) continue;
          const [existing] = await tx
            .select()
            .from(followUps)
            .where(
              and(
                eq(followUps.id, c.follow_up_id),
                eq(followUps.workspaceId, workspaceId),
                eq(followUps.status, "open"),
              ),
            );
          if (!existing) continue;
          await tx
            .update(followUps)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(followUps.id, existing.id));
          touchedContacts.add(existing.contactId);
          counts.followUpsCompleted++;
          // field + oldValue is what undo reads to put it back to open.
          await rev({
            entityType: "follow_up",
            entityId: existing.id,
            field: "status",
            oldValue: existing.status,
            newValue: "completed",
          });
        }

        // Contact field updates: diff applied, old value preserved as a
        // historical memory — never a deletion.
        for (const i of selections.contact_field_updates) {
          const u = proposal.contact_field_updates[i];
          if (!u) continue;
          const column = CONTACT_FIELD_MAP[u.field];
          const [contact] = await tx
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.id, u.contact_id),
                eq(contacts.workspaceId, workspaceId),
              ),
            );
          if (!contact) continue;
          const oldValue = contact[column] ?? null;
          if (oldValue === u.new_value) continue;
          await tx
            .update(contacts)
            .set({ [column]: u.new_value, updatedAt: new Date() })
            .where(eq(contacts.id, contact.id));
          touchedContacts.add(contact.id);
          counts.fieldsUpdated++;
          await rev({
            entityType: "contact",
            entityId: contact.id,
            field: u.field,
            oldValue,
            newValue: u.new_value,
          });
          if (oldValue) {
            const label = u.field.replace(/_/g, " ");
            const [hist] = await tx
              .insert(memories)
              .values({
                workspaceId,
                contactId: contact.id,
                text: `Previous ${label}: ${oldValue}`,
                category: HISTORICAL_MEMORY_CATEGORY[u.field],
                status: "historical",
                learnedAt,
                sourceInteractionId: interaction.id,
                createdBy: "ai",
              })
              .returning();
            await rev({
              entityType: "memory",
              entityId: hist.id,
              newValue: hist,
            });
          }
        }

        await tx
          .update(extractions)
          .set({ status: "applied", appliedAt: new Date(), batchId })
          .where(eq(extractions.id, extractionId));
        await markSummariesStale(tx, [...touchedContacts]);
      });

      await base.recomputeLastInteraction([...touchedContacts]);
      return { batchId, counts, touchedContacts: [...touchedContacts] };
    },

    // -------------------------------------------------------------- undo

    /**
     * Spec §5 Stage 4 semantics: revert every revision in the batch that has
     * no later revision; rows edited since are left alone and reported.
     * The undo itself is recorded (change_source: 'undo'); never a deletion
     * of history, and permanently available.
     */
    async undoBatch(batchId: string, actorUserId: string) {
      const batch = await this.getRevisionsForBatch(batchId);
      const toUndo = batch.filter((r) => r.changeSource === "ai_applied");
      if (toUndo.length === 0)
        return { reverted: 0, skipped: 0, alreadyUndone: true };

      const undoGroupId = crypto.randomUUID();
      let reverted = 0;
      let skipped = 0;
      const touchedContacts = new Set<string>();

      await db.transaction(async (tx) => {
        // Undo in reverse application order.
        for (const r of [...toUndo].reverse()) {
          // Compare timestamps in SQL — JS Dates truncate Postgres microseconds,
          // which would make every revision look "later than itself".
          const [later] = await tx
            .select({ id: revisions.id })
            .from(revisions)
            .where(
              and(
                eq(revisions.workspaceId, workspaceId),
                eq(revisions.entityType, r.entityType),
                eq(revisions.entityId, r.entityId),
                ne(revisions.id, r.id),
                gt(
                  revisions.createdAt,
                  sql`(SELECT created_at FROM revisions WHERE id = ${r.id})`,
                ),
                ne(revisions.changeSource, "undo"),
                r.field
                  ? sql`(${revisions.field} = ${r.field} OR ${revisions.field} IS NULL)`
                  : sql`TRUE`,
              ),
            )
            .limit(1);
          if (later) {
            skipped++;
            continue;
          }

          const isInsert = r.oldValue === null && r.newValue !== null && !r.field;
          const undone = await revertRevision(tx, r, isInsert, touchedContacts);
          if (!undone) {
            skipped++;
            continue;
          }
          reverted++;
          await writeRevision(tx, {
            entityType: r.entityType,
            entityId: r.entityId,
            field: r.field,
            oldValue: r.newValue,
            newValue: r.oldValue,
            changeSource: "undo",
            batchId: undoGroupId,
            actorUserId,
          });
        }

        // Re-open the extraction so the proposal can be re-applied.
        await tx
          .update(extractions)
          .set({ status: "proposed", appliedAt: null, batchId: null })
          .where(
            and(
              eq(extractions.batchId, batchId),
              eq(extractions.workspaceId, workspaceId),
            ),
          );
        await markSummariesStale(tx, [...touchedContacts]);
      });

      await base.recomputeLastInteraction([...touchedContacts]);
      return { reverted, skipped, alreadyUndone: false };
    },
  };

  /** Typed per-entity revert. Returns false when the revert can't apply. */
  async function revertRevision(
    tx: Tx,
    r: typeof revisions.$inferSelect,
    isInsert: boolean,
    touchedContacts: Set<string>,
  ): Promise<boolean> {
    const old = r.oldValue as Record<string, unknown> | null;
    const created = r.newValue as Record<string, unknown> | null;

    switch (r.entityType) {
      case "memory": {
        if (isInsert) {
          const [row] = await tx
            .select({ contactId: memories.contactId })
            .from(memories)
            .where(eq(memories.id, r.entityId));
          if (!row) return false;
          await tx.delete(memories).where(eq(memories.id, r.entityId));
          touchedContacts.add(row.contactId);
          return true;
        }
        const [row] = await tx
          .select()
          .from(memories)
          .where(eq(memories.id, r.entityId));
        if (!row) return false;
        touchedContacts.add(row.contactId);
        if (r.field === "supersession") {
          // Restore the old memory to current and clear the pointer.
          await tx
            .update(memories)
            .set({
              status: (old?.status as "current") ?? "current",
              supersededByMemoryId:
                (old?.superseded_by_memory_id as string | null) ?? null,
            })
            .where(eq(memories.id, r.entityId));
          return true;
        }
        if (r.field === "last_confirmed_at") {
          await tx
            .update(memories)
            .set({
              lastConfirmedAt: old ? new Date(old as unknown as string) : null,
            })
            .where(eq(memories.id, r.entityId));
          return true;
        }
        return false;
      }
      case "follow_up": {
        // Reopen a follow-up that the apply closed. Without this, undoing a
        // batch would leave the follow-up shut and the user still owing the
        // thing, with no sign of it on Home.
        if (r.field === "status") {
          const [row] = await tx
            .select({ contactId: followUps.contactId, status: followUps.status })
            .from(followUps)
            .where(eq(followUps.id, r.entityId));
          if (!row) return false;
          // Someone may have reopened or re-closed it since; don't fight them.
          if (row.status !== "completed") return false;
          await tx
            .update(followUps)
            .set({ status: "open", completedAt: null })
            .where(eq(followUps.id, r.entityId));
          touchedContacts.add(row.contactId);
          return true;
        }
        if (!isInsert) return false;
        const [row] = await tx
          .select({ contactId: followUps.contactId })
          .from(followUps)
          .where(eq(followUps.id, r.entityId));
        if (!row) return false;
        await tx.delete(followUps).where(eq(followUps.id, r.entityId));
        touchedContacts.add(row.contactId);
        return true;
      }
      case "contact": {
        if (isInsert) {
          // AI-created contact: soft-delete on undo, never hard-delete.
          await tx
            .update(contacts)
            .set({ deletedAt: new Date() })
            .where(eq(contacts.id, r.entityId));
          touchedContacts.add(r.entityId);
          return true;
        }
        if (!r.field) return false;
        const column =
          CONTACT_FIELD_MAP[r.field as keyof typeof CONTACT_FIELD_MAP];
        if (!column) return false;
        await tx
          .update(contacts)
          .set({ [column]: r.oldValue as string | null, updatedAt: new Date() })
          .where(eq(contacts.id, r.entityId));
        touchedContacts.add(r.entityId);
        return true;
      }
      case "interaction_contact": {
        const contactId = (created as { contactId?: string } | null)?.contactId;
        if (!contactId) return false;
        await tx
          .delete(interactionContacts)
          .where(
            and(
              eq(interactionContacts.interactionId, r.entityId),
              eq(interactionContacts.contactId, contactId),
            ),
          );
        touchedContacts.add(contactId);
        return true;
      }
      case "interaction": {
        if (!r.field) return false;
        const fieldMap: Record<string, string> = {
          type: "type",
          occurred_at: "occurredAt",
          location: "location",
          ai_summary: "aiSummary",
        };
        const column = fieldMap[r.field];
        if (!column) return false;
        const value =
          r.field === "occurred_at" && r.oldValue
            ? new Date(r.oldValue as string)
            : (r.oldValue as string | null);
        await tx
          .update(interactions)
          .set({ [column]: value })
          .where(eq(interactions.id, r.entityId));
        return true;
      }
      default:
        return false;
    }
  }
}
