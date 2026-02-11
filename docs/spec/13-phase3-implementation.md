# Phase 3 实施方案：流程引擎 + Agent 调度

> **日期**: 2026-02-11
> **状态**: 待实施
> **预计工期**: 2 周
> **前置条件**: Phase 2 已完成

---

## 1. 架构决策总结

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 执行模型 | 持久化驱动状态机 | 服务可重启、人工节点不阻塞、可水平扩展 |
| 流程引擎启动 | Orchestrator 自治轮询 DB | 支持故障恢复，解耦 API Server |
| Agent 通信协议 | gRPC 双向流 | 类型安全，支持流式输出，与现有架构一致 |
| Agent 容器管理 | 按需启动/销毁（Docker API） | 资源隔离，按需分配 |
| 节点类型范围 | 最小集：agent_task + human_review + human_input | 先跑通核心链路 |
| Phase 3 优先级 | 流程引擎核心优先，Agent 用 Mock | 先保证状态机正确性 |

---

## 2. 整体架构

```
浏览器 → Vite(:3000) --/api代理-→ Fastify(:4000) ←──WebSocket──→ 浏览器
                                       │
                                       │ gRPC (双向流)
                                       ▼
                              Go Orchestrator(:50051)
                              ┌─────────────────────┐
                              │  gRPC Server         │
                              │  ┌─────────────────┐ │
                              │  │ Flow Engine      │ │
                              │  │  - DSL Parser    │ │
                              │  │  - State Machine │ │
                              │  │  - DAG Advancer  │ │
                              │  └────────┬────────┘ │
                              │           │          │
                              │  ┌────────▼────────┐ │
                              │  │ Worker Pool      │ │
                              │  │  - 轮询 DB       │ │
                              │  │  - 执行节点      │ │
                              │  │  - 推进 DAG      │ │
                              │  └────────┬────────┘ │
                              │           │          │
                              │  ┌────────▼────────┐ │
                              │  │ Agent Scheduler  │ │
                              │  │  - Registry      │ │
                              │  │  - Mock Adapter  │ │
                              │  │  - gRPC Adapter  │ │ ← Phase 4: 容器化 Agent
                              │  └─────────────────┘ │
                              │           │          │
                              │  ┌────────▼────────┐ │
                              │  │ Event Publisher  │ │ → gRPC 双向流 → API Server → WebSocket → 浏览器
                              │  └─────────────────┘ │
                              └──────────┬───────────┘
                                         │
                                    PostgreSQL(:5432)
```

---

## 3. Orchestrator 模块设计

### 3.1 目录结构

```
packages/orchestrator/
├── cmd/server/
│   └── main.go                    # 入口：启动 gRPC + Worker
├── internal/
│   ├── grpc/
│   │   ├── pb/                    # protobuf 生成代码
│   │   │   ├── orchestrator.pb.go
│   │   │   └── orchestrator_grpc.pb.go
│   │   ├── server.go              # gRPC 服务实现
│   │   └── event_stream.go        # 双向流事件推送
│   ├── engine/
│   │   ├── executor.go            # 流程执行器（Worker 主循环）
│   │   ├── dsl_parser.go          # YAML DSL → DAG 结构
│   │   ├── dag.go                 # DAG 数据结构 + 推进逻辑
│   │   ├── state_machine.go       # NodeRun 状态机
│   │   ├── expression.go          # 模板表达式解析 {{...}}
│   │   └── node_handlers.go       # 各节点类型的执行逻辑
│   ├── agent/
│   │   ├── adapter.go             # AgentAdapter 接口定义
│   │   ├── mock_adapter.go        # Mock 实现（Phase 3）
│   │   ├── grpc_adapter.go        # gRPC Agent Runtime 客户端（Phase 4）
│   │   └── registry.go            # Agent 注册中心
│   ├── db/
│   │   ├── client.go              # PostgreSQL 连接
│   │   ├── queries.go             # 核心查询（node_runs CRUD）
│   │   └── models.go              # Go 数据模型
│   └── event/
│       └── bus.go                 # 内部事件总线
├── go.mod
├── go.sum
└── Makefile
```

