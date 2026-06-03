CREATE TYPE "public"."treasury_transfer_direction" AS ENUM('inflow', 'outflow', 'internal');--> statement-breakpoint
CREATE TABLE "treasury_transaction_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treasury_transaction_id" uuid NOT NULL,
	"treasury_account_id" uuid,
	"transfer_id" text NOT NULL,
	"direction" "treasury_transfer_direction" NOT NULL,
	"transfer_type" text NOT NULL,
	"account_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"token_address" text,
	"asset_symbol" text NOT NULL,
	"asset_name" text NOT NULL,
	"decimals" integer NOT NULL,
	"raw_amount" numeric(78, 0) NOT NULL,
	"amount" numeric(36, 18) NOT NULL,
	"usd_price" numeric(18, 8),
	"usd_amount" numeric(18, 2),
	"raw_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treasury_account_id" uuid,
	"source" "ledger_source" NOT NULL,
	"account_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"safe_transaction_hash" text,
	"transaction_type" text NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"block_number" integer,
	"raw_metadata" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treasury_transaction_transfers" ADD CONSTRAINT "treasury_transaction_transfers_treasury_transaction_id_treasury_transactions_id_fk" FOREIGN KEY ("treasury_transaction_id") REFERENCES "public"."treasury_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transaction_transfers" ADD CONSTRAINT "treasury_transaction_transfers_treasury_account_id_treasury_accounts_id_fk" FOREIGN KEY ("treasury_account_id") REFERENCES "public"."treasury_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_treasury_account_id_treasury_accounts_id_fk" FOREIGN KEY ("treasury_account_id") REFERENCES "public"."treasury_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_transaction_transfers_chain_transfer_unique" ON "treasury_transaction_transfers" USING btree ("chain_id",lower("account_address"),"transfer_id");--> statement-breakpoint
CREATE INDEX "treasury_transaction_transfers_transaction_id_idx" ON "treasury_transaction_transfers" USING btree ("treasury_transaction_id");--> statement-breakpoint
CREATE INDEX "treasury_transaction_transfers_treasury_account_id_idx" ON "treasury_transaction_transfers" USING btree ("treasury_account_id");--> statement-breakpoint
CREATE INDEX "treasury_transaction_transfers_tx_hash_idx" ON "treasury_transaction_transfers" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "treasury_transaction_transfers_executed_at_idx" ON "treasury_transaction_transfers" USING btree ("executed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_transactions_chain_account_tx_unique" ON "treasury_transactions" USING btree ("chain_id",lower("account_address"),lower("tx_hash"));--> statement-breakpoint
CREATE INDEX "treasury_transactions_tx_hash_idx" ON "treasury_transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "treasury_transactions_account_executed_idx" ON "treasury_transactions" USING btree ("chain_id","account_address","executed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "treasury_transactions_treasury_account_id_idx" ON "treasury_transactions" USING btree ("treasury_account_id");
