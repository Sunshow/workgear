# Design: DSL Task Timeout 配置生效

## 技术方案

### 方案概述

打通 DSL `timeout` 字段到 Docker 容器执行超时的完整数据链路。核心变更集中在 Go Orchestrator 的 agent 和 engine 两个包，共修改 5 个文件，新增约 20 行代码。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| timeout 解析方式 | `time.ParseDuration()` | Go 标准库，支持 "10m"/"1h"/"1h30m" 等格式，无需自定义解析器 |
| 传递方式 | AgentRequest 新增 Timeout 字段 | 复用现有 request 传递链路，最小侵入 |
| 优先级 | NodeDef.Timeout > Config.Timeout > 10m | 顶层配置优先，与 model 等字段的优先级策略一致 |
| 解析失败策略 | warn 日志 + 回退默认值 | 不因配置错误阻塞流程执行，与项目中其他配置解析策略一致 |
| 默认值位置 | 适配器 BuildRequest() 中 | 保持现有默认值逻辑位置不变，减少变更范围 |

### 备选方案（已排除）

- **在 DockerExecutor 中解析 timeout 字符串**：排除原因：Executor 是运行时层，不应承担 DSL 语义解析职责，违反两层架构设计
- **在 DSL 解析阶段转换为 Duration**：排除原因：需要修改 `NodeDef` 结构体类型（string → Duration），影响 YAML 反序列化，变更范围过大
- **通过环境变量传递 timeout 到容器**：排除原因：timeout 是 Docker 容器级别的控制，不是容器内应用的配置，应在宿主机侧控制

---

## 数据流

### 完整数据流（修复后）

```
用户编写 DSL YAML
    │
    │  timeout: "30m"
    ▼
dsl_parser.go — ParseDSL()
    │
    │  NodeDef.Timeout = "30m" (string)  ← 已实现，无需修改
    ▼
node_handlers.go — executeAgentTask()
    │
    ├── 读取 nodeDef.Timeout ("30m")
    ├── time.ParseDuration("30m") → 30 * time.Minute
    ├── ★ agentReq.Timeout = 30 * time.Minute  ← 新增
    │
    ▼
claude_adapter.go — BuildRequest()
    │
    ├── ★ timeout := req.Timeout  ← 修改（原为硬编码 10m）
    ├── if timeout == 0 { timeout = 10 * time.Minute }
    ├── ExecutorRequest.Timeout = timeout
    │
    ▼
executor.go — DockerExecutor.Execute()
    │
    ├── timeout := req.Timeout (30m)  ← 已实现，无需修改
    ├── if timeout == 0 { timeout = 10m }
    ├── execCtx, cancel := context.WithTimeout(ctx, timeout)
    │
    ▼
Docker 容器执行（30 分钟超时）
```

### 解析失败数据流

```
DSL: timeout: "invalid"
    │
    ▼
node_handlers.go
    │
    ├── time.ParseDuration("invalid") → error
    ├── logger.Warnw("Failed to parse task timeout", ...)
    ├── agentReq.Timeout = 0 (零值，未设置)
    │
    ▼
adapter.BuildRequest()
    │
    ├── req.Timeout == 0 → 回退到 10 * time.Minute
    │
    ▼
DockerExecutor（10 分钟默认超时）
```

---

## 文件变更清单

### 修改文件

| 文件路径 | 变更类型 | 变更量 | 说明 |
|----------|----------|--------|------|
| `packages/orchestrator/internal/agent/adapter.go` | MODIFY | +2 行 | AgentRequest 新增 Timeout 字段 |
| `packages/orchestrator/internal/engine/node_handlers.go` | MODIFY | +15 行 | 解析 DSL timeout 并设置到 AgentRequest |
| `packages/orchestrator/internal/agent/claude_adapter.go` | MODIFY | +4/-1 行 | BuildRequest() 使用 req.Timeout |
| `packages/orchestrator/internal/agent/droid_adapter.go` | MODIFY | +4/-1 行 | BuildRequest() 使用 req.Timeout |
| `packages/orchestrator/internal/agent/codex_adapter.go` | MODIFY | +4/-1 行 | BuildRequest() 使用 req.Timeout |

### 新增文件

无

### 删除文件

无

---

## 具体代码变更

### 1. `packages/orchestrator/internal/agent/adapter.go`

在 `AgentRequest` 结构体中新增 Timeout 字段：

```go
type AgentRequest struct {
    // ... 现有字段 ...
    Model           string         `json:"model"`
    OpsxConfig      *OpsxConfig    `json:"opsx,omitempty"`
    // Git repo cache
    WorktreePath    string         `json:"worktree_path,omitempty"`
    DepsPath        string         `json:"deps_path,omitempty"`
    // Task timeout from DSL
    Timeout         time.Duration  `json:"timeout,omitempty"`  // ← 新增
}
```

### 2. `packages/orchestrator/internal/engine/node_handlers.go`

在 `executeAgentTask()` 构建 `agentReq` 之前，解析 timeout：

```go
// Parse task timeout from DSL: NodeDef.Timeout > Config.Timeout > default (0 = adapter decides)
var taskTimeout time.Duration
timeoutStr := ""
if nodeDef.Timeout != "" {
    timeoutStr = nodeDef.Timeout
} else if nodeDef.Config != nil && nodeDef.Config.Timeout != "" {
    timeoutStr = nodeDef.Config.Timeout
}
if timeoutStr != "" {
    if parsed, err := time.ParseDuration(timeoutStr); err == nil {
        taskTimeout = parsed
        e.logger.Infow("Parsed task timeout from DSL", "timeout", timeoutStr, "duration", parsed)
    } else {
        e.logger.Warnw("Failed to parse task timeout, using default", "timeout", timeoutStr, "error", err)
    }
}
```

在 `agentReq` 赋值中新增：

```go
agentReq := &agent.AgentRequest{
    // ... 现有字段 ...
    Timeout:         taskTimeout,  // ← 新增
}
```

### 3. 三个适配器的 `BuildRequest()` 方法

以 `claude_adapter.go` 为例（droid、codex 同理）：

```go
// 3. Build executor request
timeout := req.Timeout
if timeout == 0 {
    timeout = 10 * time.Minute
}
return &ExecutorRequest{
    Image:        a.image,
    Command:      nil,
    Env:          env,
    WorkDir:      "/workspace",
    Timeout:      timeout,       // ← 修改（原为 10 * time.Minute）
    WorktreePath: req.WorktreePath,
    DepsPath:     req.DepsPath,
}, nil
```

---

## 测试策略

- 手动验证：DSL 配置 `timeout: "30m"` → 确认容器日志显示 30 分钟超时
- 手动验证：DSL 不配置 timeout → 确认仍使用 10 分钟默认值
- 手动验证：DSL 配置 `timeout: "invalid"` → 确认 warn 日志 + 回退 10 分钟
- 手动验证：DSL 同时配置 NodeDef.Timeout 和 Config.Timeout → 确认 NodeDef 优先
