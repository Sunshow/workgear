ALTER TABLE "agent_roles" ADD COLUMN "agent_type" varchar(50) DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "default_model" varchar(100);--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "is_builtin" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD COLUMN "merge_commit_sha" varchar(100);--> statement-breakpoint
ALTER TABLE "node_runs" ADD COLUMN "log_stream" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "git_merge_method" varchar(20) DEFAULT 'merge' NOT NULL;