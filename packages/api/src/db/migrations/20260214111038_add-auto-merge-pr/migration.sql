CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(100) NOT NULL UNIQUE,
	"type" varchar(50) NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" varchar(100) NOT NULL UNIQUE,
	"name" varchar(200) NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"link_type" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"artifact_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"change_summary" text,
	"created_by" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_versions_artifact_id_version_unique" UNIQUE("artifact_id","version")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"task_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"task_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"status" varchar(50) NOT NULL,
	"error" text,
	"dsl_snapshot" text,
	"variables" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kanban_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kanban_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kanban_columns_kanban_id_position_unique" UNIQUE("kanban_id","position")
);
--> statement-breakpoint
CREATE TABLE "kanbans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_run_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"node_run_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" varchar(50) NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"flow_run_id" uuid NOT NULL,
	"node_id" varchar(100) NOT NULL,
	"node_type" varchar(50),
	"node_name" varchar(200),
	"status" varchar(50) NOT NULL,
	"attempt" integer DEFAULT 1,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"locked_by" varchar(100),
	"locked_at" timestamp with time zone,
	"review_action" varchar(50),
	"review_comment" text,
	"reviewed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"recovery_checkpoint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_pk" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(200) NOT NULL,
	"description" text,
	"git_repo_url" varchar(500),
	"git_access_token" varchar(500),
	"auto_merge_pr" boolean DEFAULT false NOT NULL,
	"visibility" varchar(20) DEFAULT 'private' NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"git_branch" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"task_id" uuid NOT NULL,
	"flow_run_id" uuid,
	"node_run_id" uuid,
	"event_type" varchar(50) NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" varchar(255) NOT NULL UNIQUE,
	"name" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"slug" varchar(100) NOT NULL UNIQUE,
	"name" varchar(200) NOT NULL,
	"description" text,
	"category" varchar(50),
	"difficulty" varchar(20),
	"estimated_time" varchar(50),
	"parameters" jsonb DEFAULT '[]',
	"template" text NOT NULL,
	"is_builtin" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"project_id" uuid NOT NULL,
	"template_id" uuid,
	"name" varchar(200) NOT NULL,
	"dsl" text NOT NULL,
	"template_params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_artifact_versions_artifact_id" ON "artifact_versions" ("artifact_id");--> statement-breakpoint
CREATE INDEX "idx_flow_runs_task_id" ON "flow_runs" ("task_id");--> statement-breakpoint
CREATE INDEX "idx_node_runs_flow_run_id" ON "node_runs" ("flow_run_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_project_id" ON "tasks" ("project_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_column_id" ON "tasks" ("column_id");--> statement-breakpoint
CREATE INDEX "idx_timeline_events_task_id" ON "timeline_events" ("task_id");--> statement-breakpoint
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_source_id_artifacts_id_fkey" FOREIGN KEY ("source_id") REFERENCES "artifacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_target_id_artifacts_id_fkey" FOREIGN KEY ("target_id") REFERENCES "artifacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_task_id_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_workflow_id_workflows_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id");--> statement-breakpoint
ALTER TABLE "kanban_columns" ADD CONSTRAINT "kanban_columns_kanban_id_kanbans_id_fkey" FOREIGN KEY ("kanban_id") REFERENCES "kanbans"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "kanbans" ADD CONSTRAINT "kanbans_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "node_run_history" ADD CONSTRAINT "node_run_history_node_run_id_node_runs_id_fkey" FOREIGN KEY ("node_run_id") REFERENCES "node_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "node_runs" ADD CONSTRAINT "node_runs_flow_run_id_flow_runs_id_fkey" FOREIGN KEY ("flow_run_id") REFERENCES "flow_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_column_id_kanban_columns_id_fkey" FOREIGN KEY ("column_id") REFERENCES "kanban_columns"("id");--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_task_id_tasks_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_flow_run_id_flow_runs_id_fkey" FOREIGN KEY ("flow_run_id") REFERENCES "flow_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_node_run_id_node_runs_id_fkey" FOREIGN KEY ("node_run_id") REFERENCES "node_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_template_id_workflow_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id");