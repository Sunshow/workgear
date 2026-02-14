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

---

## Scenario: 流程启动时任务自动移至 In Progress

### Given
- 任务存在于看板的 "Backlog" 列
- 任务关联了一个工作流

### When
- 用户为该任务启动流程（POST /api/flow-runs）
- Orchestrator 成功将 FlowRun 状态设为 RUNNING

### Then
- 任务的 column_id 自动更新为 "In Progress" 列的 ID
- 任务在看板 UI 上从 Backlog 移动到 In Progress
- 移动操作不阻塞流程执行（失败时仅记录警告日志）

---

## Scenario: 流程完成时任务自动移至 Done

### Given
- 任务存在于看板的 "In Progress" 列
- 任务关联的 FlowRun 正在执行中

### When
- FlowRun 的所有节点执行完成
- Orchestrator 将 FlowRun 状态设为 COMPLETED

### Then
- 任务的 column_id 自动更新为 "Done" 列的 ID
- 任务在看板 UI 上从 In Progress 移动到 Done

---

## Scenario: 流程取消时任务回退至 Backlog

### Given
- 任务存在于看板的 "In Progress" 列
- 任务关联的 FlowRun 正在执行中

### When
- 用户取消流程执行（PUT /api/flow-runs/:id/cancel）
- Orchestrator 将 FlowRun 状态设为 CANCELLED

### Then
- 任务的 column_id 自动更新为 "Backlog" 列的 ID
- 任务在看板 UI 上从 In Progress 回退到 Backlog

---

## Scenario: 流程失败时任务保持在 In Progress

### Given
- 任务存在于看板的 "In Progress" 列
- 任务关联的 FlowRun 正在执行中

### When
- FlowRun 中某个节点执行失败
- Orchestrator 将 FlowRun 状态设为 FAILED

### Then
- 任务的 column_id 保持不变（仍在 "In Progress"）
- 用户可手动拖拽任务到其他列或重试流程

---

## Scenario: 任务不在预期列时仍可自动移动

### Given
- 任务存在于看板的任意列（用户可能手动拖拽过）

### When
- 流程状态变更触发自动移列逻辑

### Then
- 无论任务当前在哪一列，都强制移动到目标列
- 移动操作基于列名匹配，不依赖任务当前位置

---

## Scenario: 目标列不存在时静默跳过

### Given
- 项目的看板列被用户自定义修改
- 目标列名（如 "In Progress"）不存在

### When
- 流程状态变更触发自动移列逻辑

### Then
- 移列操作静默失败，不抛出异常
- Orchestrator 记录 warn 级别日志
- 流程执行不受影响，继续正常运行

---

## 自动移列规则汇总

| 流程事件 | 目标列 | 触发位置 |
|----------|--------|----------|
| flow.started | In Progress | `StartFlow()` |
| flow.completed | Done | `advanceDAG()` |
| flow.cancelled | Backlog | `CancelFlow()` |
| flow.failed | （不移动） | — |
