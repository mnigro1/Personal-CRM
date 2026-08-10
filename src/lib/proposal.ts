import { z } from "zod";
import {
  eventDatePrecision,
  interactionType,
  memoryCategory,
} from "@/db/schema";
import { normalizeDate } from "@/lib/normalize";

/**
 * Every date the extractor sends lands in a Postgres `date` column, which
 * rejects partial forms like "2023" outright and takes the whole apply down
 * with it. Normalizing at the schema boundary means no downstream code has
 * to remember, and an unparseable date drops to null instead of destroying
 * the memory or follow-up it was attached to.
 */
const looseDate = z
  .string()
  .nullish()
  .transform((v) => normalizeDate(v));

/**
 * The extraction proposal contract (spec §5 Stage 3), produced by Claude via
 * MCP and staged in the `extractions` table until the user approves.
 *
 * Contact references: items refer to people either by contact UUID (an
 * existing contact) or by the `mention` string of a binding whose status is
 * "new" — those stay blocked until the user confirms creation.
 */

export const PROMPT_VERSION = "v1";

const uuid = z.string().uuid();

/** UUID of an existing contact, or the mention text of a "new" binding. */
const contactRef = z.string().min(1);

export const contactBindingSchema = z.object({
  mention: z.string().min(1),
  status: z.enum(["confident", "ambiguous", "new"]),
  contact_id: uuid.nullish().describe("Set when status is confident"),
  candidates: z
    .array(z.object({ contact_id: uuid, hint: z.string().optional() }))
    .optional()
    .describe("Set when status is ambiguous"),
  confidence: z.number().min(0).max(1).optional(),
  new_contact: z
    .object({
      first_name: z.string().min(1),
      last_name: z.string().optional(),
      current_company: z.string().optional(),
      current_role: z.string().optional(),
      location: z.string().optional(),
      relationship_category: z.string().optional(),
      how_we_met: z.string().optional(),
    })
    .optional()
    .describe("Set when status is new"),
});

export const proposalSchema = z.object({
  interaction: z
    .object({
      type: z.enum(interactionType.enumValues).optional(),
      occurred_at: z.string().optional(),
      location: z.string().nullish(),
      summary: z.string().optional(),
    })
    .optional(),
  contact_bindings: z.array(contactBindingSchema).default([]),
  new_memories: z
    .array(
      z.object({
        contact: contactRef,
        text: z.string().min(1),
        category: z.enum(memoryCategory.enumValues).default("other"),
        event_date: looseDate,
        event_date_precision: z
          .enum(eventDatePrecision.enumValues)
          .default("none"),
      }),
    )
    .default([]),
  supersessions: z
    .array(
      z.object({
        existing_memory_id: uuid,
        reason: z.string().min(1),
        replacement_memory_index: z.number().int().min(0),
      }),
    )
    .default([]),
  already_known: z
    .array(
      z.object({
        existing_memory_id: uuid,
        restated: z.string().optional(),
      }),
    )
    .default([]),
  follow_ups: z
    .array(
      z.object({
        contact: contactRef,
        description: z.string().min(1),
        reason: z.string().min(1),
        due_date: looseDate,
        priority: z.enum(["low", "medium", "high"]).default("medium"),
      }),
    )
    .default([]),
  // Closing the loop. When the source text IS the thing an open follow-up was
  // waiting on — a pasted sent message, a screenshot of a reply, "I finally
  // emailed her" — the follow-up is done, and leaving it open makes the Home
  // view lie about what the user still owes.
  completed_follow_ups: z
    .array(
      z.object({
        follow_up_id: uuid,
        // What in the source shows it happened. Forces the model to point at
        // evidence instead of closing things that merely sound related.
        evidence: z.string().min(1),
      }),
    )
    .default([]),
  contact_field_updates: z
    .array(
      z.object({
        contact_id: uuid,
        field: z.enum([
          "current_company",
          "current_role",
          "location",
          "phone",
          "linkedin_url",
          "website",
        ]),
        old_value: z.string().nullish(),
        new_value: z.string().min(1),
      }),
    )
    .default([]),
});

export type Proposal = z.infer<typeof proposalSchema>;
export type ContactBinding = z.infer<typeof contactBindingSchema>;

/** Dedup flags computed at save time (trigram similarity vs existing records). */
export type ProposalFlags = {
  new_memories: Record<
    number,
    { probableDuplicate: boolean; matchMemoryId: string; matchText: string; similarity: number }
  >;
  /** Existing contacts that a proposed "new" person may already be. Keyed by mention. */
  new_contacts?: Record<
    string,
    { contactId: string; name: string; company: string | null; similarity: number }[]
  >;
};

/** What's stored in extractions.proposal_json. */
export type StagedProposal = {
  proposal: Proposal;
  flags: ProposalFlags;
};

/**
 * The user's approval decisions, from the review screen or chat.
 * Indices refer to positions in the proposal arrays.
 */
export const selectionsSchema = z.object({
  binding_resolutions: z
    .record(z.string(), z.union([uuid, z.literal("create"), z.literal("skip")]))
    .default({})
    .describe(
      "mention -> contact UUID (chosen binding), 'create' (confirm new contact), or 'skip'",
    ),
  interaction_meta: z.boolean().default(true),
  new_memories: z.array(z.number().int().min(0)).default([]),
  supersessions: z.array(z.number().int().min(0)).default([]),
  already_known: z.array(z.number().int().min(0)).default([]),
  follow_ups: z.array(z.number().int().min(0)).default([]),
  completed_follow_ups: z.array(z.number().int().min(0)).default([]),
  contact_field_updates: z.array(z.number().int().min(0)).default([]),
  edits: z
    .object({
      new_memories: z
        .record(
          z.string(),
          z.object({
            text: z.string().min(1).optional(),
            category: z.enum(memoryCategory.enumValues).optional(),
            event_date: looseDate,
          }),
        )
        .default({}),
      follow_ups: z
        .record(
          z.string(),
          z.object({
            description: z.string().min(1).optional(),
            due_date: looseDate,
          }),
        )
        .default({}),
    })
    .default({ new_memories: {}, follow_ups: {} }),
});

export type Selections = z.infer<typeof selectionsSchema>;

/** Convenience: a selections object that approves everything non-blocked, skipping flagged duplicates. */
export function selectAllDefaults(staged: StagedProposal): Selections {
  const p = staged.proposal;
  const dupIdx = new Set(
    Object.entries(staged.flags.new_memories)
      .filter(([, f]) => f.probableDuplicate)
      .map(([i]) => Number(i)),
  );
  return selectionsSchema.parse({
    binding_resolutions: {},
    interaction_meta: true,
    new_memories: p.new_memories.map((_, i) => i).filter((i) => !dupIdx.has(i)),
    supersessions: p.supersessions.map((_, i) => i),
    already_known: p.already_known.map((_, i) => i),
    follow_ups: p.follow_ups.map((_, i) => i),
    completed_follow_ups: p.completed_follow_ups.map((_, i) => i),
    contact_field_updates: p.contact_field_updates.map((_, i) => i),
  });
}
