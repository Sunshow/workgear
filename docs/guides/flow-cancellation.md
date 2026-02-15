# 流程取消机制

本文档描述 WorkGear 流程取消的完整工作机制，包括数据库状态更新、容器终止、事件通知和前端 UI 响应。

---

## 概述

当用户点击"取消流程"按钮时，系统会：

1. 取消所有活跃节点（`pending`、`queued`、`waiting_human`、`running`）
2. 终止正在运行的 Docker 容器（通过 context cancellation）
3. 发布 WebSocket 事件通知前端
4. 阻止后续的人工操作（审核/输入）
5. 将 Task 移回 Backlog 列

---

## 架构层次

```
用户点击取消
    ↓
API Server (flow-runs/:id/cancel)
    ↓
gRPC → Orchestrator.CancelFlow()
    ↓
┌─────────────────────────────────────────┐
│ 1. 获取活跃节点列表                      │
│ 2. 触发 per-flow context cancel         │
│ 3. 批量更新节点状态为 cancelled          │
│ 4. 发布 node.cancelled 事件              │
│ 5. 更新 flow 状态为 cancelled            │
│ 6. 发布 flow.cancelled 事件              │
│ 7. Task 移回 Backlog                     │
└─────────────────────────────────────────┘
    ↓
WebSocket 推送事件
    ↓
前端刷新 + UI 禁用操作
```

---

## 数据库层

### 1. CancelPendingNodeRuns

**文件：** `packages/orchestrator/internal/db/queries.go`

```go
func (c *Client) CancelPendingNodeRuns(ctx context.Context, flowRunID string) error {
    _, err := c.pool.Exec(ctx, `
        UPDATE node_runs SET status = 'cancelled', completed_at = COALESCE(completed_at, NOW())
        WHERE flow_run_id = $1 AND status IN ('pending', 'queued', 'waiting_human', 'running')
    `, flowRunID)
    return err
}
```

**覆盖状态：**
- `pending`：尚未激活的节点
- `queued`：已激活但未被 worker 获取的节点
- `waiting_human`：等待人工审核/输入的节点
- `running`：正在执行的 agent 任务（容器已启动）

**注意：** `completed_at` 使用 `COALESCE` 避免覆盖已有的完成时间（如容器已自然结束）。

### 2. GetActiveNodeRuns

**文件：** `packages/orchestrator/internal/db/queries.go`

```go
func (c *Client) GetActiveNodeRuns(ctx context.Context, flowRunID string) ([]*NodeRun, error) {
    rows, err := c.pool.Query(ctx, `
        SELECT id, flow_run_id, node_id, node_type, node_name, status
        FROM node_runs
        WHERE flow_run_id = $1 AND status IN ('pending', 'queued', 'waiting_human', 'running')
    `, flowRunID)
    // ... scan rows ...
}
```

**用途：** 在批量更新前获取活跃节点列表，用于逐个发布 `node.cancelled` 事件。

---

## Engine 层

### 1. Per-Flow Cancel Context

**文件：** `packages/orchestrator/internal/engine/executor.go`

```go
type FlowExecutor struct {
    // ... existing fields ...
    flowCancels   map[string]context.CancelFunc  // flowRunID → cancelFunc
    flowCancelsMu sync.Mutex
}
```

**工作原理：**

1. Worker loop 获取节点后，创建 per-flow cancel context：
   ```go
   flowCtx, cancel := context.WithCancel(ctx)
   e.registerFlowCancel(nodeRun.FlowRunID, cancel)
   ```

2. 执行节点时使用 `flowCtx` 而非全局 `ctx`：
   ```go
   if err := e.executeNode(flowCtx, nodeRun); err != nil {
       if flowCtx.Err() == context.Canceled {
           // 流程已取消，跳过错误处理
       } else {
           e.handleNodeError(ctx, nodeRun, err)
       }
   }
   ```

3. `CancelFlow` 调用 `cancelFlowContext(flowRunID)` 触发 cancel：
   ```go
   func (e *FlowExecutor) cancelFlowContext(flowRunID string) {
       e.flowCancelsMu.Lock()
       defer e.flowCancelsMu.Unlock()
       if cancel, ok := e.flowCancels[flowRunID]; ok {
           cancel()
       }
   }
   ```

4. Context 取消链路：
   ```
   CancelFlow → cancelFlowContext() → cancel()
       ↓
   flowCtx.Done() 触发
       ↓
   DockerExecutor.Execute() 中的 execCtx 收到 Done
       ↓
   走已有的 ContainerKill 逻辑（timeout 分支）
       ↓
   容器被 SIGKILL 终止
       ↓
   Execute() 返回 context.Canceled error
       ↓
   Worker loop 检测到 flowCtx.Err() == context.Canceled，跳过 handleNodeError
   ```

### 2. CancelFlow 完整流程

