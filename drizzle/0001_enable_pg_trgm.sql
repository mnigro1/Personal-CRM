CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx ON contacts USING gin ((coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(preferred_name,'')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memories_text_trgm_idx ON memories USING gin (text gin_trgm_ops);