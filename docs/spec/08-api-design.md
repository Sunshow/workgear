# 8. API 设计

## 8.1 REST API 概览

### 认证
```
POST   /api/auth/login
POST   /api/auth/register
POST   /api/auth/refresh
```

### 项目
```
GET    /api/projects                    # 项目列表
POST   /api/projects                    # 创建项目
GET    /api/projects/:id                # 项目详情
PUT    /api/projects/:id                # 更新项目
DELETE /api/projects/:id                # 删除项目
GET    /api/projects/:id/members        # 项目成员
POST   /api/projects/:id/members        # 添加成员
```

### 看板
```
GET    /api/projects/:id/boards         # 看板列表
POST   /api/projects/:id/boards         # 创建看板
GET    /api/boards/:id                  # 看板详情（含列和任务）
PUT    /api/boards/:id                  # 更新看板
PUT    /api/boards/:id/columns/reorder  # 列排序
```

### 任务
```
GET    /api/projects/:id/tasks          # 任务列表（支持过滤排序）
POST   /api/projects/:id/tasks          # 创建任务
GET    /api/tasks/:id                   # 任务详情
PUT    /api/tasks/:id                   # 更新任务
DELETE /api/tasks/:id                   # 删除任务
PUT    /api/tasks/:id/move              # 移动任务（跨列）
POST   /api/tasks/:id/start-flow       # 启动流程
GET    /api/tasks/:id/timeline          # 消息时间线
```

### 流程
```
GET    /api/projects/:id/workflows      # 流程模板列表
POST   /api/projects/:id/workflows      # 创建流程模板
GET    /api/workflows/:id               # 流程模板详情
PUT    /api/workflows/:id               # 更新流程模板（DSL）
POST   /api/workflows/:id/validate      # 校验DSL
GET    /api/workflows/:id/runs          # 流程执行历史
```

### 流程执行
```
GET    /api/flow-runs/:id               # 流程实例详情
POST   /api/flow-runs/:id/pause         # 暂停
POST   /api/flow-runs/:id/resume        # 恢复
POST   /api/flow-runs/:id/cancel        # 取消
GET    /api/flow-runs/:id/nodes         # 节点执行列表
```

### 人工操作
```
GET    /api/node-runs/:id               # 节点详情
POST   /api/node-runs/:id/review        # 提交Review（approve/reject）
POST   /api/node-runs/:id/submit        # 提交人工输入
GET    /api/node-runs/:id/logs          # 节点执行日志（流式）
```

### Agent配置
```
GET    /api/projects/:id/agents         # Agent配置列表
POST   /api/projects/:id/agents         # 添加Agent
PUT    /api/agents/:id                  # 更新Agent配置
DELETE /api/agents/:id                  # 删除Agent
POST   /api/agents/:id/test             # 测试Agent连接
GET    /api/projects/:id/roles          # Agent角色列表
POST   /api/projects/:id/roles          # 创建角色
```

> **运行域约束（R3 新增）**：
> - 云端项目创建/更新 Agent 配置时，`runtime=local` 不允许
> - 返回 HTTP 400，错误码：`AGENT_RUNTIME_NOT_ALLOWED_IN_CLOUD`
> - 错误消息：`"Local runtime agents can only be configured in desktop app"`
> - 桌面端项目不受此限制

### 产物（P1-1 新增）
```
GET    /api/tasks/:id/artifacts              # 任务关联的产物列表
GET    /api/projects/:id/artifacts           # 项目所有产物（支持按类型过滤）
GET    /api/artifacts/:id                    # 产物详情（含最新版本）
GET    /api/artifacts/:id/versions           # 产物版本历史
GET    /api/artifacts/:id/versions/:version  # 特定版本详情
POST   /api/artifacts/:id/review             # 提交产物审批
GET    /api/artifacts/:id/links              # 产物引用关系图
GET    /api/artifacts/:id/trace              # 完整追溯链路（需求→PRD→Story→Task）
```

### 流程恢复与回放（P1-2 新增）
```
POST   /api/flow-runs/:id/replay             # 从检查点重放
GET    /api/flow-runs/:id/checkpoints        # 检查点列表
```

## 8.2 WebSocket 事件

