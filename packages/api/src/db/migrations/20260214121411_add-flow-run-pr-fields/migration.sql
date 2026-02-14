ALTER TABLE "flow_runs" ADD COLUMN "branch_name" varchar(200);--> statement-breakpoint
ALTER TABLE "flow_runs" ADD COLUMN "pr_url" varchar(500);--> statement-breakpoint
ALTER TABLE "flow_runs" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD COLUMN "pr_merged_at" timestamp with time zone;