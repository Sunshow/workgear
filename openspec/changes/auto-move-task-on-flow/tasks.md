# Tasks: 流程生命周期自动移动看板任务列

## 模块：Orchestrator 数据库层 (packages/orchestrator/internal/db)

### 新增方法

- [ ] 在 `queries.go` 中新增 `UpdateTaskColumn(ctx, taskID, columnName)` 方法 **[S]**
- [ ] 实现子查询 SQL：通过 taskID 反查 project → kanban → kanban_columns 找到目标列 ID **[S]**
- [ ] 使用 EXISTS 子句防止目标列不存在时将 column_id 设为 NULL **[S]**

## 模块：Orchestrator 流程引擎 (packages/orchestrator/internal/engine)

### StartFlow 自动移列

- [ ] 在 `dag.go` 的 `StartFlow()` 函数末尾（recordTimeline 之后）调用 `db.UpdateTaskColumn(taskID, "In Progress")` **[S]**
- [ ] 失败时记录 warn 日志，不返回错误，不阻塞流程执行 **[S]**

### advanceDAG 流程完成移列

- [ ] 在 `dag.go` 的 `advanceDAG()` 函数中，流程完成分支（allCompleted=true）调用 `db.UpdateTaskColumn(taskID, "Done")` **[S]**
- [ ] 失败时记录 warn 日志，不影响流程完成状态 **[S]**

### CancelFlow 取消回退

- [ ] 在 `dag.go` 的 `CancelFlow()` 函数末尾（recordTimeline 之后）调用 `db.UpdateTaskColumn(taskID, "Backlog")` **[S]**
- [ ] 失败时记录 warn 日志，不影响取消操作 **[S]**

## 模块：前端验证 (packages/web)

### WebSocket 事件刷新确认

- [ ] 确认前端 WebSocket 事件处理器在收到 flow.started/completed/cancelled 时会重新拉取任务列表 **[S]**
- [ ] 如果未自动刷新，在事件处理器中增加 `fetchTasks()` 调用 **[M]**

## 测试验证

### 端到端验证

- [ ] 创建任务 → 启动流程 → 确认任务自动移至 In Progress **[S]**
- [ ] 等待流程完成 → 确认任务自动移至 Done **[S]**
- [ ] 启动流程 → 取消流程 → 确认任务回退至 Backlog **[S]**
- [ ] 在无 "In Progress" 列的看板中启动流程 → 确认流程正常执行，移列静默跳过 **[S]**

## 模块：OpenSpec 文档

- [ ] 归档完成后更新 `openspec/specs/kanban/2026-02-14-kanban-board.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/flow-engine/2026-02-14-flow-execution.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/orchestrator/2026-02-14-grpc-orchestrator.md` **[S]**
