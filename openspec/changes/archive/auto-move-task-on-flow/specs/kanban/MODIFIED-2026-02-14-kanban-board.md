# Delta Spec: 看板任务随流程状态自动移列

> **Type:** MODIFIED
> **Module:** kanban
> **Date:** 2026-02-14
> **Change:** auto-move-task-on-flow

## 概述

修改看板模块行为规范，新增流程生命周期事件触发任务自动移列的场景。

---

## 场景

### Scenario 1: 流程启动时任务自动移至 In Progress

```gherkin
Given 任务存在于看板的 "Backlog" 列
  And 任务关联了一个工作流
When 用户为该任务启动流程（POST /api/flow-runs）
  And Orchestrator 成功将 FlowRun 状态设为 RUNNING
Then 任务的 column_id 自动更新为 "In Progress" 列的 ID
  And 任务在看板 UI 上从 Backlog 移动到 In Progress
  And 移动操作不阻塞流程执行（失败时仅记录警告日志）
```

### Scenario 2: 流程完成时任务自动移至 Done

```gherkin
Given 任务存在于看板的 "In Progress" 列
  And 任务关联的 FlowRun 正在执行中
When FlowRun 的所有节点执行完成
  And Orchestrator 将 FlowRun 状态设为 COMPLETED
Then 任务的 column_id 自动更新为 "Done" 列的 ID
  And 任务在看板 UI 上从 In Progress 移动到 Done
```

### Scenario 3: 流程取消时任务回退至 Backlog

```gherkin
Given 任务存在于看板的 "In Progress" 列
  And 任务关联的 FlowRun 正在执行中
When 用户取消流程执行（PUT /api/flow-runs/:id/cancel）
  And Orchestrator 将 FlowRun 状态设为 CANCELLED
Then 任务的 column_id 自动更新为 "Backlog" 列的 ID
  And 任务在看板 UI 上从 In Progress 回退到 Backlog
```

### Scenario 4: 流程失败时任务保持在 In Progress

```gherkin
Given 任务存在于看板的 "In Progress" 列
  And 任务关联的 FlowRun 正在执行中
When FlowRun 中某个节点执行失败
  And Orchestrator 将 FlowRun 状态设为 FAILED
Then 任务的 column_id 保持不变（仍在 "In Progress"）
  And 用户可手动拖拽任务到其他列或重试流程
```

### Scenario 5: 任务不在预期列时仍可自动移动

```gherkin
Given 任务存在于看板的任意列（用户可能手动拖拽过）
When 流程状态变更触发自动移列逻辑
Then 无论任务当前在哪一列，都强制移动到目标列
  And 移动操作基于列名匹配，不依赖任务当前位置
```

### Scenario 6: 目标列不存在时静默跳过

```gherkin
Given 项目的看板列被用户自定义修改
  And 目标列名（如 "In Progress"）不存在
When 流程状态变更触发自动移列逻辑
Then 移列操作静默失败，不抛出异常
  And Orchestrator 记录 warn 级别日志
  And 流程执行不受影响，继续正常运行
```

---

## 自动移列规则汇总

| 流程事件 | 目标列 | 触发位置 |
|----------|--------|----------|
| flow.started | In Progress | `StartFlow()` |
| flow.completed | Done | `advanceDAG()` |
| flow.cancelled | Backlog | `CancelFlow()` |
| flow.failed | （不移动） | — |
