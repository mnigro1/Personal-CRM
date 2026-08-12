CREATE TYPE "public"."intro_outcome" AS ENUM('no_response', 'met_once', 'ongoing', 'opportunity', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."intro_status" AS ENUM('proposed', 'opt_in_pending', 'opt_in_confirmed', 'sent', 'completed', 'declined', 'abandoned');--> statement-breakpoint
CREATE TABLE "intros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_a_contact_id" uuid NOT NULL,
	"person_b_contact_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "intro_status" DEFAULT 'proposed' NOT NULL,
	"a_opted_in_at" timestamp with time zone,
	"b_opted_in_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"channel" "message_channel",
	"channel_label" text,
	"intro_interaction_id" uuid,
	"outcome" "intro_outcome",
	"outcome_note" text,
	"outcome_recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD COLUMN "intro_id" uuid;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_person_a_contact_id_contacts_id_fk" FOREIGN KEY ("person_a_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_person_b_contact_id_contacts_id_fk" FOREIGN KEY ("person_b_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intros" ADD CONSTRAINT "intros_intro_interaction_id_interactions_id_fk" FOREIGN KEY ("intro_interaction_id") REFERENCES "public"."interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intros_workspace_idx" ON "intros" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "intros_person_a_idx" ON "intros" USING btree ("person_a_contact_id");--> statement-breakpoint
CREATE INDEX "intros_person_b_idx" ON "intros" USING btree ("person_b_contact_id");--> statement-breakpoint
CREATE INDEX "intros_workspace_status_idx" ON "intros" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_intro_id_intros_id_fk" FOREIGN KEY ("intro_id") REFERENCES "public"."intros"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-added (drizzle-kit can't express these; same approach as 0001).

-- An intro between someone and themselves is always a bug.
ALTER TABLE "intros" ADD CONSTRAINT "intros_distinct_people_check" CHECK ("person_a_contact_id" <> "person_b_contact_id");--> statement-breakpoint

-- One live intro per unordered pair. least/greatest normalizes (a,b) and
-- (b,a) to the same key, and the partial predicate lets a pair be introduced
-- again after the first attempt reaches a terminal state.
CREATE UNIQUE INDEX IF NOT EXISTS "intros_active_pair_uq" ON "intros" (
  "workspace_id",
  least("person_a_contact_id", "person_b_contact_id"),
  greatest("person_a_contact_id", "person_b_contact_id")
) WHERE "status" NOT IN ('completed', 'declined', 'abandoned');--> statement-breakpoint

-- Supports the follow-up -> intro join in get_draft_context.
CREATE INDEX IF NOT EXISTS "follow_ups_intro_idx" ON "follow_ups" ("intro_id");
