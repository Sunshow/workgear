# Agent Orchestration

> Source of Truth — 描述 Agent 系统的行为规范

## Scenario: Agent adapter 2-layer architecture

### Given
- System has TypeAdapter (semantic layer) and Executor (runtime layer)
- ClaudeCodeAdapter implements TypeAdapter interface
- DockerExecutor implements Executor interface
- CombinedAdapter bridges TypeAdapter + Executor into unified Adapter interface

### When
- Worker calls adapter.Execute() with AgentRequest

### Then
- CombinedAdapter calls typeAdapter.BuildRequest() to construct ExecutorRequest
- CombinedAdapter calls executor.Execute() to run container
- CombinedAdapter calls typeAdapter.ParseResponse() to parse output
- Returns AgentResponse with output map and execution metrics

---

## Scenario: Agent registry and role mapping

### Given
- Registry maintains adapters map (name → Adapter)
- Registry maintains roles map (role → adapter name)
- Roles include: requirement-analyst, code-reviewer, spec-writer, opsx-planner, opsx-applier

### When
- Worker calls registry.GetAdapter(role)

### Then
- Registry looks up adapter name by role
- Registry returns corresponding Adapter instance
- If role not found, returns NoAdapterError

---

## Scenario: ClaudeCode agent execution flow

### Given
- Node run status is QUEUED in database
- Agent role is mapped to "claude-code" adapter
- ANTHROPIC_API_KEY environment variable is set
- Docker daemon is available

### When
- Worker polls database and acquires node run
- Worker calls registry.GetAdapter(role).Execute()

### Then
- TypeAdapter builds prompt from role + task + context + feedback
- TypeAdapter creates ExecutorRequest with env vars (AGENT_PROMPT, AGENT_MODE, ANTHROPIC_API_KEY, GIT_REPO_URL, GIT_BRANCH)
- DockerExecutor pulls image "workgear/agent-claude:latest" if not exists
- DockerExecutor creates container with environment variables
- Container executes: git clone → run claude CLI → git push → output JSON to stdout
- DockerExecutor collects stdout/stderr and exit code
- TypeAdapter parses JSON output (ClaudeOutput format)
- Worker saves output to node_runs.output
- Worker marks node run as COMPLETED
- Worker publishes node.completed event
- Worker advances DAG to queue dependent nodes

---

## Scenario: Auto-fallback to Mock adapter

### Given
- Agent role is mapped to "claude-code" adapter
- Docker daemon is unavailable OR ANTHROPIC_API_KEY is not set

### When
- DockerExecutor.Execute() fails with connection error
- OR ClaudeCodeAdapter.BuildRequest() detects missing API key

### Then
- System catches error during adapter initialization
- System registers MockAdapter as fallback
- MockAdapter returns synthetic output without actual execution
- Node run completes with mock data
- System logs warning about fallback mode

---

## Scenario: Agent configuration via environment variables

### Given
- System reads configuration from environment on startup

### When
- ANTHROPIC_API_KEY is set to API key value
- ANTHROPIC_BASE_URL is set to custom endpoint (optional)
- AGENT_DOCKER_IMAGE is set to custom image name (optional)

### Then
- ClaudeCodeAdapter passes ANTHROPIC_API_KEY to container env
- ClaudeCodeAdapter passes ANTHROPIC_BASE_URL to container env if set
- DockerExecutor uses AGENT_DOCKER_IMAGE as default image if set
- Otherwise uses "workgear/agent-claude:latest"

---

## Scenario: Multi-agent collaboration modes

### Given
- Workflow node has collaboration_mode field
- Supported modes: parallel_draft, lead_review, debate

### When
- Node type is "agent" with collaboration_mode = "parallel_draft"
- Node config specifies multiple agent roles

### Then
- System spawns multiple node runs in parallel
- Each node run executes with different agent role
- All outputs are collected when all complete
- Adjudication step selects best output based on rubric scoring
- Selected output becomes final node output
- DAG advances with winning output

---

## Scenario: OpenSpec opsx_plan and opsx_apply modes

### Given
- Node mode is "opsx_plan" or "opsx_apply"
- Node config includes OpsxConfig with change_name, schema, init_if_missing, action

### When
- ClaudeCodeAdapter.BuildRequest() processes opsx mode

### Then
- TypeAdapter sets OPSX_CHANGE_NAME env var to change_name value
- TypeAdapter sets OPSX_SCHEMA env var to schema value if provided
- TypeAdapter sets OPSX_INIT_IF_MISSING env var to boolean string
- TypeAdapter sets OPSX_ACTION env var to action value if provided
- Container executes OpenSpec CLI with these parameters
- Output includes plan or apply result in JSON format

---

## Scenario: Agent execution metrics tracking

### Given
- ClaudeCode container outputs JSON with tokens_in, tokens_out, duration_ms

### When
- TypeAdapter.ParseResponse() parses ClaudeOutput

### Then
- AgentResponse.Metrics contains TokenInput from tokens_in
- AgentResponse.Metrics contains TokenOutput from tokens_out
- AgentResponse.Metrics contains DurationMs from duration_ms
- Metrics are saved to node_runs.metrics JSONB column
- Metrics are available for cost tracking and performance analysis