### 3.2 核心数据流

```
1. API Server 调用 gRPC StartFlow
   → Orchestrator 解析 DSL，创建入口节点 NodeRun (status=QUEUED)
   → 返回成功

2. Worker 主循环（轮询 DB）
   → SELECT ... FROM node_runs WHERE status='queued' ... FOR UPDATE SKIP LOCKED
   → 获取一个 QUEUED 的 NodeRun
   → 根据 node_type 分发执行

3. agent_task 节点
   → 调用 AgentAdapter.Execute()（Phase 3 为 Mock）
   → 更新 NodeRun output + status=COMPLETED
   → 调用 advanceDAG() 激活后续节点

4. human_review 节点
   → 更新 NodeRun status=WAITING_HUMAN
   → 发布事件 → gRPC 双向流 → API Server → WebSocket → 浏览器
   → Worker 释放，不阻塞

5. 人工提交 Review（通过 API Server → gRPC）
   → Orchestrator 处理 approve/reject
   → approve: 更新 status=COMPLETED，advanceDAG()
   → reject: 回退到目标节点，创建新的 QUEUED NodeRun

6. 所有节点完成
   → advanceDAG() 检测无后续节点
   → 更新 FlowRun status=COMPLETED
```

---

## 4. 持久化状态机详细设计

### 4.1 NodeRun 状态流转

```
                    ┌──────────┐
                    │ PENDING  │  (DAG 中存在但依赖未满足)
                    └────┬─────┘
                         │ 依赖全部 COMPLETED
                         ▼
                    ┌──────────┐
                    │ QUEUED   │  (可被 Worker 拾取)
                    └────┬─────┘
                         │ Worker 获取锁
                         ▼
                    ┌──────────┐
              ┌─────│ RUNNING  │─────┐
              │     └──────────┘     │
              │          │           │
              ▼          ▼           ▼
     ┌──────────┐ ┌───────────┐ ┌────────┐
     │COMPLETED │ │WAIT_HUMAN │ │ FAILED │
     └──────────┘ └─────┬─────┘ └────┬───┘
                        │             │ 可重试
                   approve/reject     ▼
                        │        ┌──────────┐
                        ▼        │ QUEUED   │ (retry)
                  ┌──────────┐   └──────────┘
                  │COMPLETED │
                  │   or     │
                  │REJECTED  │ → 创建新 QUEUED NodeRun (目标节点)
                  └──────────┘
```

### 4.2 Worker 获取任务（防并发）

```sql
-- 使用 FOR UPDATE SKIP LOCKED 实现分布式锁
-- 同一时刻只有一个 Worker 能获取到同一个 NodeRun
UPDATE node_runs
SET status = 'running',
    locked_by = $1,        -- worker_id
    locked_at = NOW(),
    started_at = NOW()
WHERE id = (
    SELECT id FROM node_runs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

### 4.3 DAG 推进逻辑

```go
func (e *FlowExecutor) advanceDAG(ctx context.Context, flowRunID string) error {
    // 1. 加载 DAG 结构
    dag := e.loadDAG(ctx, flowRunID)

    // 2. 获取所有已完成的节点
    completedNodes := e.db.GetCompletedNodeIDs(ctx, flowRunID)

    // 3. 遍历 DAG，找到所有依赖已满足但还是 PENDING 的节点
    for _, nodeID := range dag.AllNodeIDs() {
        if completedNodes.Contains(nodeID) {
            continue
        }
        deps := dag.GetDependencies(nodeID)
        if allCompleted(deps, completedNodes) {
            // 激活：PENDING → QUEUED
            e.db.UpdateNodeRunStatus(ctx, flowRunID, nodeID, "queued")
        }
    }

    // 4. 检查是否所有节点都完成
    if e.db.AllNodesCompleted(ctx, flowRunID) {
        e.db.UpdateFlowRunStatus(ctx, flowRunID, "completed")
        e.publishEvent(ctx, "flow.completed", flowRunID, "")
    }

    return nil
}
```

---

## 5. Agent 调度框架

### 5.1 接口定义

```go
// AgentAdapter 统一接口
type AgentAdapter interface {
    Name() string
    Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error)
    Stream(ctx context.Context, req *AgentRequest) (<-chan *StreamEvent, error)
}

