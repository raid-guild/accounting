CREATE TYPE "public"."quarter_balance_boundary" AS ENUM('opening', 'closing');--> statement-breakpoint
ALTER TYPE "public"."quarter_sync_step" ADD VALUE 'balances' BEFORE 'finalize';--> statement-breakpoint
CREATE TABLE "quarter_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter_id" uuid NOT NULL,
	"treasury_account_id" uuid,
	"boundary" "quarter_balance_boundary" NOT NULL,
	"account_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" integer NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer NOT NULL,
	"raw_amount" numeric(78, 0) NOT NULL,
	"balance" numeric(36, 18) NOT NULL,
	"usd_price" numeric(18, 8) NOT NULL,
	"usd_value" numeric(18, 2) NOT NULL,
	"price_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quarter_sync_statuses" ADD COLUMN "balances_status" "quarter_sync_step_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "quarter_sync_statuses" ADD COLUMN "balances_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quarter_sync_statuses" ADD COLUMN "balances_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quarter_sync_statuses" ADD COLUMN "balances_error" text;--> statement-breakpoint
ALTER TABLE "quarter_balance_snapshots" ADD CONSTRAINT "quarter_balance_snapshots_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarter_balance_snapshots" ADD CONSTRAINT "quarter_balance_snapshots_treasury_account_id_treasury_accounts_id_fk" FOREIGN KEY ("treasury_account_id") REFERENCES "public"."treasury_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quarter_balance_snapshots_quarter_boundary_idx" ON "quarter_balance_snapshots" USING btree ("quarter_id","boundary");--> statement-breakpoint
CREATE UNIQUE INDEX "quarter_balance_snapshots_unique" ON "quarter_balance_snapshots" USING btree ("quarter_id","boundary","chain_id","account_address","symbol");
