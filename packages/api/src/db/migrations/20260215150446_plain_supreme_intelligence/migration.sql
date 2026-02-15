ALTER TABLE "artifacts" ADD COLUMN "flow_run_id" uuid;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "node_run_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_artifacts_flow_run" ON "artifacts" ("flow_run_id");--> statement-breakpoint
CREATE INDEX "idx_artifacts_node_run" ON "artifacts" ("node_run_id");--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_flow_run_id_flow_runs_id_fkey" FOREIGN KEY ("flow_run_id") REFERENCES "flow_runs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_node_run_id_node_runs_id_fkey" FOREIGN KEY ("node_run_id") REFERENCES "node_runs"("id") ON DELETE SET NULL;