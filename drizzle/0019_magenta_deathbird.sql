CREATE TABLE "machine_api_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_api_request_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"agent_address" text NOT NULL,
	"delegator_address" text NOT NULL,
	"quarter_id" uuid,
	"report_slice" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machine_api_request_nonces" ADD CONSTRAINT "machine_api_request_nonces_quarter_id_quarters_id_fk" FOREIGN KEY ("quarter_id") REFERENCES "public"."quarters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_api_rate_limits_reset_at_idx" ON "machine_api_rate_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "machine_api_request_nonces_agent_idx" ON "machine_api_request_nonces" USING btree (lower("agent_address"));--> statement-breakpoint
CREATE INDEX "machine_api_request_nonces_delegator_idx" ON "machine_api_request_nonces" USING btree (lower("delegator_address"));--> statement-breakpoint
CREATE INDEX "machine_api_request_nonces_expires_at_idx" ON "machine_api_request_nonces" USING btree ("expires_at");