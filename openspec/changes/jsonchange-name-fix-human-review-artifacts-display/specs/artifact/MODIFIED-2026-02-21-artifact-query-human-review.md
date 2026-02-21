# Artifact Query for Human Review Scenarios

> Delta Spec — 修改产物查询逻辑以支持人工审核场景

## Scenario: Query Artifacts for Human Review Task

### Given
- User is authenticated
- A HumanReview node exists in a workflow
- The node has created a task with taskId
- Artifacts are associated with the task (e.g., PRD, Spec, Code to review)

### When
- GET /api/artifacts?taskId={taskId}

### Then
- Query returns all artifacts where artifact.taskId = taskId
- Artifacts include those created by upstream workflow nodes
- Artifacts are ordered by createdAt (descending, newest first)
- Response: 200 with array of artifacts
- Each artifact: `{ id, taskId, type, title, content, createdAt }`
- **MODIFIED**: Ensure content field is included in response for preview

---

## Scenario: Filter Artifacts by Type for Review

### Given
- User is authenticated
- Task has multiple artifacts of different types
- User wants to filter by specific artifact types

### When
- GET /api/artifacts?taskId={taskId}&types=prd,spec,code

### Then
- Query returns only artifacts matching the specified types
- Multiple types are supported via comma-separated list
- Response: 200 with filtered array of artifacts
- **ADDED**: Support types query parameter for filtering

---

## Scenario: Query Artifacts with Empty Result

### Given
- User is authenticated
- Task exists but has no associated artifacts

### When
- GET /api/artifacts?taskId={taskId}

### Then
- Response: 200 with empty array `[]`
- **MODIFIED**: Return empty array instead of error for better UX
- Frontend should display "No artifacts to review" message

---

## Scenario: Include Artifact Metadata for Review

### Given
- User is authenticated
- Artifacts exist for a human review task

### When
- GET /api/artifacts?taskId={taskId}

### Then
- Each artifact includes metadata for review context:
  - `id`: Artifact unique identifier
  - `taskId`: Associated task ID
  - `type`: Artifact type (prd, spec, code, etc.)
  - `title`: Artifact title/name
  - `content`: Full artifact content (text/markdown/code)
  - `createdAt`: Creation timestamp
  - `createdBy`: Creator user ID (if available)
- **ADDED**: Include createdBy field for audit trail

---

## Scenario: Query Artifacts with Version Information

### Given
- User is authenticated
- Artifacts have multiple versions

### When
- GET /api/artifacts?taskId={taskId}&includeVersions=true

### Then
- Each artifact includes latest version information
- Response includes: `{ id, taskId, type, title, content, createdAt, latestVersion }`
- `latestVersion`: `{ version, changeSummary, createdAt }`
- **ADDED**: Support includeVersions query parameter for detailed view

---

## Scenario: Handle Invalid TaskId

### Given
- User is authenticated
- TaskId does not exist in database

### When
- GET /api/artifacts?taskId={invalidTaskId}

### Then
- Response: 200 with empty array `[]`
- **MODIFIED**: Return empty array instead of 404 for consistency
- Log warning for monitoring purposes
