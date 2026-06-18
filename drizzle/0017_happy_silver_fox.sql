CREATE TYPE "public"."quarter_balance_validation_status" AS ENUM('not_ready', 'needs_review', 'validated', 'acknowledged');--> statement-breakpoint
CREATE TABLE "quarter_balance_validations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter_id" uuid NOT NULL,
	"status" "quarter_balance_validation_status" NOT NULL,
	"checked_count" integer DEFAULT 0 NOT NULL,
	"variance_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"total_variance_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"details" jsonb NOT NULL,
	"acknowledgement_note_encrypted" jsonb,
	"acknowledged_by_wallet_address" text,
	"acknowledged_at" timestamp with time zone,
	"source_sync_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quarter_balance_validations" ADD CONSTRAINT "quarter_balance_validations_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quarter_balance_validations_quarter_id_unique" ON "quarter_balance_validations" USING btree ("quarter_id");--> statement-breakpoint
CREATE INDEX "quarter_balance_validations_status_idx" ON "quarter_balance_validations" USING btree ("status");