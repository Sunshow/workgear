# WorkGear 评审补充报告：多类型 Agent 执行器与本地支持边界

- 报告时间：`2026-02-11 11:21`
- 报告目的：
  1. 记录当前规格文档的剩余问题点；
  2. 记录新增场景需求（多类型 Agent + 不同执行器）；
  3. 给出可落地设计方案；
  4. 明确边界：**不支持 Web/SaaS 调用用户机器本地 Agent**。

---

## 1. 背景与输入

基于前两轮评审与本轮复检，规格整体已达到“接近实现落地”状态；本报告聚焦以下新增议题：

- Agent 支持多种类型（如 ClaudeCode、Codex）
- 每种类型有不同执行器（Executor/Adapter）
- 可配置到系统中进行调度
- 本地 Agent 场景如何支持
- 明确不做场景：Web/SaaS 直接调用用户机器本地 Agent

---

## 2. 当前剩余问题点（本轮复检结论）

> 说明：以下为“收口级”问题，不是架构方向性问题。

### 2.1 跨作用域回退示例仍有一处未显式化

- 位置：`docs/spec/03-flow-engine.md:212`
- 现象：`goto: execute_task` 仍为字符串形式。
- 风险：若被解释为跨作用域回退，会与“跨作用域必须显式 scope”规则冲突。
- 建议：改为对象形式，例如：

```yaml
goto:
  node_id: execute_task
  scope: current_iteration
```

---

### 2.2 Registry/Scheduler 命名仍有轻微不一致

- 位置：
  - `docs/spec/04-agent-layer.md:173`（`AgentScheduler.Select`）
  - `docs/spec/09-implementation-details.md:134`（`e.registry.Select(...)`）
- 现象：接口职责与命名边界不够清晰（是 Registry 选，还是 Scheduler 选）。
- 建议：统一“对外调用入口”为 `AgentRegistry.Select(...)`，内部委托 `AgentScheduler.Select(...)`。

---

### 2.3 改进汇总文档有少量陈述滞后

- 位置：`docs/spec/10-improvements.md:53`, `docs/spec/10-improvements.md:116`
- 现象：
  - `goto` 默认推导描述仍是旧口径；
  - webhook 仍写“7 天 TTL”字样（已改为定时清理）。
- 建议：同步更新为当前最新规范，避免后续实现误读。

---

## 3. 新增场景需求（确认版）

### 3.1 功能需求

1. Agent 支持多类型：至少支持 `claude-code`、`codex`。
2. 不同类型使用不同执行器：每种类型有独立 Adapter/Executor。
3. 支持配置化接入：项目级可配置 Agent 类型、能力、运行时、并发限制。
4. 统一调度：流程节点按角色/能力选择合适实例。
5. 支持本地 Agent（受控场景）。

### 3.2 边界约束（本次新增）

**明确不支持：Web/SaaS 直接调用用户机器上的本地 Agent。**

即：
- 云端控制面（Web）只调用云端可达的 Runtime/Executor；
- 本地 Agent 仅在本地受控运行环境中使用（如桌面端/本地编排器）。

---

## 4. 架构可行性评估

结论：**现有架构支持该场景，且与“不支持 Web/SaaS 远调用户本地 Agent”边界兼容。**

### 4.1 已有能力对齐点

1. 统一适配层：`AgentAdapter` 可扩展多执行器。
   - `docs/spec/04-agent-layer.md:11`
2. 注册与调度：Registry + Scheduler 能按能力/策略选择实例。
   - `docs/spec/04-agent-layer.md:162`
3. 配置化运行时：`agent_configs.runtime` 已区分 `local/remote/docker`。
   - `docs/spec/06-data-model.md:270`
4. 本地执行形态：桌面端已有本地 runtime 与轻量编排器描述。
   - `docs/spec/02-architecture.md:97`

---

## 5. 设计方案（建议落地版）

## 5.1 设计原则

1. **类型隔离**：不同 Agent 类型用不同 Adapter，避免统一壳层过重。
2. **能力统一**：上层流程只面向角色/能力，不依赖具体厂商。
3. **运行域隔离**：本地与云端运行域隔离，禁止跨域直接调用用户本地进程。
4. **配置驱动**：以项目配置决定可用 Agent 池。

---

## 5.2 执行器分层

建议将“Agent 类型”与“运行通道”拆成两层：

