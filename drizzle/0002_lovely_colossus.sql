CREATE TYPE "public"."treasury_snapshot_status" AS ENUM('pending_live_sync', 'synced', 'stale_syncing', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "treasury_balance_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"decimals" integer NOT NULL,
	"raw_amount" numeric(78, 0) NOT NULL,
	"balance" numeric(36, 18) NOT NULL,
	"usd_price" numeric(18, 8) NOT NULL,
	"usd_value" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"status" "treasury_snapshot_status" NOT NULL,
	"total_usd" numeric(18, 2) NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treasury_balance_assets" ADD CONSTRAINT "treasury_balance_assets_snapshot_id_treasury_balance_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."treasury_balance_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treasury_balance_assets_snapshot_id_idx" ON "treasury_balance_assets" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_balance_assets_snapshot_symbol_unique" ON "treasury_balance_assets" USING btree ("snapshot_id","symbol");--> statement-breakpoint
CREATE INDEX "treasury_balance_snapshots_chain_account_synced_idx" ON "treasury_balance_snapshots" USING btree ("chain_id","account_address","synced_at" DESC);--> statement-breakpoint
CREATE INDEX "treasury_balance_snapshots_synced_at_idx" ON "treasury_balance_snapshots" USING btree ("synced_at");--> statement-breakpoint
CREATE TRIGGER "treasury_balance_assets_set_updated_at"
BEFORE UPDATE ON "treasury_balance_assets"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "treasury_balance_snapshots_set_updated_at"
BEFORE UPDATE ON "treasury_balance_snapshots"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();
