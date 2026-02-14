# Design: 流程生命周期自动移动看板任务列

## 技术方案

### 方案概述

在 Go Orchestrator 的流程引擎中，于流程生命周期关键节点（启动、完成、取消）增加数据库调用，自动更新关联任务的 `column_id`。这是一个纯后端变更，通过已有的 WebSocket 事件机制通知前端刷新。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 实现层 | Go Orchestrator（engine 层） | 流程状态变更的唯一入口，保证一致性 |
| 列匹配方式 | 按列名字符串匹配 | 默认列名固定（Backlog/In Progress/Done），简单可靠 |
| 失败策略 | warn 日志 + 静默跳过 | 移列是副作用，不应阻塞核心流程执行 |
| 前端更新 | 复用现有 WebSocket 事件 | flow.started/completed/cancelled 事件已存在，前端监听后刷新看板数据即可 |
| 列查找 SQL | 子查询 JOIN tasks→kanbans→kanban_columns | 无需额外传递 projectId，从 taskID 反查 |

### 备选方案（已排除）

- **API 层实现（Fastify 侧）**：flow-runs.ts 的 POST 路由中更新 column_id。排除原因：只能覆盖启动场景，完成/取消由 Orchestrator 触发，无法在 API 层统一处理。
- **事件驱动（Redis Pub/Sub 监听）**：API 服务监听 flow 事件后更新任务列。排除原因：引入额外的异步链路，增加复杂度和延迟，且当前架构中 API 服务未订阅 Orchestrator 事件。
- **前端轮询/乐观更新**：前端在启动流程后直接调用 move API。排除原因：前端不应承担数据一致性职责，且无法覆盖流程完成/取消场景。

---

## 数据流

### 流程启动 → 任务移至 In Progress

```
用户点击"启动流程"
    │
    ▼
POST /api/flow-runs { taskId, workflowId }
    │
    ▼
Fastify 创建 flow_runs 记录 (status=pending)
    │
    ▼
gRPC → Orchestrator.StartFlow()
    │
    ├── 解析 DSL，创建 NodeRun
    ├── 更新 FlowRun status → RUNNING
    ├── 发布 flow.started 事件
    ├── 记录 timeline
    │
    ├── ★ db.UpdateTaskColumn(taskID, "In Progress")  ← 新增
    │
    └── return nil
    │
    ▼
WebSocket 推送 flow.started 事件
    │
    ▼
前端 kanban-store 刷新任务列表 → UI 更新
```

### 流程完成 → 任务移至 Done

```
最后一个节点执行完成
    │
    ▼
advanceDAG() → AllNodesCompleted() = true
    │
    ├── 更新 FlowRun status → COMPLETED
    ├── 发布 flow.completed 事件
    ├── 记录 timeline
    │
    ├── ★ db.UpdateTaskColumn(taskID, "Done")  ← 新增
    │
    └── return nil
    │
    ▼
WebSocket 推送 flow.completed 事件
    │
    ▼
前端 kanban-store 刷新任务列表 → UI 更新
```

### 流程取消 → 任务回退至 Backlog

```
用户点击"取消流程"
    │
    ▼
PUT /api/flow-runs/:id/cancel
    │
    ▼
gRPC → Orchestrator.CancelFlow()
    │
    ├── 取消所有 pending/queued 节点
    ├── 更新 FlowRun status → CANCELLED
    ├── 发布 flow.cancelled 事件
    ├── 记录 timeline
    │
    ├── ★ db.UpdateTaskColumn(taskID, "Backlog")  ← 新增
    │
    └── return nil
```

---

## 文件变更清单

### 修改文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/orchestrator/internal/db/queries.go` | MODIFY | 新增 `UpdateTaskColumn()` 方法 |
| `packages/orchestrator/internal/engine/dag.go` | MODIFY | 在 `StartFlow()` 末尾调用移列到 In Progress |
| `packages/orchestrator/internal/engine/dag.go` | MODIFY | 在 `advanceDAG()` 流程完成分支调用移列到 Done |
| `packages/orchestrator/internal/engine/dag.go` | MODIFY | 在 `CancelFlow()` 末尾调用移列到 Backlog |

### 新增文件

无

### 删除文件

无

---

## 具体代码变更

### 1. `packages/orchestrator/internal/db/queries.go`

新增方法：

```go
// UpdateTaskColumn moves a task to the specified kanban column by column name.
// Uses a subquery to find the column ID from the task's project kanban.
// Silently does nothing if the column name doesn't exist.
func (c *Client) UpdateTaskColumn(ctx context.Context, taskID, columnName string) error {
    _, err := c.pool.Exec(ctx, `
        UPDATE tasks
        SET column_id = (
            SELECT kc.id FROM kanban_columns kc
            JOIN kanbans k ON kc.kanban_id = k.id
            JOIN tasks t ON t.project_id = k.project_id
            WHERE t.id = $1 AND kc.name = $2
            LIMIT 1
        ),
        updated_at = NOW()
        WHERE id = $1
        AND EXISTS (
            SELECT 1 FROM kanban_columns kc
            JOIN kanbans k ON kc.kanban_id = k.id
            JOIN tasks t ON t.project_id = k.project_id
            WHERE t.id = $1 AND kc.name = $2
        )
    `, taskID, columnName)
    if err != nil {
        return fmt.Errorf("update task column: %w", err)
    }
    return nil
}
```

### 2. `packages/orchestrator/internal/engine/dag.go` — StartFlow()

在 `recordTimeline` 之后、`return nil` 之前插入：

```go
// 8. Auto-move task to "In Progress" column
if err := e.db.UpdateTaskColumn(ctx, flowRun.TaskID, "In Progress"); err != nil {
    e.logger.Warnw("Failed to move task to In Progress", "task_id", flowRun.TaskID, "error", err)
}
```

### 3. `packages/orchestrator/internal/engine/dag.go` — advanceDAG()

在 `e.logger.Infow("Flow completed", ...)` 之前插入：

```go
// Auto-move task to "Done" column
if flowRun != nil {
    if err := e.db.UpdateTaskColumn(ctx, flowRun.TaskID, "Done"); err != nil {
        e.logger.Warnw("Failed to move task to Done", "task_id", flowRun.TaskID, "error", err)
    }
}
```

### 4. `packages/orchestrator/internal/engine/dag.go` — CancelFlow()

在 `recordTimeline` 之后、`return nil` 之前插入：

```go
// Auto-move task back to "Backlog" column
if err := e.db.UpdateTaskColumn(ctx, flowRun.TaskID, "Backlog"); err != nil {
    e.logger.Warnw("Failed to move task to Backlog", "task_id", flowRun.TaskID, "error", err)
}
```

---

## 前端更新策略

当前前端已通过 WebSocket 监听 `flow.started`、`flow.completed`、`flow.cancelled` 事件。需确认：

1. 事件触发时是否会重新拉取任务列表（`GET /api/tasks?projectId=...`）
2. 如果是，则无需前端改动 — 重新拉取的数据已包含更新后的 `column_id`
3. 如果否，需在事件处理器中增加 `fetchTasks()` 调用

预期情况：现有事件处理已触发数据刷新，无需额外前端改动。

---

## 测试策略

- 手动验证：创建任务 → 启动流程 → 确认任务自动移至 In Progress
- 手动验证：等待流程完成 → 确认任务自动移至 Done
- 手动验证：启动流程 → 取消流程 → 确认任务回退至 Backlog
- 手动验证：在自定义列名的看板中启动流程 → 确认移列静默失败，流程正常执行
- 手动验证：手动拖拽任务到其他列后启动流程 → 确认仍能正确移至 In Progress
