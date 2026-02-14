# gRPC Orchestrator

> Source of Truth — 描述 Go gRPC 编排服务的行为规范

## Scenario: gRPC server initialization and service registration

### Given
- Protobuf definition at packages/shared/proto/orchestrator.proto
- Go server implementation at packages/orchestrator/internal/grpc/server.go

### When
- Orchestrator service starts

### Then
- gRPC server listens on port 50051
- Registers OrchestratorService with methods: StartFlow, CancelFlow, ApproveNode, RejectNode, EditNode, SubmitHumanInput, RetryNode, EventStream
- Registers grpc.health.v1.Health service for health checks
- Initializes FlowExecutor with DB client, event bus, agent registry
- Starts worker polling loop
- Logs "gRPC server listening on :50051"

---

## Scenario: StartFlow creates flow run and initializes DAG

### Given
- Client has flow_run_id, workflow_dsl, variables, task_id, workflow_id

### When
- Client calls StartFlow(StartFlowRequest)

### Then
- Server parses workflow_dsl YAML into DAG structure
- Server creates flow_run record with status RUNNING
- Server identifies entry nodes (nodes with no dependencies)
- Server creates node_run records for entry nodes with status QUEUED
- Server publishes flow.started event to event bus
- Server responds with StartFlowResponse { success: true }
- Worker loop picks up QUEUED node runs for execution

---

## Scenario: Persistent state machine with DB-driven worker polling

### Given
- FlowExecutor runs worker loop with worker_id
- Database contains node_runs with status QUEUED

### When
- Worker loop calls db.AcquireNextNodeRun(ctx, worker_id)

### Then
- Database transaction selects oldest QUEUED node_run with FOR UPDATE SKIP LOCKED
- Database updates node_run status to RUNNING and sets worker_id
- Database commits transaction
- Worker receives node_run or nil if no work available
- If nil, worker sleeps 500ms and retries
- If node_run acquired, worker publishes node.started event
- Worker calls executeNode() to process node

---

## Scenario: DAG parsing and node advancement

### Given
- Flow run has completed node with node_id "step-1"
- DAG defines node "step-2" with depends_on: ["step-1"]

### When
- Worker completes node "step-1" and calls advanceDAG()

### Then
- Engine queries all nodes that depend on "step-1"
- For each dependent node, checks if all dependencies are COMPLETED
- If all dependencies satisfied, creates node_run with status QUEUED
- If dependencies not satisfied, skips node
- Publishes node.queued event for newly queued nodes
- If no more nodes to queue and all nodes completed, marks flow_run as COMPLETED
- Publishes flow.completed event

---

## Scenario: ApproveNode human action

### Given
- Node run has status WAITING_HUMAN with node_type "human_review"
- Human reviewer inspects node output

### When
- Client calls ApproveNode(ApproveNodeRequest { node_run_id })

### Then
- Server calls executor.HandleApprove(ctx, node_run_id)
- Executor updates node_run status to COMPLETED
- Executor publishes node.completed event
- Executor calls advanceDAG() to queue dependent nodes
- Server responds with NodeActionResponse { success: true }

---

## Scenario: RejectNode with feedback triggers retry

### Given
- Node run has status WAITING_HUMAN
- Human reviewer rejects output with feedback

### When
- Client calls RejectNode(RejectNodeRequest { node_run_id, feedback })

### Then
- Server calls executor.HandleReject(ctx, node_run_id, feedback)
- Executor updates node_run status to REJECTED
- Executor stores feedback in node_run.feedback field
- Executor publishes node.rejected event
- Executor creates new node_run for same node_id with status QUEUED
- New node_run includes previous feedback in context
- Worker picks up new node_run and retries with feedback
- Server responds with NodeActionResponse { success: true }

---

## Scenario: EventStream server-side streaming

### Given
- Client wants real-time updates for flow_run_id "flow-123"

### When
- Client calls EventStream(EventStreamRequest { flow_run_id: "flow-123" })

### Then
- Server subscribes to event bus channel "flow-run:flow-123"
- Server creates buffered channel with capacity 100
- Server enters streaming loop
- When event published to bus, server sends ServerEvent to client stream
- ServerEvent contains: event_type, flow_run_id, node_run_id, node_id, data_json, timestamp
- If client disconnects, server unsubscribes and closes channel
- If channel full (client too slow), server drops event and logs warning

---

## Scenario: Idempotency prevents duplicate execution

### Given
- Flow run with flow_run_id "flow-123" already exists with status RUNNING
- Client retries StartFlow due to network timeout

### When
- Client calls StartFlow(StartFlowRequest { flow_run_id: "flow-123" })

### Then
- Server queries flow_runs by flow_run_id
- Server detects existing flow run
- Server responds with StartFlowResponse { success: true } without creating duplicate
- Existing flow execution continues unaffected
- No duplicate node runs created

---

## Scenario: Checkpoint-based crash recovery

### Given
- Orchestrator crashes while node runs have status RUNNING
- Node runs have worker_id set to dead worker

### When
- New orchestrator instance starts
- FlowExecutor.Start() calls db.ResetStaleRunningNodes()

### Then
- Database queries node_runs with status RUNNING and updated_at older than 5 minutes
- Database updates stale node_runs status back to QUEUED
- Database clears worker_id field
- Database returns count of recovered nodes
- Executor logs "Recovered stale running nodes, count: N"
- Worker loop picks up recovered nodes for re-execution
- Flow execution resumes from checkpoint

---

## Scenario: UpdateTaskColumn 成功更新任务列

### Given
- 数据库中存在 task（id="task-1", project_id="proj-1"）
- 项目 proj-1 有看板，看板包含列 "In Progress"（id="col-2"）

### When
- 调用 UpdateTaskColumn(ctx, "task-1", "In Progress")

### Then
- tasks 表中 task-1 的 column_id 更新为 "col-2"
- tasks 表中 task-1 的 updated_at 更新为当前时间
- 方法返回 nil（无错误）

---

## Scenario: 目标列名不存在时静默无操作

### Given
- 数据库中存在 task（id="task-1", project_id="proj-1"）
- 项目 proj-1 的看板中不存在名为 "NonExistent" 的列

### When
- 调用 UpdateTaskColumn(ctx, "task-1", "NonExistent")

### Then
- UPDATE 语句执行成功但影响 0 行
- 方法返回 nil（无错误，不视为失败）
- task-1 的 column_id 保持不变

---

## Scenario: 任务不存在时静默无操作

### Given
- 数据库中不存在 id="task-999" 的任务

### When
- 调用 UpdateTaskColumn(ctx, "task-999", "In Progress")

### Then
- UPDATE 语句执行成功但影响 0 行
- 方法返回 nil（无错误）

---

## UpdateTaskColumn 方法签名

```go
func (c *Client) UpdateTaskColumn(ctx context.Context, taskID, columnName string) error
```

## UpdateTaskColumn SQL 实现规格

```sql
UPDATE tasks
SET column_id = (
    SELECT kc.id FROM kanban_columns kc
    JOIN kanbans k ON kc.kanban_id = k.id
    WHERE k.project_id = tasks.project_id AND kc.name = $2
    LIMIT 1
),
updated_at = NOW()
WHERE id = $1
AND EXISTS (
    SELECT 1 FROM kanban_columns kc
    JOIN kanbans k ON kc.kanban_id = k.id
    WHERE k.project_id = tasks.project_id AND kc.name = $2
)
```

注意：使用 `EXISTS` 子句确保目标列存在时才执行更新，避免将 column_id 设为 NULL。
