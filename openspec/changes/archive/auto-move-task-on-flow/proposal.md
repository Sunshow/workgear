# Proposal: 流程启动/完成时自动移动看板任务列

## 背景（Why）

当前用户在看板中为任务启动工作流后，任务卡片始终停留在 Backlog 列，不会随流程状态自动移动到 In Progress 或 Done 列。用户必须手动拖拽任务卡片来反映实际工作状态，这违背了看板-流程集成的核心设计意图。

### 用户痛点

- 启动流程后任务仍在 Backlog，看板无法反映真实工作状态
- 流程完成后任务不会自动归档到 Done，用户需手动拖拽
- 看板失去了作为项目进度可视化工具的核心价值
- 团队成员无法通过看板快速了解哪些任务正在执行中

### 根因分析

Go Orchestrator 的 `StartFlow()` 和 `advanceDAG()` 函数中，流程状态变更时只更新了 `flow_runs` 表的 status，发布了事件并记录了 timeline，但**完全缺失了更新 `tasks.column_id` 的逻辑**。数据库层面也没有提供 `UpdateTaskColumn` 方法。

## 目标（What）

实现流程生命周期与看板列的自动联动：

| 流程事件 | 任务自动移动到 |
|----------|---------------|
| 流程启动（flow.started） | In Progress |
| 流程完成（flow.completed） | Done |
| 流程取消（flow.cancelled） | Backlog（回退） |
| 流程失败（flow.failed） | In Progress（保持，等待人工处理） |

### 具体方案

1. 在 Orchestrator 的 `db/queries.go` 中新增 `UpdateTaskColumn()` 方法，通过列名查找目标 column_id 并更新任务
2. 在 `StartFlow()` 中流程启动后调用，将任务移至 In Progress
3. 在 `advanceDAG()` 中流程完成后调用，将任务移至 Done
4. 在 `CancelFlow()` 中流程取消后调用，将任务回退至 Backlog
5. 前端通过现有 WebSocket 事件刷新看板数据，实现实时 UI 更新

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| orchestrator | 代码变更 | `db/queries.go` 新增方法，`engine/dag.go` 调用自动移列 |
| kanban | Spec 更新 | 补充流程联动自动移列的行为规范 |
| flow-engine | Spec 更新 | 补充流程状态变更触发任务移列的规范 |
| web (kanban-store) | 可能变更 | 确认 WebSocket 事件能触发看板数据刷新 |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/orchestrator/internal/db/queries.go` | MODIFY | 新增 `UpdateTaskColumn()` 方法 |
| `packages/orchestrator/internal/engine/dag.go` | MODIFY | 在 StartFlow/advanceDAG/CancelFlow 中调用移列 |

### 不涉及

- 前端拖拽逻辑不变（手动拖拽仍然可用）
- API 路由层无变更（不新增接口）
- 数据库 schema 无变更（复用现有 tasks.column_id 字段）
- 看板列定义不变（Backlog / In Progress / Review / Done）

## 非目标

- 不实现 Review 列的自动移动（human_review 节点的映射关系较复杂，后续迭代）
- 不实现自定义列映射规则（当前使用硬编码列名匹配）
- 不实现流程失败时的自动回退策略（保持在 In Progress，由用户决定）

## 风险评估

- **风险等级：低** — 变更集中在 Orchestrator 内部，不影响现有 API 接口
- 列名查找失败时采用 warn 日志 + 静默跳过策略，不阻塞流程执行
- 数据库操作为单条 UPDATE，性能影响可忽略
