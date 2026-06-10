CREATE TABLE "dao_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dao_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"proposal_id" text NOT NULL,
	"proposal_number" text,
	"title" text NOT NULL,
	"status" text,
	"execution_tx_hash" text NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"daohaus_url" text NOT NULL,
	"raw_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD COLUMN "dao_proposal_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "dao_proposals_chain_dao_proposal_unique" ON "dao_proposals" USING btree ("chain_id",lower("dao_address"),"proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dao_proposals_chain_execution_tx_unique" ON "dao_proposals" USING btree ("chain_id",lower("execution_tx_hash"));--> statement-breakpoint
CREATE INDEX "dao_proposals_executed_at_idx" ON "dao_proposals" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX "dao_proposals_status_idx" ON "dao_proposals" USING btree ("status");--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_dao_proposal_id_dao_proposals_id_fk" FOREIGN KEY ("dao_proposal_id") REFERENCES "public"."dao_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treasury_transactions_dao_proposal_id_idx" ON "treasury_transactions" USING btree ("dao_proposal_id");--> statement-breakpoint
CREATE TRIGGER "dao_proposals_set_updated_at"
BEFORE UPDATE ON "dao_proposals"
FOR EACH ROW
EXECUTE FUNCTION "public"."set_updated_at"();
