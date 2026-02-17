# Proposal: DSL 中配置的 Task Timeout 未生效

## 背景（Why）

当前 WorkGear 的 Workflow DSL 支持在节点定义中配置 `timeout` 字段（`NodeDef.Timeout` 和 `NodeConfigDef.Timeout`），前端 WorkflowEditor 也展示了该字段，但实际执行时所有 Agent 适配器（ClaudeCodeAdapter、DroidAdapter、CodexAdapter）均硬编码 `Timeout: 10 * time.Minute`，完全忽略了 DSL 中用户配置的超时值。

### 用户痛点

- 用户在 DSL 中配置 `timeout: "30m"` 或 `timeout: "1h"` 后，实际执行仍然是 10 分钟超时
- 复杂任务（如大型代码库的 opsx_apply）经常因 10 分钟硬编码超时而被强制终止
- 简单任务（如 generate_change_name）无法配置更短的超时以快速失败
- 用户无法通过 DSL 控制任务执行时间，降低了工作流编排的灵活性

### 根因分析

数据流断裂发生在 3 个层面：

1. **AgentRequest 缺少 Timeout 字段**：`adapter.go` 中的 `AgentRequest` 结构体没有 `Timeout` 字段，无法从 `node_handlers.go` 传递到适配器层
2. **node_handlers.go 未读取 DSL timeout**：`executeAgentTask()` 构建 `agentReq` 时完全没有读取 `nodeDef.Timeout` 或 `nodeDef.Config.Timeout`
3. **适配器硬编码超时**：三个适配器的 `BuildRequest()` 方法均写死 `Timeout: 10 * time.Minute`，未从 `AgentRequest` 获取超时配置

而下游的 `DockerExecutor` 已经正确支持动态超时（`executor.go:102-107`），只要 `ExecutorRequest.Timeout` 被正确设置即可生效。

## 目标（What）

打通 DSL timeout 配置到实际执行的完整数据链路：

```
DSL YAML (timeout: "30m")
    → dsl_parser.go (NodeDef.Timeout ✅ 已实现)
    → node_handlers.go (读取 + 解析 timeout → AgentRequest.Timeout ❌ 缺失)
    → adapter.BuildRequest() (使用 AgentRequest.Timeout ❌ 硬编码)
    → ExecutorRequest.Timeout (✅ 已支持)
    → DockerExecutor (✅ 已支持)
```

### 具体方案

1. 在 `AgentRequest` 结构体中新增 `Timeout time.Duration` 字段
2. 在 `node_handlers.go` 的 `executeAgentTask()` 中解析 `nodeDef.Timeout`（优先）或 `nodeDef.Config.Timeout`，转换为 `time.Duration` 并设置到 `agentReq.Timeout`
3. 修改三个适配器的 `BuildRequest()` 方法，优先使用 `req.Timeout`，仅在未配置时回退到 `10 * time.Minute` 默认值
4. 支持 Go 标准 duration 格式：`"10m"`, `"30m"`, `"1h"`, `"1h30m"` 等

### 超时优先级

```
NodeDef.Timeout > NodeConfigDef.Timeout > 默认值 (10m)
```

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| agent | 代码变更 | `adapter.go` 新增字段，三个适配器修改 BuildRequest() |
| flow-engine | 代码变更 | `node_handlers.go` 解析 timeout 并传递 |
| agent (spec) | Spec 更新 | 补充 timeout 传递行为规范 |
| flow-engine (spec) | Spec 更新 | 补充 DSL timeout 解析行为规范 |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/orchestrator/internal/agent/adapter.go` | MODIFY | AgentRequest 新增 Timeout 字段 |
| `packages/orchestrator/internal/engine/node_handlers.go` | MODIFY | 解析 DSL timeout 并设置到 AgentRequest |
| `packages/orchestrator/internal/agent/claude_adapter.go` | MODIFY | BuildRequest() 使用 req.Timeout |
| `packages/orchestrator/internal/agent/droid_adapter.go` | MODIFY | BuildRequest() 使用 req.Timeout |
| `packages/orchestrator/internal/agent/codex_adapter.go` | MODIFY | BuildRequest() 使用 req.Timeout |

### 不涉及

- DSL 解析器无需修改（`NodeDef.Timeout` 和 `NodeConfigDef.Timeout` 字段已存在）
- DockerExecutor 无需修改（已支持动态 timeout）
- 前端无需修改（已展示 timeout 字段）
- 数据库 schema 无变更
- gRPC proto 无变更

## 非目标

- 不实现运行时动态调整超时（任务执行中途修改超时）
- 不实现超时重试策略（超时后自动重试由 retry 机制处理）
- 不实现超时告警通知（超时前 N 分钟提醒）
- 不实现全局默认超时配置（通过环境变量或数据库配置默认值，当前保持 10m 硬编码默认值）

## 风险评估

- **风险等级：低** — 变更集中在 Orchestrator 内部，不影响外部 API 接口
- 向后兼容：未配置 timeout 的 DSL 节点仍使用 10 分钟默认值，行为不变
- 无效 timeout 字符串（如 `"abc"`）解析失败时回退到默认值，记录 warn 日志
