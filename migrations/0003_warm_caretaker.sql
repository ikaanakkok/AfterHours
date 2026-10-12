ALTER TABLE "cron_jobs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN "deleted_at" timestamp with time zone;