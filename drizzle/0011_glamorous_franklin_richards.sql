CREATE TYPE "public"."quarter_sync_overall_status" AS ENUM('idle', 'running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."quarter_sync_step" AS ENUM('transactions', 'proposals', 'membership', 'finalize');--> statement-breakpoint
CREATE TYPE "public"."quarter_sync_step_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "quarter_sync_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"overall_status" "quarter_sync_overall_status" DEFAULT 'idle' NOT NULL,
	"current_step" "quarter_sync_step",
	"transactions_status" "quarter_sync_step_status" DEFAULT 'pending' NOT NULL,
	"proposals_status" "quarter_sync_step_status" DEFAULT 'pending' NOT NULL,
	"membership_status" "quarter_sync_step_status" DEFAULT 'pending' NOT NULL,
	"finalize_status" "quarter_sync_step_status" DEFAULT 'pending' NOT NULL,
	"transactions_started_at" timestamp with time zone,
	"transactions_completed_at" timestamp with time zone,
	"proposals_started_at" timestamp with time zone,
	"proposals_completed_at" timestamp with time zone,
	"membership_started_at" timestamp with time zone,
	"membership_completed_at" timestamp with time zone,
	"finalize_started_at" timestamp with time zone,
	"finalize_completed_at" timestamp with time zone,
	"transactions_error" text,
	"proposals_error" text,
	"membership_error" text,
	"finalize_error" text,
	"imported_transactions" integer DEFAULT 0 NOT NULL,
	"imported_transfers" integer DEFAULT 0 NOT NULL,
	"scanned_transfers" integer DEFAULT 0 NOT NULL,
	"sync_error_count" integer DEFAULT 0 NOT NULL,
	"proposal_linked_transactions" integer DEFAULT 0 NOT NULL,
	"proposal_matches" integer DEFAULT 0 NOT NULL,
	"membership_activities" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quarter_sync_statuses" ADD CONSTRAINT "quarter_sync_statuses_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quarter_sync_statuses_quarter_id_unique" ON "quarter_sync_statuses" USING btree ("quarter_id");--> statement-breakpoint
CREATE INDEX "quarter_sync_statuses_overall_status_idx" ON "quarter_sync_statuses" USING btree ("overall_status");--> statement-breakpoint
CREATE INDEX "quarter_sync_statuses_last_synced_at_idx" ON "quarter_sync_statuses" USING btree ("last_synced_at");--> statement-breakpoint
CREATE TRIGGER "quarter_sync_statuses_set_updated_at"
BEFORE UPDATE ON "quarter_sync_statuses"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();
