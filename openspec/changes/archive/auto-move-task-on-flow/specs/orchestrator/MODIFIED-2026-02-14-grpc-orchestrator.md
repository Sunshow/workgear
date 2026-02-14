# Delta Spec: Orchestrator 数据库层新增任务移列方法

> **Type:** MODIFIED
> **Module:** orchestrator
> **Date:** 2026-02-14
> **Change:** auto-move-task-on-flow

## 概述

修改 Go Orchestrator 的数据库查询层，新增 `UpdateTaskColumn` 方法，供流程引擎在状态变更时调用。

---

## 场景

### Scenario 1: UpdateTaskColumn 成功更新任务列

```gherkin
Given 数据库中存在 task（id="task-1", project_id="proj-1"）
  And 项目 proj-1 有看板，看板包含列 "In Progress"（id="col-2"）
When 调用 UpdateTaskColumn(ctx, "task-1", "In Progress")
Then tasks 表中 task-1 的 column_id 更新为 "col-2"
  And tasks 表中 task-1 的 updated_at 更新为当前时间
  And 方法返回 nil（无错误）
```

### Scenario 2: 目标列名不存在时静默无操作

```gherkin
Given 数据库中存在 task（id="task-1", project_id="proj-1"）
  And 项目 proj-1 的看板中不存在名为 "NonExistent" 的列
When 调用 UpdateTaskColumn(ctx, "task-1", "NonExistent")
Then UPDATE 语句执行成功但影响 0 行
  And 方法返回 nil（无错误，不视为失败）
  And task-1 的 column_id 保持不变
```

### Scenario 3: 任务不存在时静默无操作

```gherkin
Given 数据库中不存在 id="task-999" 的任务
When 调用 UpdateTaskColumn(ctx, "task-999", "In Progress")
Then UPDATE 语句执行成功但影响 0 行
  And 方法返回 nil（无错误）
```

---

## 方法签名

```go
func (c *Client) UpdateTaskColumn(ctx context.Context, taskID, columnName string) error
```

## SQL 实现规格

```sql
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
```

注意：使用 `EXISTS` 子句确保目标列存在时才执行更新，避免将 column_id 设为 NULL。