type AgentRequest struct {
    TaskID     string
    FlowRunID  string
    NodeID     string
    Mode       string            // spec / execute / review
    Prompt     string
    Context    map[string]any
    WorkDir    string
    GitBranch  string
}

type AgentResponse struct {
    Output   map[string]any
    Metrics  *ExecutionMetrics
}
```

### 5.2 Mock Adapter（Phase 3）

```go
type MockAdapter struct{}

func (m *MockAdapter) Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error) {
    // 模拟执行延迟
    time.Sleep(2 * time.Second)

    // 根据 mode 返回不同的模拟输出
    switch req.Mode {
    case "spec":
        return &AgentResponse{
            Output: map[string]any{
                "plan":     "Mock implementation plan for: " + req.Prompt[:min(100, len(req.Prompt))],
                "files":    []string{"src/main.ts", "src/utils.ts"},
                "estimate": "2 hours",
            },
        }, nil
    case "execute":
        return &AgentResponse{
            Output: map[string]any{
                "result":        "Mock execution completed",
                "changed_files": []string{"src/main.ts"},
                "summary":       "Implemented the requested changes",
            },
        }, nil
    case "review":
        return &AgentResponse{
            Output: map[string]any{
                "passed":  true,
                "issues":  []any{},
                "report":  "Code review passed. No issues found.",
            },
        }, nil
    }
    return &AgentResponse{Output: map[string]any{"result": "ok"}}, nil
}
```

### 5.3 gRPC Agent Adapter（Phase 4 预留）

```go
// Phase 4 实现：通过 gRPC 调用容器化的 Agent Runtime
type GRPCAgentAdapter struct {
    endpoint string
    client   AgentRuntimeServiceClient
}

func (a *GRPCAgentAdapter) Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error) {
    // 1. 通过 Docker API 启动 Agent 容器（如果未运行）
    // 2. 通过 gRPC 调用容器内的 Agent Runtime Service
    // 3. 流式接收输出
    // 4. 任务完成后销毁容器
}
```

### 5.4 Agent Registry

```go
type AgentRegistry struct {
    adapters map[string]AgentAdapter  // name → adapter
    roles    map[string]string        // role → adapter name
}

func (r *AgentRegistry) GetAdapter(role string) (AgentAdapter, error) {
    adapterName, ok := r.roles[role]
    if !ok {
        // 默认使用 mock
        adapterName = "mock"
    }
    adapter, ok := r.adapters[adapterName]
    if !ok {
        return nil, fmt.Errorf("adapter not found: %s", adapterName)
    }
    return adapter, nil
}
```

---

## 6. gRPC 事件流设计

### 6.1 Proto 更新

当前 proto 已定义了基本的 RPC 方法，需要补充 `EventStream`：

```protobuf
service OrchestratorService {
    // ... 现有方法 ...

    // 双向流：API Server 订阅事件
    rpc EventStream(stream ClientEvent) returns (stream ServerEvent);
}

message ClientEvent {
    string type = 1;           // subscribe / unsubscribe / ping
    string flow_run_id = 2;    // 订阅特定 FlowRun 的事件
}

