CREATE TYPE "public"."membership_activity_type" AS ENUM('join', 'ragequit');--> statement-breakpoint
CREATE TABLE "membership_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter_id" uuid,
	"dao_proposal_id" uuid,
	"type" "membership_activity_type" NOT NULL,
	"dao_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"member_address" text NOT NULL,
	"recipient_address" text,
	"tx_hash" text NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"proposal_id" text,
	"proposal_title" text,
	"asset_address" text,
	"asset_symbol" text,
	"asset_amount" numeric(36, 18),
	"usd_amount" numeric(18, 2),
	"shares" numeric(36, 18),
	"loot" numeric(36, 18),
	"raw_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_activities" ADD CONSTRAINT "membership_activities_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_activities" ADD CONSTRAINT "membership_activities_dao_proposal_id_dao_proposals_id_fk" FOREIGN KEY ("dao_proposal_id") REFERENCES "public"."dao_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_activities_chain_tx_type_member_unique" ON "membership_activities" USING btree ("chain_id",lower("tx_hash"),"type",lower("member_address"));--> statement-breakpoint
CREATE INDEX "membership_activities_quarter_id_idx" ON "membership_activities" USING btree ("quarter_id");--> statement-breakpoint
CREATE INDEX "membership_activities_dao_proposal_id_idx" ON "membership_activities" USING btree ("dao_proposal_id");--> statement-breakpoint
CREATE INDEX "membership_activities_executed_at_idx" ON "membership_activities" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "membership_activities_type_idx" ON "membership_activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX "membership_activities_member_address_idx" ON "membership_activities" USING btree ("member_address");--> statement-breakpoint
CREATE TRIGGER "membership_activities_set_updated_at"
BEFORE UPDATE ON "membership_activities"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();
