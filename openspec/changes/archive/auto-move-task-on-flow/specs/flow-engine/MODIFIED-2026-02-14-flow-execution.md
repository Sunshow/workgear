# Delta Spec: 流程状态变更触发看板任务移列

> **Type:** MODIFIED
> **Module:** flow-engine
> **Date:** 2026-02-14
> **Change:** auto-move-task-on-flow

## 概述

修改流程执行引擎行为规范，在流程生命周期关键节点增加看板任务自动移列的副作用。

---

## 场景

### Scenario 1: StartFlow 成功后移动任务到 In Progress

```gherkin
Given FlowRun 已创建，状态为 PENDING
  And FlowRun 关联的 Task 存在且有有效的 project_id
When StartFlow() 成功完成以下步骤：
  - 解析 DSL
  - 创建所有 NodeRun
  - 将 FlowRun 状态更新为 RUNNING
  - 发布 flow.started 事件
  - 记录 timeline
Then 在 return 之前调用 UpdateTaskColumn(taskID, "In Progress")
  And 如果 UpdateTaskColumn 失败，记录 warn 日志但不返回错误
  And 流程执行正常继续
```

### Scenario 2: 所有节点完成后移动任务到 Done

```gherkin
Given FlowRun 状态为 RUNNING
  And advanceDAG() 检测到所有节点已完成
When FlowRun 状态更新为 COMPLETED
  And flow.completed 事件已发布
Then 调用 UpdateTaskColumn(taskID, "Done")
  And 如果 UpdateTaskColumn 失败，记录 warn 日志但不影响流程完成状态
```

### Scenario 3: 流程取消后回退任务到 Backlog

```gherkin
Given FlowRun 状态为 RUNNING
  And 用户请求取消流程
When CancelFlow() 成功将 FlowRun 状态更新为 CANCELLED
  And flow.cancelled 事件已发布
Then 调用 UpdateTaskColumn(taskID, "Backlog")
  And 如果 UpdateTaskColumn 失败，记录 warn 日志但不影响取消操作
```

### Scenario 4: UpdateTaskColumn 数据库查询逻辑

```gherkin
Given 需要将 taskID 对应的任务移动到名为 columnName 的列
When 执行 UpdateTaskColumn(taskID, columnName)
Then 通过子查询查找目标列：
  - 从 tasks 表获取 task 的 project_id
  - 从 kanbans 表找到该 project 的看板
  - 从 kanban_columns 表找到名称匹配的列
  And 更新 tasks.column_id 为目标列 ID
  And 更新 tasks.updated_at 为当前时间
  And 如果子查询未找到匹配列，UPDATE 影响 0 行（静默无操作）
```