**文件：** `packages/orchestrator/internal/engine/dag.go`

```go
func (e *FlowExecutor) CancelFlow(ctx context.Context, flowRunID string) error {
    // 1. 检查 flow 状态
    flowRun, err := e.db.GetFlowRun(ctx, flowRunID)
    if flowRun.Status == db.StatusCompleted || flowRun.Status == db.StatusCancelled {
        return fmt.Errorf("cannot cancel flow in status: %s", flowRun.Status)
    }

    // 2. 获取活跃节点（用于发事件）
    activeNodes, err := e.db.GetActiveNodeRuns(ctx, flowRunID)

    // 3. 触发 per-flow context cancel（终止 Docker 容器）
    e.cancelFlowContext(flowRunID)

    // 4. 批量更新节点状态
    if err := e.db.CancelPendingNodeRuns(ctx, flowRunID); err != nil {
        return fmt.Errorf("cancel active nodes: %w", err)
    }

    // 5. 为每个被取消的节点发布事件
    for _, node := range activeNodes {
        e.publishEvent(flowRunID, node.ID, node.NodeID, "node.cancelled", map[string]any{
            "previous_status": node.Status,
        })
    }

    // 6. 更新 flow 状态
    if err := e.db.UpdateFlowRunStatus(ctx, flowRunID, db.StatusCancelled); err != nil {
        return fmt.Errorf("update flow status: %w", err)
    }

    // 7. 发布 flow.cancelled 事件
    e.publishEvent(flowRunID, "", "", "flow.cancelled", nil)

    // 8. 记录 timeline
    e.recordTimeline(ctx, flowRun.TaskID, flowRunID, "", "flow_cancelled", map[string]any{
        "message": "流程已取消",
    })

    // 9. Task 移回 Backlog
    if err := e.db.UpdateTaskColumn(ctx, flowRun.TaskID, "Backlog"); err != nil {
        e.logger.Warnw("Failed to move task to Backlog", "error", err)
    }

    return nil
}
```

### 3. Human Action 防护

**文件：** `packages/orchestrator/internal/engine/dag.go`

所有人工操作方法（`HandleApprove`、`HandleReject`、`HandleEdit`、`HandleHumanInput`）在执行前检查 flow 状态：

```go
func (e *FlowExecutor) HandleApprove(ctx context.Context, nodeRunID string) error {
    nodeRun, err := e.db.GetNodeRun(ctx, nodeRunID)
    if err != nil {
        return fmt.Errorf("get node run: %w", err)
    }

    // 检查 flow 是否已取消
    flowRun, err := e.db.GetFlowRun(ctx, nodeRun.FlowRunID)
    if err != nil {
        return fmt.Errorf("get flow run: %w", err)
    }
    if flowRun.Status == db.StatusCancelled {
        return fmt.Errorf("flow has been cancelled")
    }

    // ... rest of logic ...
}
```

**防护效果：**
- 用户在流程取消后尝试提交审核/输入，API 返回 `"flow has been cancelled"` 错误
- 前端显示错误提示，避免误操作

---

## 前端层

### 1. WebSocket 事件监听

**文件：** `packages/web/src/hooks/use-websocket.ts`

```typescript
export function useFlowRunEvents(flowRunId: string | null | undefined, handlers: {
  // ... existing handlers ...
  onNodeCancelled?: (data: Record<string, unknown>) => void  // 新增
}) {
  // ... existing code ...
  switch (event.type) {
    // ... existing cases ...
    case 'node.cancelled': h.onNodeCancelled?.(data); break  // 新增
  }
}
```

### 2. 节点状态刷新

**文件：** `packages/web/src/pages/kanban/task-detail/flow-tab.tsx`

```typescript
useFlowRunEvents(latestFlow?.id, {
  // ... existing handlers ...
  onNodeCancelled: () => refreshNodeRuns(),  // 监听 node.cancelled 事件
})
```

**刷新逻辑：**
1. 收到 `node.cancelled` 事件
2. 调用 `refreshNodeRuns()` 重新获取节点列表
3. 节点状态从 `waiting_human` / `running` 变为 `cancelled`
4. UI 自动更新徽章和操作按钮

### 3. UI 禁用操作

**文件：** `packages/web/src/pages/kanban/task-detail/flow-tab.tsx`

```typescript
function NodeRunItem({ nodeRun, flowStatus, ... }) {
  const isFlowTerminal = flowStatus === 'cancelled' || flowStatus === 'completed'

  // 审核按钮：只在流程未终止时显示
  {nodeRun.status === 'waiting_human' && nodeRun.nodeType === 'human_review' && !isFlowTerminal && (
    <div className="space-y-2">
      <Textarea ... />
      <div className="flex gap-2">
        <Button>通过</Button>
        <Button>打回</Button>
      </div>
    </div>
  )}

  // 流程已取消提示
  {nodeRun.status === 'waiting_human' && isFlowTerminal && (
    <p className="text-xs text-muted-foreground">流程已取消，无法操作</p>
  )}
}
```