```typescript
// 客户端 → 服务端
interface WSClientMessage {
  type: 'subscribe' | 'unsubscribe';
  channel: string;
  // channel格式:
  // project:{id}           - 项目级事件
  // task:{id}              - 任务级事件
  // flow-run:{id}          - 流程实例级事件
  // board:{id}             - 看板级事件
}

// 服务端 → 客户端
interface WSServerMessage {
  type: string;
  channel: string;
  data: any;
  timestamp: string;
}

// 事件类型:
// task.created / task.updated / task.moved / task.deleted
// flow.started / flow.paused / flow.completed / flow.failed
// node.started / node.completed / node.failed / node.waiting_human
// node.output_stream    -- Agent输出流式推送
// node.retried          -- 节点重试（P1-2 新增）
// agent.status_changed  -- Agent状态变更
// timeline.new_event    -- 新的时间线事件
// artifact.created / artifact.versioned / artifact.reviewed  -- 产物事件（P1-1 新增）
// collab.agent_completed / collab.adjudicated  -- 协同事件（P0-3 新增）
// flow.checkpointed     -- 流程检查点创建（P1-2 新增）
```

## 8.3 gRPC Proto 定义（API Server ↔ Orchestrator）

```protobuf
syntax = "proto3";
package workgear.orchestrator;

service OrchestratorService {
  // 流程管理
  rpc StartFlow(StartFlowRequest) returns (StartFlowResponse);
  rpc PauseFlow(FlowRequest) returns (FlowResponse);
  rpc ResumeFlow(FlowRequest) returns (FlowResponse);
  rpc CancelFlow(FlowRequest) returns (FlowResponse);
  rpc GetFlowStatus(FlowRequest) returns (FlowStatusResponse);

  // 人工操作
  rpc SubmitReview(SubmitReviewRequest) returns (SubmitReviewResponse);
  rpc SubmitHumanInput(SubmitHumanInputRequest) returns (SubmitHumanInputResponse);

  // 恢复与回放（P1-2 新增）
  rpc ResumeFromCheckpoint(ResumeCheckpointRequest) returns (ResumeCheckpointResponse);
  rpc CreateCheckpoint(CreateCheckpointRequest) returns (CreateCheckpointResponse);

  // 协同与仲裁（P0-3 新增）
  rpc AdjudicateOutputs(AdjudicateRequest) returns (AdjudicateResponse);
  rpc ValidateNodeOutput(ValidateOutputRequest) returns (ValidateOutputResponse);

  // 事件流（双向流）
  rpc EventStream(stream ClientEvent) returns (stream ServerEvent);
}

message StartFlowRequest {
  string workflow_id = 1;
  string project_id = 2;
  string task_id = 3;
  map<string, string> variables = 4;
  string trigger_type = 5;
  string execution_domain = 6;  // cloud | local（R4 新增）
  // Web/API 触发默认 cloud，桌面端触发默认 local，可显式指定覆盖
}

message SubmitReviewRequest {
  string node_run_id = 1;
  string action = 2;       // approve / reject / edit_and_approve
  string comment = 3;
  string edited_output = 4; // edit_and_approve时的编辑内容
  string reviewer_id = 5;
}

message ServerEvent {
  string event_type = 1;
  string flow_run_id = 2;
  string node_run_id = 3;
  string data_json = 4;    // JSON序列化的事件数据
  int64 timestamp = 5;
}

// P1-2 新增
message ResumeCheckpointRequest {
  string flow_run_id = 1;
  string checkpoint_id = 2;  // 可选，不指定则从最新检查点恢复
}

message ResumeCheckpointResponse {
  bool success = 1;
  string resumed_node_id = 2;
}

message CreateCheckpointRequest {
  string flow_run_id = 1;
}

message CreateCheckpointResponse {
  string checkpoint_id = 1;
  string data_json = 2;
}

// P0-3 新增
message AdjudicateRequest {
  repeated string node_run_ids = 1;  // 待仲裁的 NodeRun ID 列表
  string policy = 2;                 // rubric_score / majority_vote / weighted_vote
  string rubric_ref = 3;             // Rubric 定义文件引用（rubric_score 时必填）
  string scorer_role = 4;            // 评分 Agent 角色
}

message AdjudicateResponse {
  string winner_node_run_id = 1;
  int32 winner_score = 2;
  string report_json = 3;            // 仲裁报告
  repeated ScoreEntry scores = 4;
}

message ScoreEntry {
  string node_run_id = 1;
  string agent_role = 2;
  int32 score = 3;
  string breakdown_json = 4;
}

message ValidateOutputRequest {
  string schema_ref = 1;             // JSON Schema 引用
  string payload_json = 2;           // 待校验的输出
}

message ValidateOutputResponse {
  bool valid = 1;
  repeated string errors = 2;
}
```
