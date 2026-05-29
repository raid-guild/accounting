CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
DROP INDEX "app_users_wallet_address_unique";--> statement-breakpoint
DROP INDEX "cleric_roles_wallet_address_idx";--> statement-breakpoint
DROP INDEX "cleric_roles_active_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_wallet_address_unique" ON "app_users" USING btree (lower("wallet_address"));--> statement-breakpoint
CREATE INDEX "cleric_roles_wallet_address_idx" ON "cleric_roles" USING btree (lower("wallet_address"));--> statement-breakpoint
CREATE INDEX "cleric_roles_active_idx" ON "cleric_roles" USING btree (lower("wallet_address"),"revoked_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."set_updated_at"()
RETURNS trigger AS $$
BEGIN
	NEW."updated_at" = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "app_users_set_updated_at"
BEFORE UPDATE ON "app_users"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "cleric_roles_set_updated_at"
BEFORE UPDATE ON "cleric_roles"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "entities_set_updated_at"
BEFORE UPDATE ON "entities"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "entity_addresses_set_updated_at"
BEFORE UPDATE ON "entity_addresses"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_set_updated_at"
BEFORE UPDATE ON "ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "quarters_set_updated_at"
BEFORE UPDATE ON "quarters"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "raids_set_updated_at"
BEFORE UPDATE ON "raids"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "treasury_accounts_set_updated_at"
BEFORE UPDATE ON "treasury_accounts"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();
