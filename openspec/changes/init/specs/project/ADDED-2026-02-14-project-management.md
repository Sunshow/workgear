# Project Management

> Source of Truth — 描述项目管理模块的行为规范

## Scenario: List User's Projects

### Given
- User is authenticated

### When
- GET /api/projects with Authorization header

### Then
- Query returns projects where:
  - User is owner (projects.ownerId = userId), OR
  - User is member (exists in project_members), OR
  - Project visibility is 'public'
- Git access tokens are masked (first 4 chars + '****')
- Response: 200 with array of projects ordered by createdAt
- Each project: `{ id, name, description, gitRepoUrl, gitAccessToken (masked), visibility, ownerId, createdAt, updatedAt }`

---

## Scenario: List Public Projects (Unauthenticated)

### Given
- No authentication required

### When
- GET /api/projects/public

### Then
- Query returns all projects where visibility = 'public'
- Git access tokens are masked
- Response: 200 with array of public projects ordered by createdAt

---

## Scenario: Create Project with Default Kanban

### Given
- User is authenticated
- Project name is provided and non-empty

### When
- POST /api/projects with `{ name, description?, gitRepoUrl?, gitAccessToken?, visibility? }`

### Then
- Project is created with ownerId = userId
- Visibility defaults to 'private' if not specified
- Project member record is created with role = 'owner'
- Default kanban is auto-created with name = 'Default Board'
- Four default columns are created: 'Backlog' (pos 0), 'In Progress' (pos 1), 'Review' (pos 2), 'Done' (pos 3)
- Response: 201 with created project (git token masked)

---

## Scenario: Create Project with Missing Name

### Given
- User is authenticated
- Project name is empty or whitespace-only

### When
- POST /api/projects with empty name

### Then
- Response: 422 Unprocessable Entity with `{ error: 'Project name is required' }`
- No project is created

---

## Scenario: Get Project Details

### Given
- Project exists
- User has access (is member/owner OR project is public)

### When
- GET /api/projects/:id

### Then
- optionalAuth middleware parses JWT if present
- requireProjectAccess checks:
  - If public + GET request → allow anonymous access
  - If private → require authentication and membership
- Response: 200 with project details (git token masked)

---

## Scenario: Get Project Details - Forbidden

### Given
- Project is private
- User is not a member and not the owner

### When
- GET /api/projects/:id

### Then
- Response: 403 Forbidden with `{ error: 'Forbidden: not a project member' }`

---

## Scenario: Update Project

### Given
- User is authenticated as project owner
- Project exists

### When
- PUT /api/projects/:id with `{ name?, description?, gitRepoUrl?, gitAccessToken?, visibility? }`

### Then
- requireProjectAccess('owner') validates user has owner role
- Project fields are updated (only provided fields)
- updatedAt timestamp is set to current time
- Response: 200 with updated project (git token masked)

---

## Scenario: Update Project - Insufficient Permissions

### Given
- User is authenticated but not project owner

### When
- PUT /api/projects/:id

### Then
- Response: 403 Forbidden with `{ error: 'Forbidden: requires owner role' }`
- Project is not modified

---

## Scenario: Delete Project

### Given
- User is authenticated as project owner
- Project exists

### When
- DELETE /api/projects/:id

### Then
- requireProjectAccess('owner') validates user has owner role
- Project is deleted (cascade deletes: kanbans, columns, tasks, members, etc.)
- Response: 200 with `{ success: true }`

---

## Scenario: Frontend Project Store

### Given
- User navigates to /projects page

### When
- Projects are fetched from API

### Then
- Projects are stored in project-store (Zustand)
- Store provides: projects array, currentProject, setProjects, addProject, updateProject, removeProject
- Store maintains reactive state for UI components