**UI 状态：**
- 流程运行中：显示审核/提交按钮
- 流程已取消：隐藏按钮，显示"流程已取消，无法操作"
- 节点状态徽章：从"等待人工"变为"已取消"

---

## 容器终止机制

### Docker 容器生命周期

**文件：** `packages/orchestrator/internal/agent/executor.go`

```go
func (e *DockerExecutor) Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error) {
    // 1. 创建带 timeout 的 context
    execCtx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    // 2. 创建并启动容器
    containerID := createResp.ID
    if err := e.cli.ContainerStart(execCtx, containerID, container.StartOptions{}); err != nil {
        return nil, fmt.Errorf("start container: %w", err)
    }

    // 3. 等待容器完成
    statusCh, errCh := e.cli.ContainerWait(execCtx, containerID, container.WaitConditionNotRunning)

    select {
    case err := <-errCh:
        // 容器异常退出
    case status := <-statusCh:
        // 容器正常退出
    case <-execCtx.Done():
        // Timeout 或 context 被取消 → 终止容器
        killCtx, killCancel := context.WithTimeout(context.Background(), 10*time.Second)
        defer killCancel()
        _ = e.cli.ContainerKill(killCtx, containerID, "SIGKILL")
        return nil, fmt.Errorf("container execution timed out or cancelled")
    }
}
```

### 取消链路

```
用户点击取消
    ↓
CancelFlow() 调用 cancelFlowContext(flowRunID)
    ↓
flowCtx 被 cancel
    ↓
executeNode(flowCtx, nodeRun) 中的 flowCtx 收到 Done
    ↓
DockerExecutor.Execute(flowCtx, ...) 中的 execCtx 继承 flowCtx
    ↓
execCtx.Done() 触发 select 的 <-execCtx.Done() 分支
    ↓
ContainerKill(containerID, "SIGKILL")
    ↓
容器进程被强制终止
    ↓
Execute() 返回 "container execution timed out or cancelled" error
    ↓
Worker loop 检测到 flowCtx.Err() == context.Canceled
    ↓
跳过 handleNodeError，不标记节点为 failed
    ↓
CancelPendingNodeRuns 已将节点标记为 cancelled
```

---

## 时序图

```
用户                API Server         Orchestrator        Docker          前端
 │                      │                   │                │              │
 │  点击取消流程         │                   │                │              │
 ├─────────────────────>│                   │                │              │
 │                      │  gRPC CancelFlow  │                │              │
 │                      ├──────────────────>│                │              │
 │                      │                   │ GetActiveNodeRuns             │
 │                      │                   ├───────┐        │              │
 │                      │                   │       │        │              │
 │                      │                   │<──────┘        │              │
 │                      │                   │ cancelFlowContext()           │
 │                      │                   ├───────┐        │              │
 │                      │                   │       │        │              │
 │                      │                   │<──────┘        │              │
 │                      │                   │                │              │
 │                      │                   │  flowCtx.Done()│              │
 │                      │                   ├───────────────>│              │
 │                      │                   │                │ SIGKILL      │
 │                      │                   │                ├──────┐       │
 │                      │                   │                │      │       │
 │                      │                   │                │<─────┘       │
 │                      │                   │ CancelPendingNodeRuns         │
 │                      │                   ├───────┐        │              │
 │                      │                   │       │        │              │
 │                      │                   │<──────┘        │              │
 │                      │                   │                │              │
 │                      │                   │ Publish node.cancelled        │
 │                      │                   ├──────────────────────────────>│
 │                      │                   │                │              │
 │                      │                   │ UpdateFlowRunStatus           │
 │                      │                   ├───────┐        │              │
 │                      │                   │       │        │              │
 │                      │                   │<──────┘        │              │
 │                      │                   │                │              │
 │                      │                   │ Publish flow.cancelled        │
 │                      │                   ├──────────────────────────────>│
 │                      │                   │                │              │
 │                      │  Success          │                │              │
 │                      │<──────────────────┤                │              │
 │  200 OK              │                   │                │              │
 │<─────────────────────┤                   │                │              │
 │                      │                   │                │  刷新节点列表 │
 │                      │                   │                │  禁用操作按钮 │
 │                      │                   │                │<─────┐       │
 │                      │                   │                │      │       │
 │                      │                   │                │<─────┘       │
```

---

## 测试验证

### 测试场景 1：取消 waiting_human 节点

1. 启动包含 `human_review` 节点的流程
2. 等待节点进入 `waiting_human` 状态
3. 点击"取消流程"
4. **验证：**
   - 节点状态从 `waiting_human` 变为 `cancelled`
   - 前端自动刷新，徽章显示"已取消"
   - 审核按钮消失，显示"流程已取消，无法操作"
   - 尝试通过 API 提交审核，返回 `"flow has been cancelled"` 错误

