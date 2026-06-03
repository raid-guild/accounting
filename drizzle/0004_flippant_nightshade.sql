ALTER TABLE "entities" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raids" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "entities_archived_at_idx" ON "entities" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "raids_archived_at_idx" ON "raids" USING btree ("archived_at");