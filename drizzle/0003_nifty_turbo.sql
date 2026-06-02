ALTER TYPE "public"."treasury_account_type" ADD VALUE 'operator';--> statement-breakpoint
ALTER TABLE "treasury_accounts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "treasury_accounts_archived_at_idx" ON "treasury_accounts" USING btree ("archived_at");