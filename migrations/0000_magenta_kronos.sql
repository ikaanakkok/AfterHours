CREATE TABLE "auth"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_messages" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "admin_messages_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"operation_id" uuid,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"config_version" integer NOT NULL,
	"decided_by" text,
	CONSTRAINT "approvals_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"actor" jsonb NOT NULL,
	"target_id" text,
	"details" jsonb NOT NULL,
	CONSTRAINT "audit_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"title" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	CONSTRAINT "calendar_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "configurations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "configurations_tenant_id_version_unique" UNIQUE("tenant_id","version")
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'missing_info' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_error" text,
	"real_account_verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "connections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_address" text NOT NULL,
	"mode" text DEFAULT 'ai' NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_processed_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "conversations_tenant_id_connection_id_customer_address_unique" UNIQUE("tenant_id","connection_id","customer_address")
);
--> statement-breakpoint
CREATE TABLE "cron_jobs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"expression" text NOT NULL,
	"timezone" text NOT NULL,
	"workflow_id" uuid NOT NULL,
	"inputs" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_result" text,
	CONSTRAINT "cron_jobs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider_id" text,
	CONSTRAINT "drafts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid,
	"operation_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	CONSTRAINT "handoffs_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "memberships_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_id" text,
	"error" text,
	CONSTRAINT "messages_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "messages_tenant_id_connection_id_external_id_unique" UNIQUE("tenant_id","connection_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"capability" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"actor" jsonb NOT NULL,
	"connection_id" uuid,
	"workflow_id" uuid,
	"conversation_id" uuid,
	"cron_id" uuid,
	"config_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "operations_tenant_id_idempotency_key_unique" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_record_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"verified" boolean NOT NULL,
	"payment_link" text,
	"provider_id" text,
	"status" text DEFAULT 'unpaid' NOT NULL,
	CONSTRAINT "payment_records_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "payment_records_tenant_id_external_record_id_unique" UNIQUE("tenant_id","external_record_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	"base_version" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"patch" jsonb NOT NULL,
	"risk" text NOT NULL,
	"approval_id" uuid,
	CONSTRAINT "proposals_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "provider_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "provider_events_tenant_id_external_id_unique" UNIQUE("tenant_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "runtime" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "runtime_tenant_id_key_unique" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	CONSTRAINT "secrets_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "secrets_tenant_id_connection_id_unique" UNIQUE("tenant_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"input_hash" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trials_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "trials_tenant_id_workflow_id_version_input_hash_unique" UNIQUE("tenant_id","workflow_id","version","input_hash")
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"published_definition" jsonb,
	"published_version" integer,
	"status" text DEFAULT 'awaiting_test' NOT NULL,
	CONSTRAINT "workflows_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_messages" ADD CONSTRAINT "admin_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_operation_id_operations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","operation_id") REFERENCES "public"."operations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_tenant_id_workflow_id_workflows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","workflow_id") REFERENCES "public"."workflows"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_id_conversation_id_conversations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_tenant_id_operation_id_operations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","operation_id") REFERENCES "public"."operations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_conversations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenant_id_workflow_id_workflows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","workflow_id") REFERENCES "public"."workflows"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenant_id_conversation_id_conversations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenant_id_cron_id_cron_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cron_id") REFERENCES "public"."cron_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_approval_id_approvals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."approvals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime" ADD CONSTRAINT "runtime_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_tenant_id_workflow_id_workflows_tenant_id_id_fk" FOREIGN KEY ("tenant_id","workflow_id") REFERENCES "public"."workflows"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_tenant_id_operation_id_operations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","operation_id") REFERENCES "public"."operations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_connection_id_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;