message ServerEvent {
    string event_type = 1;     // node.started / node.completed / node.waiting_human / flow.completed
    string flow_run_id = 2;
    string node_run_id = 3;
    string node_id = 4;
    string data_json = 5;      // JSON 序列化的事件数据
    int64 timestamp = 6;
}
```

### 6.2 事件流转链路

```
Orchestrator Worker
    │
    │ 节点状态变更
    ▼
Event Bus (内存 channel)
    │
    │ 推送给所有订阅的 gRPC stream
    ▼
gRPC EventStream → API Server
    │
    │ 转发到 WebSocket
    ▼
WebSocket Gateway → 浏览器
    │
    │ 更新 UI
    ▼
React 组件（Task 详情面板、看板卡片）
```

---

## 7. API Server 集成

### 7.1 新增/修改的 API 端点

```
# 流程执行（修改现有，增加 gRPC 调用）
POST   /api/flow-runs                    # 创建 FlowRun → 调用 Orchestrator.StartFlow
PUT    /api/flow-runs/:id/cancel         # 取消 → 调用 Orchestrator.CancelFlow

# 人工操作（新增）
POST   /api/node-runs/:id/review         # 提交 Review → 调用 Orchestrator.ApproveNode/RejectNode
POST   /api/node-runs/:id/submit         # 提交人工输入 → 调用 Orchestrator.SubmitHumanInput
GET    /api/node-runs/:id                 # 获取节点详情

# WebSocket（新增）
WS     /ws                               # WebSocket 连接端点
```

### 7.2 gRPC 客户端

```typescript
// packages/api/src/grpc/client.ts
import { createClient } from '@grpc/grpc-js'

const orchestratorClient = createClient(
    OrchestratorServiceDefinition,
    'localhost:50051',
    grpc.credentials.createInsecure()
)

// 启动事件流订阅
const eventStream = orchestratorClient.EventStream()
eventStream.on('data', (event: ServerEvent) => {
    // 转发到 WebSocket
    wsGateway.broadcast(`flow-run:${event.flowRunId}`, {
        type: event.eventType,
        data: JSON.parse(event.dataJson),
        timestamp: event.timestamp,
    })
})
```

### 7.3 WebSocket Gateway

```typescript
// packages/api/src/ws/gateway.ts
// 基于 @fastify/websocket 实现
app.register(websocket)

