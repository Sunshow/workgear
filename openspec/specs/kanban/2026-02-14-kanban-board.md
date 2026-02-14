# Kanban Board

> Source of Truth — 描述看板管理模块的行为规范

## Scenario: Get Project Kanbans

### Given
- User is authenticated
- Project exists with projectId

### When
- GET /api/kanbans?projectId={projectId}

### Then
- Query returns all kanbans where kanbanId = projectId
- Response: 200 with array of kanbans
- Each kanban: `{ id, projectId, name, createdAt }`

---

## Scenario: Get Kanban Columns

### Given
- User is authenticated
- Kanban exists with id

### When
- GET /api/kanbans/:id/columns

### Then
- Kanban is fetched from database
- If kanban not found → 404 with `{ error: 'Kanban not found' }`
- Columns are fetched and ordered by position (ascending)
- Response: 200 with `{ kanban, columns: [{ id, kanbanId, name, position, createdAt }] }`

---

## Scenario: List Tasks by Project

### Given
- User is authenticated
- Project exists with projectId

### When
- GET /api/tasks?projectId={projectId}

### Then
- Query returns all tasks where task.projectId = projectId
- Response: 200 with array of tasks
- Each task: `{ id, projectId, columnId, title, description, position, gitBranch, createdAt, updatedAt }`

---

## Scenario: Create Task

### Given
- User is authenticated
- Project and column exist
- Task title is non-empty

### When
- POST /api/tasks with `{ projectId, columnId, title, description? }`

### Then
- System calculates max position in target column
- New task is created with position = maxPosition + 1
- Response: 201 with created task

---

## Scenario: Create Task with Empty Title

### Given
- User is authenticated
- Task title is empty or whitespace-only

### When
- POST /api/tasks with empty title

### Then
- Response: 422 Unprocessable Entity with `{ error: 'Task title is required' }`
- No task is created

---

## Scenario: Get Task Details

### Given
- User is authenticated
- Task exists with id

### When
- GET /api/tasks/:id

### Then
- Task is fetched from database
- If not found → 404 with `{ error: 'Task not found' }`
- Response: 200 with task object

---

## Scenario: Update Task

### Given
- User is authenticated
- Task exists

### When
- PUT /api/tasks/:id with `{ title?, description?, columnId?, position?, gitBranch? }`

### Then
- Only provided fields are updated
- updatedAt timestamp is set to current time
- Response: 200 with updated task

---

## Scenario: Move Task Between Columns

### Given
- User is authenticated
- Task exists
- Target column exists

### When
- PUT /api/tasks/:id/move with `{ columnId, position }`

### Then
- Task's columnId and position are updated
- updatedAt timestamp is set to current time
- Response: 200 with updated task
- Frontend uses @dnd-kit for drag-and-drop UI

---

## Scenario: Delete Task

### Given
- User is authenticated
- Task exists

### When
- DELETE /api/tasks/:id

### Then
- Task is deleted (cascade deletes: artifacts, timeline events, flow runs, etc.)
- Response: 200 with `{ success: true }`

---

## Scenario: Get Task Timeline

### Given
- User is authenticated
- Task exists with id

### When
- GET /api/tasks/:id/timeline

### Then
- Query returns all timeline_events where taskId = id
- Events are ordered by createdAt (ascending)
- Response: 200 with array of events
- Each event: `{ id, taskId, flowRunId?, nodeRunId?, eventType, content (jsonb), createdAt }`

---

## Scenario: Frontend Kanban Board

### Given
- User navigates to /projects/:projectId/kanban

### When
- Kanban data is loaded

### Then
- kanban-store (Zustand) maintains: kanban, columns, tasks
- KanbanColumn components render each column with tasks filtered by columnId
- TaskCard components display task title, description, gitBranch
- CreateTaskDialog allows creating new tasks
- TaskDetail panel shows task details with tabs: Timeline, Artifacts, Flow, Git
- Drag-and-drop powered by @dnd-kit updates task position via PUT /api/tasks/:id/move

---

## Scenario: Kanban Default Columns

### Given
- Project is created

### When
- Default kanban is auto-created

### Then
- Four columns are created with names and positions:
  - 'Backlog' (position 0)
  - 'In Progress' (position 1)
  - 'Review' (position 2)
  - 'Done' (position 3)
- Columns are stored in kanban_columns table with unique constraint on (kanbanId, position)

---

## Scenario: Navigate from Workflows Page Back to Kanban

### Given
- User is on the workflows management page /projects/:projectId/workflows

### When
- User clicks the ArrowLeft back button in the page header

### Then
- Page navigates to /projects/:projectId/kanban
- Kanban page loads normally with the project's kanban data
- Navigation does not depend on browser history (uses explicit route)

---

## Scenario: Back Button Always Visible on Workflows Page

### Given
- User enters the workflows page /projects/:projectId/workflows via any path

### When
- Page finishes loading

### Then
- An ArrowLeft icon button is displayed on the left side of the page header, before the project name
- Button uses `variant="ghost" size="icon"` styling, consistent with the workflow editor's back button
- Button is clickable with hover visual feedback
