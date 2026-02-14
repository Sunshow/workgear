# Workflow DSL and Template System

> Source of Truth — 描述 workflow DSL 和模板系统模块的行为规范

## Scenario: List workflows by project

### Given
- User is authenticated
- Project exists with ID `project-123`
- Project has 3 workflows created

### When
- Client sends `GET /api/workflows?projectId=project-123`

### Then
- Response status is `200 OK`
- Response body contains array of workflow objects
- Each workflow object includes: `id`, `name`, `projectId`, `dsl`, `createdAt`, `updatedAt`
- Workflows are ordered by `createdAt` descending

---

## Scenario: Create workflow with valid DSL

### Given
- User is authenticated
- Project exists with ID `project-123`
- Request body contains valid workflow DSL:
  ```yaml
  name: "Code Review Flow"
  variables:
    repo_url: "https://github.com/example/repo"
  nodes:
    - id: review_task
      type: agent_task
      config:
        prompt: "Review code at {{variables.repo_url}}"
  edges:
    - from: START
      to: review_task
  ```

### When
- Client sends `POST /api/workflows` with `projectId` and `dsl` in body

### Then
- Response status is `201 Created`
- Response body contains created workflow with generated `id`
- Workflow is persisted in database with `projectId` association
- DSL is stored as YAML string in `dsl` field

---

## Scenario: Validate workflow DSL with node type support

### Given
- User is authenticated
- Request body contains DSL with various node types:
  - `agent_task`: AI agent execution
  - `human_input`: User provides input
  - `human_review`: User approves/rejects/edits
  - `parallel_group`: Execute nodes in parallel
  - `conditional`: Branch based on condition
  - `integration`: External API call
  - `collab_task`: Multiple agents collaborate
  - `adjudicate`: Resolve conflicts between outputs
  - `aggregate`: Combine multiple outputs

### When
- Client sends `POST /api/workflows/validate` with `dsl` in body

### Then
- Response status is `200 OK` if DSL is valid
- Response body contains `{ valid: true, errors: [] }`
- If invalid, response status is `400 Bad Request`
- Error response includes `{ valid: false, errors: [{ path: string, message: string }] }`
- Validation checks: required fields, node type validity, edge connectivity, variable references

---

## Scenario: Update workflow DSL

### Given
- User is authenticated
- Workflow exists with ID `wf-456`
- User has permission to edit workflow
- Request body contains updated DSL with new nodes

### When
- Client sends `PUT /api/workflows/wf-456` with updated `dsl` in body

### Then
- Response status is `200 OK`
- Response body contains updated workflow object
- `updatedAt` timestamp is refreshed
- Old DSL is replaced with new DSL
- Active flow runs continue using old DSL version

---

## Scenario: Get workflow details with variable interpolation syntax

### Given
- User is authenticated
- Workflow exists with ID `wf-789`
- Workflow DSL contains variable references:
  - `{{variables.repo_url}}`: Access workflow-level variables
  - `{{nodes.review_task.outputs.result}}`: Access previous node outputs

### When
- Client sends `GET /api/workflows/wf-789`

### Then
- Response status is `200 OK`
- Response body contains complete workflow object with full DSL
- DSL preserves variable syntax without interpolation (raw template)
- Variable interpolation happens during flow execution, not at rest

---

## Scenario: Delete workflow

### Given
- User is authenticated
- Workflow exists with ID `wf-999`
- User has permission to delete workflow
- No active flow runs are using this workflow

### When
- Client sends `DELETE /api/workflows/wf-999`

### Then
- Response status is `204 No Content`
- Workflow is removed from database
- Associated flow runs remain in database for audit trail
- If active flow runs exist, response is `409 Conflict` with error message

---

## Scenario: List workflow templates and get template by slug

### Given
- System has 4 built-in workflow templates seeded in database:
  - `simple-agent-task`: Single agent execution
  - `human-in-loop`: Agent task with human review
  - `parallel-processing`: Parallel agent tasks with aggregation
  - `conditional-workflow`: Branching logic based on conditions

### When
- Client sends `GET /api/workflow-templates`
- Then client sends `GET /api/workflow-templates/by-slug/human-in-loop`

### Then
- First response status is `200 OK` with array of all templates
- Each template includes: `id`, `slug`, `name`, `description`, `dsl`, `category`
- Second response status is `200 OK` with single template object
- Template DSL can be copied and customized for new workflows
- Templates are read-only and cannot be modified via API

---

## Scenario: Frontend workflow editor with YAML and DAG preview

### Given
- User navigates to `/projects/project-123/workflows`
- User opens WorkflowEditor component
- Editor contains YAMLEditor and DAGPreview components

### When
- User types YAML DSL in YAMLEditor
- User defines nodes with types: `agent_task`, `human_review`, `parallel_group`
- User defines edges connecting nodes

### Then
- DAGPreview renders visual graph of workflow in real-time
- Nodes are displayed as boxes with type-specific icons
- Edges are displayed as arrows showing flow direction
- Syntax errors are highlighted in YAMLEditor
- Validation errors are shown below editor
- User can save workflow when DSL is valid
