ALTER TYPE "public"."ledger_category" ADD VALUE 'rip_expense' BEFORE 'provider_expense';--> statement-breakpoint
CREATE TABLE "rips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title_encrypted" jsonb NOT NULL,
	"url_encrypted" jsonb NOT NULL,
	"created_by_wallet_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "rip_id" uuid;--> statement-breakpoint
CREATE INDEX "rips_created_at_idx" ON "rips" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rips_created_by_wallet_address_idx" ON "rips" USING btree (lower("created_by_wallet_address"));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_rip_id_rips_id_fk" FOREIGN KEY ("rip_id") REFERENCES "public"."rips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_rip_id_idx" ON "ledger_entries" USING btree ("rip_id");