- `Type Adapter`：语义层（ClaudeCodeAdapter / CodexAdapter）
- `Runtime Executor`：通道层（CLIExecutor / HTTPExecutor / GRPCExecutor）

这样可支持：
- `codex + CLI`（本地/容器）
- `codex + HTTP`（远程服务）
- `claude-code + CLI`

示例（抽象）：

```go
type AgentAdapter interface {
  Name() string
  Capabilities() []Capability
  BuildRequest(*TaskRequest) (*ExecutorRequest, error)
  ParseResponse(*ExecutorResponse) (*TaskResponse, error)
}

type Executor interface {
  Kind() string // cli/http/grpc
  Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error)
  Stream(ctx context.Context, req *ExecutorRequest) (<-chan *StreamEvent, error)
}
```

---

## 5.3 Codex 类型接入建议

新增配置样例（建议）：

```yaml
name: "codex-main"
agent_type: "codex"
runtime: "remote"        # remote / docker / local
executor:
  kind: "http"
  endpoint: "http://codex-runtime.internal/execute"
capabilities: [planning, coding, review]
roles: [general-developer, code-reviewer]
max_concurrent: 3
timeout_seconds: 900
```

对应落点：
- Adapter：`internal/agent/codex_adapter.go`
- Executor：复用 `http_executor.go` 或 `cli_executor.go`

---

## 5.4 本地 Agent 支持策略（含边界）

### 支持范围

支持“本地运行域”内执行本地 Agent：
- 桌面端（Electron）
- 本地编排器/本地 runtime

### 不支持范围

不支持“云端 Web/SaaS 直接驱动用户机器本地 Agent”。

### 落地约束

1. Web/API 层拒绝注册 `runtime=local` 且来源为云端项目的远程调用绑定。
2. 本地 runtime 只接受本地签发任务（或本地会话令牌）。
3. 文档中明确“local runtime 非公网可达组件”。

---

## 5.5 调度策略建议

调度优先级可配置：

1. 角色匹配（必须）
2. 能力匹配（必须）
3. 运行域匹配（本地流程优先本地池，云端流程只用 remote/docker）
4. 质量/时延/成本（策略项）

建议新增约束：

```text
if flow_run.execution_domain == "cloud" {
  candidates = candidates.filter(runtime in ["remote", "docker"])
}
if flow_run.execution_domain == "local" {
  candidates = candidates.filter(runtime in ["local", "docker", "remote"])
}
```

---

## 6. 规格文档建议补充点

## 6.1 `04-agent-layer.md`

补充 `codex` 适配器小节：
- 接入方式（CLI/HTTP）
- 输入输出规范
- 错误码与重试策略

## 6.2 `06-data-model.md`

建议补充字段（如已有则仅补说明）：
- `agent_configs.execution_domain`：`local | cloud | hybrid`
- `agent_configs.visibility_scope`：`desktop_only | project | org`

## 6.3 `08-api-design.md`

补充接口约束：
- 云端项目创建/更新 Agent 配置时，`runtime=local` 默认不允许。
- 返回明确错误码：`AGENT_RUNTIME_NOT_ALLOWED_IN_CLOUD`。

## 6.4 `11-security.md`

新增一条安全边界：
- 禁止云控面直接触达用户本地 Agent 进程。
- 仅允许本地 App 进程内/本机 IPC 调用本地 Runtime。

---

## 7. 验收建议（针对本场景）

### 7.1 多类型执行器验收

1. 同一流程可在不同节点分别选中 `claude-code` 与 `codex`。
2. 两类节点均可产出统一结构 `TaskResponse`。
3. 调度器在角色不变时可按策略切换类型。

### 7.2 本地支持边界验收

1. 桌面端本地流程可执行 `runtime=local` Agent。
2. Web/SaaS 流程尝试调用 `runtime=local` 时被拒绝并给出明确错误。
3. 审计日志可区分执行域（local/cloud）。

---

## 8. 本次补充结论

在不支持“Web/SaaS 直接调用用户机器本地 Agent”的前提下，当前架构依然能完整支持：

- 多类型 Agent（ClaudeCode/Codex）
- 多执行器接入（CLI/HTTP/gRPC）
- 配置化管理与统一调度
- 本地受控运行（桌面端/本地编排器）

建议按第 2 节的 3 个收口点修订文档后进入实现设计冻结。

