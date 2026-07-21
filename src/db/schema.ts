import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const interactionType = pgEnum("interaction_type", [
  "coffee",
  "meal",
  "meeting",
  "call",
  "email",
  "text",
  "conference",
  "intro",
  "event",
  "other",
]);

export const sourceType = pgEnum("source_type", [
  "manual_note",
  "pasted_transcript",
  "voice_note_transcript",
  "email",
  "calendar",
]);

export const extractionStatus = pgEnum("extraction_status", [
  "pending",
  "succeeded",
  "failed",
  "skipped",
]);

export const memoryCategory = pgEnum("memory_category", [
  "career",
  "education",
  "family",
  "interests",
  "goals",
  "geography",
  "projects",
  "personal",
  "preferences",
  "opportunities",
  "other",
]);

export const memoryStatus = pgEnum("memory_status", [
  "current",
  "superseded",
  "historical",
  "uncertain",
]);

export const eventDatePrecision = pgEnum("event_date_precision", [
  "exact",
  "month",
  "quarter",
  "year",
  "none",
]);

export const createdBy = pgEnum("created_by", ["user", "ai"]);

export const followUpPriority = pgEnum("follow_up_priority", [
  "low",
  "medium",
  "high",
]);

export const followUpStatus = pgEnum("follow_up_status", [
  "open",
  "completed",
  "dismissed",
]);

export const extractionRunStatus = pgEnum("extraction_run_status", [
  "pending",
  "proposed",
  "applied",
  "discarded",
  "failed",
]);

export const changeSource = pgEnum("change_source", [
  "user",
  "ai_applied",
  "ai_auto",
  "undo",
]);

// ---------------------------------------------------------------------------
// Users / workspaces / invites
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  // Required IANA timezone; every relative date the AI resolves anchors here.
  timezone: text("timezone").notNull().default("America/New_York"),
  settingsJson: jsonb("settings_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  invitedByUserId: uuid("invited_by_user_id")
    .notNull()
    .references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Auth.js support tables (email magic link: sessions + verification tokens)
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// MCP access tokens — each user's AI connects with their own token, resolved
// server-side to their workspace only. Tokens stored as SHA-256 hashes.
// ---------------------------------------------------------------------------

export const mcpTokens = pgTable("mcp_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    preferredName: text("preferred_name"),
    emails: text("emails").array().notNull().default([]),
    phone: text("phone"),
    currentCompany: text("current_company"),
    currentRole: text("current_role"),
    location: text("location"),
    linkedinUrl: text("linkedin_url"),
    website: text("website"),
    howWeMet: text("how_we_met"),
    dateFirstMet: date("date_first_met"),
    relationshipCategory: text("relationship_category"),
    notes: text("notes"),
    // Denormalized cache — recompute via repo.recomputeLastInteraction, never increment.
    lastInteractionDate: timestamp("last_interaction_date", {
      withTimezone: true,
    }),
    aiSummary: text("ai_summary"),
    aiSummaryStale: boolean("ai_summary_stale").notNull().default(false),
    aiSummaryGeneratedAt: timestamp("ai_summary_generated_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("contacts_workspace_idx").on(t.workspaceId)],
);

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export const interactions = pgTable(
  "interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    type: interactionType("type").notNull().default("other"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    location: text("location"),
    // Layer 1 — immutable after creation. Metadata above is editable; this is not.
    rawSource: text("raw_source").notNull(),
    rawSourceHash: text("raw_source_hash").notNull(),
    sourceType: sourceType("source_type").notNull().default("manual_note"),
    aiSummary: text("ai_summary"),
    extractionStatus: extractionStatus("extraction_status")
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("interactions_workspace_hash_uq").on(
      t.workspaceId,
      t.rawSourceHash,
    ),
    index("interactions_workspace_idx").on(t.workspaceId),
  ],
);

export const interactionContacts = pgTable(
  "interaction_contacts",
  {
    interactionId: uuid("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
  },
  (t) => [primaryKey({ columns: [t.interactionId, t.contactId] })],
);

// ---------------------------------------------------------------------------
// Memories (Layer 2 — user-approved structured facts)
// ---------------------------------------------------------------------------

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    category: memoryCategory("category").notNull().default("other"),
    sourceInteractionId: uuid("source_interaction_id").references(
      () => interactions.id,
    ),
    status: memoryStatus("status").notNull().default("current"),
    supersededByMemoryId: uuid("superseded_by_memory_id"),
    eventDate: date("event_date"),
    eventDatePrecision: eventDatePrecision("event_date_precision")
      .notNull()
      .default("none"),
    learnedAt: date("learned_at"),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    createdBy: createdBy("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("memories_contact_idx").on(t.contactId),
    index("memories_workspace_idx").on(t.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    // Merge tombstone: old references resolve through this instead of resurrecting.
    mergedIntoTagId: uuid("merged_into_tag_id"),
    createdBy: createdBy("created_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tags_workspace_normalized_uq").on(
      t.workspaceId,
      t.normalizedName,
    ),
  ],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] })],
);

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    // Required: the AI must always explain why it proposed a follow-up.
    reason: text("reason").notNull(),
    dueDate: date("due_date"),
    priority: followUpPriority("priority").notNull().default("medium"),
    status: followUpStatus("status").notNull().default("open"),
    createdBy: createdBy("created_by").notNull().default("user"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("follow_ups_workspace_idx").on(t.workspaceId)],
);

// ---------------------------------------------------------------------------
// Extractions (staging) & revisions (undo)
// ---------------------------------------------------------------------------

export const extractions = pgTable("extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  interactionId: uuid("interaction_id")
    .notNull()
    .references(() => interactions.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  rawResponseJson: jsonb("raw_response_json"),
  proposalJson: jsonb("proposal_json"),
  status: extractionRunStatus("status").notNull().default("pending"),
  error: text("error"),
  attempt: integer("attempt").notNull().default(1),
  // Set on apply; joins the extraction to its revisions batch for undo.
  batchId: uuid("batch_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const revisions = pgTable(
  "revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    field: text("field"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    changeSource: changeSource("change_source").notNull(),
    batchId: uuid("batch_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("revisions_entity_idx").on(t.entityType, t.entityId),
    index("revisions_batch_idx").on(t.batchId),
  ],
);
