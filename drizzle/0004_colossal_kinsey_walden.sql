CREATE TYPE "public"."message_channel" AS ENUM('text', 'slack', 'teams', 'email', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_draft_status" AS ENUM('requested', 'drafted', 'sent', 'sent_other', 'discarded');--> statement-breakpoint
CREATE TABLE "message_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"follow_up_id" uuid,
	"contact_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"channel_label" text,
	"status" "message_draft_status" DEFAULT 'requested' NOT NULL,
	"subject" text,
	"body" text,
	"ai_body" text,
	"instruction" text,
	"context_json" jsonb,
	"model" text,
	"prompt_version" text,
	"created_by" "created_by" DEFAULT 'user' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drafted_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_follow_up_id_follow_ups_id_fk" FOREIGN KEY ("follow_up_id") REFERENCES "public"."follow_ups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_drafts_workspace_idx" ON "message_drafts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "message_drafts_follow_up_idx" ON "message_drafts" USING btree ("follow_up_id");--> statement-breakpoint
CREATE INDEX "message_drafts_status_idx" ON "message_drafts" USING btree ("workspace_id","status");