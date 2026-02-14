# Artifact Management

> Source of Truth — 描述产物管理模块的行为规范

## Scenario: List Artifacts by Task

### Given
- User is authenticated
- Task exists with taskId

### When
- GET /api/artifacts?taskId={taskId}

### Then
- Query returns all artifacts where artifact.taskId = taskId
- Artifacts are ordered by createdAt (descending, newest first)
- Response: 200 with array of artifacts
- Each artifact: `{ id, taskId, type, title, createdAt }`

---

## Scenario: List Artifacts without TaskId

### Given
- User is authenticated
- No taskId is provided in query

### When
- GET /api/artifacts

### Then
- Response: 422 Unprocessable Entity with `{ error: 'taskId is required' }`

---

## Scenario: Get Artifact Details

### Given
- User is authenticated
- Artifact exists with id

### When
- GET /api/artifacts/:id

### Then
- Artifact is fetched from database
- If not found → 404 with `{ error: 'Artifact not found' }`
- Response: 200 with artifact object `{ id, taskId, type, title, createdAt }`

---

## Scenario: Get Artifact Version History

### Given
- User is authenticated
- Artifact exists with id

### When
- GET /api/artifacts/:id/versions

### Then
- Query returns all artifact_versions where artifactId = id
- Versions are ordered by version number (descending, newest first)
- Response: 200 with array of versions
- Each version: `{ id, artifactId, version, content, changeSummary, createdBy, createdAt }`

---

## Scenario: Get Artifact Links (Relationships)

### Given
- User is authenticated
- Artifact exists with id

### When
- GET /api/artifacts/:id/links

### Then
- Query returns all artifact_links where sourceId = id
- Response: 200 with array of links
- Each link: `{ id, sourceId, targetId, linkType, createdAt }`
- linkType represents DAG relationships: 'derives_from', 'implements', 'verifies', etc.

---

## Scenario: Artifact Types

### Given
- Artifacts are created by workflow nodes or manual upload

### When
- Artifact type is specified

### Then
- Supported types include:
  - 'prd' (Product Requirements Document)
  - 'spec' (Technical Specification)
  - 'test-plan' (Test Plan)
  - 'code' (Source Code)
  - 'review-report' (Code Review Report)
  - Other custom types as needed
- Type is stored as varchar(50) in artifacts.type

---

## Scenario: Artifact Versioning

### Given
- Artifact exists
- New version is created

### When
- Version is stored in artifact_versions table

### Then
- Version number is incremented (integer)
- Unique constraint enforced on (artifactId, version)
- Each version stores: content (text), changeSummary, createdBy
- Quality scores can be stored in future (schema supports extension)

---

## Scenario: Artifact DAG Relationships

### Given
- Multiple artifacts exist in a task workflow

### When
- Artifacts are linked via artifact_links table

### Then
- Links form a Directed Acyclic Graph (DAG)
- Example relationships:
  - Spec 'derives_from' PRD
  - Code 'implements' Spec
  - Test Plan 'verifies' Code
  - Review Report 'reviews' Code
- Links enable traceability across development lifecycle

---

## Scenario: Frontend Artifacts Tab

### Given
- User opens TaskDetail panel
- Task has associated artifacts

### When
- User clicks Artifacts tab

### Then
- ArtifactsTab component fetches GET /api/artifacts?taskId={taskId}
- Artifacts are displayed with type badges and titles
- Clicking artifact shows version history via GET /api/artifacts/:id/versions
- Artifact links/relationships can be viewed via GET /api/artifacts/:id/links
- SpecArtifactViewer component renders markdown/code content