app.get('/ws', { websocket: true }, (socket, req) => {
    socket.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'subscribe') {
            subscriptions.add(socket, msg.channel)
        }
    })
})
```

---

## 8. 前端集成

### 8.1 新增组件

```
packages/web/src/
├── hooks/
│   ├── use-websocket.ts           # WebSocket 连接管理
│   └── use-flow-subscription.ts   # FlowRun 事件订阅
├── pages/board/task-detail/
│   ├── review-panel.tsx           # 人工 Review 面板（approve/reject/edit）
│   └── flow-tab.tsx               # 更新：实时显示节点状态
```

### 8.2 Review 面板

```tsx
// 当节点状态为 WAITING_HUMAN 时显示
function ReviewPanel({ nodeRun }) {
    return (
        <div>
            <h3>Agent 输出</h3>
            <pre>{JSON.stringify(nodeRun.output, null, 2)}</pre>

            <div className="flex gap-2">
                <Button onClick={() => submitReview('approve')}>✅ Approve</Button>
                <Button onClick={() => submitReview('reject')}>❌ Reject</Button>
                <Button onClick={() => submitReview('edit_and_approve')}>✏️ Edit & Approve</Button>
            </div>

            {action === 'reject' && (
                <Textarea placeholder="请输入反馈..." value={feedback} onChange={...} />
            )}
        </div>
    )
}
```

---

## 9. 数据库 Schema 变更

### 9.1 node_runs 表补充字段

```typescript
// 在现有 nodeRuns 表基础上增加
export const nodeRuns = pgTable('node_runs', {
    // ... 现有字段 ...

    // Phase 3 新增
    nodeType: varchar('node_type', { length: 50 }),        // agent_task / human_review / human_input
    nodeName: varchar('node_name', { length: 200 }),       // 节点显示名称
    lockedBy: varchar('locked_by', { length: 100 }),       // Worker ID（防并发）
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    reviewAction: varchar('review_action', { length: 50 }), // approve / reject / edit_and_approve
    reviewComment: text('review_comment'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
})
```

### 9.2 flow_runs 表补充字段

```typescript
export const flowRuns = pgTable('flow_runs', {
    // ... 现有字段 ...

    // Phase 3 新增
    dslSnapshot: text('dsl_snapshot'),    // 启动时的 DSL 快照（防止运行中修改 workflow 影响）
    variables: jsonb('variables'),         // 流程变量
})
```

---

## 10. 实施步骤

### Step 1: Orchestrator 持久化状态机（3-4 天）

1. 更新 Protobuf 定义，生成 Go 代码
2. 实现 DB 层（PostgreSQL 连接 + 核心查询）
3. 实现 DSL 解析器（YAML → DAG）
4. 实现 Worker 主循环（轮询 + 执行 + 推进）
5. 实现节点状态机
6. 实现 DAG 推进逻辑
7. 实现 gRPC 服务（StartFlow / CancelFlow / ApproveNode / RejectNode）

### Step 2: Agent 调度框架（1-2 天）

1. 定义 AgentAdapter 接口
2. 实现 MockAdapter
3. 实现 AgentRegistry
4. 集成到 Worker 的 agent_task 节点处理

### Step 3: 事件推送（2 天）

1. 实现 Orchestrator 内部 Event Bus
2. 实现 gRPC EventStream 双向流
3. API Server 实现 gRPC 事件流客户端
4. API Server 实现 WebSocket Gateway
5. 事件转发：Orchestrator → gRPC → API Server → WebSocket → 浏览器

### Step 4: API Server 集成（2 天）

1. 实现 gRPC 客户端
2. 修改 flow-runs 路由（调用 Orchestrator）
3. 新增 node-runs 路由（Review 提交）
4. 数据库 Schema 迁移

### Step 5: 前端集成（2-3 天）

1. 实现 WebSocket Hook
2. 实现 FlowRun 事件订阅
3. 更新 Flow Tab（实时节点状态）
4. 实现 Review Panel（approve/reject/edit）
5. 更新 Task 卡片（显示流程进度）

---

## 11. 退出标准

- [ ] 可从前端创建 Task → 选择 Workflow → 启动 FlowRun
- [ ] Orchestrator 自动执行 agent_task 节点（Mock 输出）
- [ ] human_review 节点暂停，前端显示 Review 面板
- [ ] 人工 Approve 后流程继续执行后续节点
- [ ] 人工 Reject 后流程回退到上一节点重新执行
- [ ] 流程完成后 FlowRun 状态变为 COMPLETED
- [ ] 前端通过 WebSocket 实时看到节点状态变化
- [ ] Orchestrator 重启后可恢复执行中的流程
- [ ] 消息时间线记录完整的流程执行过程

---

## 12. Phase 4 预留（Agent 容器化）

Phase 3 完成后，Phase 4 将实现：

1. **Agent Runtime Proto 定义**
   ```protobuf
   service AgentRuntimeService {
       rpc Execute(AgentRequest) returns (stream AgentEvent);
       rpc HealthCheck(Empty) returns (HealthResponse);
   }
   ```

2. **Agent Runtime 容器镜像**
   - 基于 Node.js 镜像
   - 预装 ClaudeCode CLI
   - 内嵌 gRPC Server（包装 CLI 调用）

3. **Docker API 集成**
   - Orchestrator 通过 Docker SDK 按需启动容器
   - 每个 agent_task 节点启动独立容器
   - 任务完成后自动销毁

4. **容器生命周期管理**
   - 健康检查
   - 超时终止
   - 资源限制（CPU/Memory）
   - 日志收集
