CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'import', 'classify', 'publish', 'reopen', 'grant_role', 'revoke_role');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('client', 'provider', 'subcontractor');--> statement-breakpoint
CREATE TYPE "public"."ledger_category" AS ENUM('raid_revenue', 'subcontractor_payout', 'provider_expense', 'member_dues', 'ragequit', 'treasury_transfer', 'uncategorized');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('main_safe', 'side_vault', 'manual', 'bank_csv', 'dao_proposal');--> statement-breakpoint
CREATE TYPE "public"."quarter_status" AS ENUM('draft', 'ready_for_review', 'published', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."treasury_account_type" AS ENUM('main_safe', 'side_vault');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'unverified');--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"display_name_encrypted" jsonb,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_wallet_address" text,
	"action" "audit_action" NOT NULL,
	"subject_table" text NOT NULL,
	"subject_id" uuid,
	"quarter_id" uuid,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cleric_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"granted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "entity_type" NOT NULL,
	"name_encrypted" jsonb NOT NULL,
	"website_encrypted" jsonb,
	"notes_encrypted" jsonb,
	"is_member" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer,
	"label_encrypted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter_id" uuid,
	"source" "ledger_source" NOT NULL,
	"category" "ledger_category" DEFAULT 'uncategorized' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'verified' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"chain_id" integer,
	"tx_hash" text,
	"treasury_account_id" uuid,
	"asset_symbol" text NOT NULL,
	"asset_amount" numeric(36, 18) NOT NULL,
	"usd_amount" numeric(18, 2) NOT NULL,
	"counterparty_entity_id" uuid,
	"raid_id" uuid,
	"notes_encrypted" jsonb,
	"source_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"year" integer NOT NULL,
	"quarter" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "quarter_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_entity_id" uuid NOT NULL,
	"name_encrypted" jsonb NOT NULL,
	"notes_encrypted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treasury_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_encrypted" jsonb NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"type" "treasury_account_type" NOT NULL,
	"is_dao_controlled" boolean DEFAULT true NOT NULL,
	"notes_encrypted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleric_roles" ADD CONSTRAINT "cleric_roles_granted_by_user_id_app_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleric_roles" ADD CONSTRAINT "cleric_roles_revoked_by_user_id_app_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_addresses" ADD CONSTRAINT "entity_addresses_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_treasury_account_id_treasury_accounts_id_fk" FOREIGN KEY ("treasury_account_id") REFERENCES "public"."treasury_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_counterparty_entity_id_entities_id_fk" FOREIGN KEY ("counterparty_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_raid_id_raids_id_fk" FOREIGN KEY ("raid_id") REFERENCES "public"."raids"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raids" ADD CONSTRAINT "raids_client_entity_id_entities_id_fk" FOREIGN KEY ("client_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_wallet_address_unique" ON "app_users" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "audit_events_subject_idx" ON "audit_events" USING btree ("subject_table","subject_id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_user_id_idx" ON "audit_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_quarter_id_idx" ON "audit_events" USING btree ("quarter_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cleric_roles_wallet_address_idx" ON "cleric_roles" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "cleric_roles_active_idx" ON "cleric_roles" USING btree ("wallet_address","revoked_at");--> statement-breakpoint
CREATE INDEX "entities_type_idx" ON "entities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "entity_addresses_entity_id_idx" ON "entity_addresses" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_addresses_address_idx" ON "entity_addresses" USING btree ("address");--> statement-breakpoint
CREATE INDEX "ledger_entries_quarter_id_idx" ON "ledger_entries" USING btree ("quarter_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_category_idx" ON "ledger_entries" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ledger_entries_tx_hash_idx" ON "ledger_entries" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "ledger_entries_raid_id_idx" ON "ledger_entries" USING btree ("raid_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_occurred_at_idx" ON "ledger_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quarters_year_quarter_unique" ON "quarters" USING btree ("year","quarter");--> statement-breakpoint
CREATE INDEX "quarters_status_idx" ON "quarters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "raids_client_entity_id_idx" ON "raids" USING btree ("client_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treasury_accounts_chain_address_unique" ON "treasury_accounts" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "treasury_accounts_type_idx" ON "treasury_accounts" USING btree ("type");