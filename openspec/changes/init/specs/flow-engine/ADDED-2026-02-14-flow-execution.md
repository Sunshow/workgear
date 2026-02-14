# Flow Execution and State Machine

> Source of Truth — 描述 flow 执行引擎和状态机模块的行为规范

## Scenario: Start flow execution from workflow

### Given
- User is authenticated
- Workflow exists with ID `wf-123`
- Task exists with ID `task-456`
- Workflow DSL defines variables and nodes
- Request body contains `{ workflowId: "wf-123", taskId: "task-456", variables: { repo_url: "https://github.com/example/repo" } }`

### When
- Client sends `POST /api/flow-runs` with workflow and task IDs

### Then
- Response status is `201 Created`
- Response body contains FlowRun object with state `PENDING`
- FlowRun includes: `id`, `workflowId`, `taskId`, `state`, `variables`, `createdAt`
- State transitions immediately to `RUNNING`
- DAG parser creates NodeRun records for all nodes in `PENDING` state
- First node(s) transition to `QUEUED` state for execution

---

## Scenario: FlowRun state machine transitions

### Given
- FlowRun exists with ID `fr-789`
- FlowRun has multiple NodeRuns in various states

### When
- Flow execution progresses through lifecycle

### Then
- State transitions follow sequence: `PENDING` → `RUNNING` → `COMPLETED`/`FAILED`/`CANCELLED`
- `RUNNING`: At least one NodeRun is active
- `COMPLETED`: All NodeRuns reached `COMPLETED` state
- `FAILED`: Any NodeRun reached `FAILED` state and cannot retry
- `CANCELLED`: User explicitly cancelled via API
- State is persisted in database after each transition
- System survives crashes and resumes from last persisted state

---

## Scenario: NodeRun state machine with human interaction

### Given
- FlowRun is `RUNNING`
- NodeRun exists with ID `nr-111` and type `human_review`
- Agent task completed and produced output

### When
- NodeRun progresses through execution lifecycle

### Then
- State transitions: `PENDING` → `QUEUED` → `RUNNING` → `WAITING_HUMAN`
- `PENDING`: Node created but not ready (waiting for dependencies)
- `QUEUED`: Dependencies met, ready for execution
- `RUNNING`: Actively executing (agent processing or waiting for human)
- `WAITING_HUMAN`: Paused for human input or review
- `COMPLETED`: Successfully finished
- `FAILED`: Execution error occurred
- `REJECTED`: Human reviewer rejected output
- Each state change is recorded in `node_run_history` table

---

## Scenario: Submit human review with rejection and feedback loop

### Given
- NodeRun exists with ID `nr-222` in `WAITING_HUMAN` state
- NodeRun type is `human_review`
- DSL defines `on_reject.goto: "review_task"` for feedback loop
- User reviews agent output

### When
- Client sends `POST /api/node-runs/nr-222/review` with `{ action: "reject", feedback: "Please add more details" }`

### Then
- Response status is `200 OK`
- NodeRun state transitions to `REJECTED`
- Entry added to `node_run_history` with rejection details
- DAG engine evaluates `on_reject.goto` configuration
- Target node `review_task` is reset to `QUEUED` state
- Feedback is passed to target node as input variable
- Flow continues execution from target node
- If action is `approve`, NodeRun transitions to `COMPLETED` and flow advances
- If action is `edit`, user-provided edits replace agent output before completion

---

## Scenario: Submit human input for human_input node

### Given
- NodeRun exists with ID `nr-333` in `WAITING_HUMAN` state
- NodeRun type is `human_input`
- Node config defines expected input fields: `{ fields: [{ name: "priority", type: "select" }] }`

### When
- Client sends `POST /api/node-runs/nr-333/submit` with `{ inputs: { priority: "high" } }`

### Then
- Response status is `200 OK`
- NodeRun state transitions to `COMPLETED`
- Input data is stored in NodeRun `outputs` field
- Downstream nodes can reference via `{{nodes.nr-333.outputs.priority}}`
- Flow execution advances to next nodes in DAG

---

## Scenario: Retry failed node with history tracking

### Given
- NodeRun exists with ID `nr-444` in `FAILED` state
- NodeRun failed due to temporary error (API timeout)
- `node_run_history` contains failure record
- User has permission to retry

### When
- Client sends `POST /api/node-runs/nr-444/retry`

### Then
- Response status is `200 OK`
- NodeRun state resets to `QUEUED`
- New entry added to `node_run_history` with retry attempt number
- Previous failure details preserved in history
- Node re-executes with same inputs
- If retry succeeds, state transitions to `COMPLETED`
- If retry fails again, failure count increments in history

---

## Scenario: Cancel running flow execution

### Given
- FlowRun exists with ID `fr-555` in `RUNNING` state
- Multiple NodeRuns are in `RUNNING` and `QUEUED` states
- User has permission to cancel flow

### When
- Client sends `PUT /api/flow-runs/fr-555/cancel`

### Then
- Response status is `200 OK`
- FlowRun state transitions to `CANCELLED`
- All `RUNNING` NodeRuns are interrupted and marked `CANCELLED`
- All `QUEUED` and `PENDING` NodeRuns are marked `CANCELLED`
- `COMPLETED` NodeRuns remain unchanged
- Cancellation timestamp recorded in database
- Flow cannot be resumed after cancellation

---

## Scenario: List flow runs and get execution details

### Given
- Task exists with ID `task-789`
- Task has 5 flow runs with various states
- User is authenticated

### When
- Client sends `GET /api/flow-runs?taskId=task-789`
- Then client sends `GET /api/flow-runs/fr-555`
- Then client sends `GET /api/flow-runs/fr-555/nodes`
- Then client sends `GET /api/node-runs/nr-111`

### Then
- First response status is `200 OK` with array of FlowRun objects
- FlowRuns ordered by `createdAt` descending
- Second response status is `200 OK` with single FlowRun details
- Third response status is `200 OK` with array of NodeRun objects for flow
- NodeRuns include: `id`, `flowRunId`, `nodeId`, `state`, `inputs`, `outputs`, `startedAt`, `completedAt`
- Fourth response status is `200 OK` with single NodeRun details including full history
- NodeRun history shows all state transitions, retries, and rejections

---

## Scenario: Frontend flow execution visualization in TaskDetail

### Given
- User navigates to task detail page
- User clicks "Flow" tab
- FlowRun exists with multiple NodeRuns in progress

### When
- Frontend loads flow execution data
- Component renders DAG visualization with node states

### Then
- Each node displays current state with color coding:
  - `PENDING`: Gray
  - `QUEUED`: Yellow
  - `RUNNING`: Blue (animated)
  - `WAITING_HUMAN`: Orange (requires action)
  - `COMPLETED`: Green
  - `FAILED`: Red
  - `REJECTED`: Purple
  - `CANCELLED`: Gray strikethrough
- User can click nodes to view inputs/outputs
- User can submit reviews/inputs for `WAITING_HUMAN` nodes
- User can retry `FAILED` nodes
- User can cancel running flow
- Real-time updates via polling or WebSocket
- Progress bar shows overall completion percentage