### 测试场景 2：取消 running 节点

1. 启动包含 `agent_task` 节点的流程
2. 等待节点进入 `running` 状态（容器已启动）
3. 点击"取消流程"
4. **验证：**
   - Docker 容器被 SIGKILL 终止（通过 `docker ps` 确认容器消失）
   - 节点状态从 `running` 变为 `cancelled`
   - 前端自动刷新，徽章显示"已取消"
   - Worker loop 日志显示 "Node execution cancelled by flow cancel"

### 测试场景 3：取消后尝试操作

1. 取消包含 `human_input` 节点的流程
2. 尝试通过 API 提交输入：
   ```bash
   curl -X POST http://localhost:4000/api/node-runs/{nodeRunId}/submit \
     -H "Content-Type: application/json" \
     -d '{"text": "test"}'
   ```
3. **验证：**
   - API 返回 500 错误，错误信息为 `"flow has been cancelled"`
   - 前端显示错误提示

---

## 边界情况

### 1. 容器已自然完成

**场景：** 用户点击取消时，容器刚好执行完成。

**处理：**
- `CancelPendingNodeRuns` 使用 `COALESCE(completed_at, NOW())`，不会覆盖已有的完成时间
- 节点状态可能已是 `completed`，不会被更新为 `cancelled`
- `GetActiveNodeRuns` 只查询活跃状态，已完成节点不会收到 `node.cancelled` 事件

### 2. 多个节点同时运行

**场景：** 流程有多个并行的 `agent_task` 节点同时运行。

**处理：**
- `cancelFlowContext()` 触发 per-flow context cancel，所有使用该 `flowCtx` 的节点都会收到 Done 信号
- 所有容器同时被 SIGKILL 终止
- `CancelPendingNodeRuns` 批量更新所有活跃节点
- 每个节点都会收到独立的 `node.cancelled` 事件

### 3. 取消时节点正在 QUEUED → RUNNING 转换

**场景：** Worker 刚获取节点（状态变为 `running`），但尚未启动容器。

**处理：**
- Worker loop 创建 `flowCtx` 后立即注册到 `flowCancels`
- 如果此时 `CancelFlow` 被调用，`cancelFlowContext()` 会触发 cancel
- `executeNode()` 中的 `flowCtx` 立即收到 Done，容器启动前就会被中断
- 节点状态被更新为 `cancelled`

### 4. 网络延迟导致前端未及时收到事件

**场景：** WebSocket 连接不稳定，`node.cancelled` 事件延迟到达。

**处理：**
- 用户尝试操作时，API 会返回 `"flow has been cancelled"` 错误
- 前端显示错误提示，提醒用户流程已取消
- WebSocket 重连后会自动重新订阅，最终收到事件并刷新 UI

---

## 日志示例

### Orchestrator 日志

```
INFO  CancelFlow called  flow_run_id=abc123
INFO  Triggered flow context cancel  flow_run_id=abc123
INFO  Cancelled 3 active nodes  flow_run_id=abc123
INFO  Published node.cancelled event  node_run_id=node1 previous_status=waiting_human
INFO  Published node.cancelled event  node_run_id=node2 previous_status=running
INFO  Published node.cancelled event  node_run_id=node3 previous_status=queued
INFO  Flow cancelled  flow_run_id=abc123
INFO  Node execution cancelled by flow cancel  node_run_id=node2 node_id=agent_task_1
```

### Docker 日志

```
INFO  Started agent container  container_id=abc123def456
INFO  Agent container finished  container_id=abc123def456 exit_code=137 (SIGKILL)
INFO  Removed agent container  container_id=abc123def456
```

### 前端日志

```
[WS] Received event: node.cancelled  node_run_id=node1 previous_status=waiting_human
[WS] Received event: node.cancelled  node_run_id=node2 previous_status=running
[WS] Received event: flow.cancelled  flow_run_id=abc123
```

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `packages/orchestrator/internal/db/queries.go` | `CancelPendingNodeRuns`、`GetActiveNodeRuns` |
| `packages/orchestrator/internal/engine/executor.go` | Per-flow cancel context 管理、Worker loop |
| `packages/orchestrator/internal/engine/dag.go` | `CancelFlow`、Human action 防护 |
| `packages/orchestrator/internal/agent/executor.go` | Docker 容器终止逻辑 |
| `packages/web/src/hooks/use-websocket.ts` | WebSocket 事件监听 |
| `packages/web/src/pages/kanban/task-detail/flow-tab.tsx` | 前端 UI 刷新和禁用逻辑 |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-02-15 | 初始版本，支持取消 `waiting_human` 和 `running` 节点 |
