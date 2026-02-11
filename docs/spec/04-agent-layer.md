# 4. Agent接入层

## 4.1 Agent Adapter 接口

所有Agent通过统一的Adapter接口接入，实现可扩展：

```go
// Go - Orchestrator 侧的 Agent 接口定义
package agent

type AgentAdapter interface {
    // 基础信息
    Name() string
    Version() string
    Capabilities() []Capability  // 支持的能力：code, review, test, plan...

    // 生命周期
    Init(config AgentConfig) error
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
    HealthCheck(ctx context.Context) (*HealthStatus, error)

    // 核心交互
    Execute(ctx context.Context, request *TaskRequest) (*TaskResponse, error)
    Stream(ctx context.Context, request *TaskRequest) (<-chan *StreamEvent, error)

    // 会话管理（支持多轮对话）
    CreateSession(ctx context.Context, opts *SessionOpts) (string, error)
    SendMessage(ctx context.Context, sessionID string, msg *Message) (*Message, error)
    CloseSession(ctx context.Context, sessionID string) error
}

type TaskRequest struct {
    TaskID        string
    FlowRunID     string
    NodeID        string
    AgentRole     string          // 目标 Agent 角色
    Mode          TaskMode        // spec / execute / review
    Prompt        string
    Context       map[string]any  // 上游节点输出、变量等
    WorkDir       string          // 工作目录（Git仓库路径）
    GitBranch     string
    Constraints   *Constraints    // 超时、token限制等
    PreviousFeedback string       // 打回时的反馈
    IdempotencyKey   string       // 幂等键（P1-3 新增）
}

type TaskResponse struct {
    Status    TaskStatus
    Output    map[string]any
    Artifacts []Artifact         // 产出物：文件变更、报告等
    Metrics   *ExecutionMetrics  // token用量、耗时等
    Logs      []LogEntry
}

type StreamEvent struct {
    Type    string  // "thinking" / "output" / "tool_use" / "error" / "done"
    Content string
    Data    map[string]any
}

type TaskMode string
const (
    ModeSpec    TaskMode = "spec"
    ModeExecute TaskMode = "execute"
    ModeReview  TaskMode = "review"
)
```

## 4.2 ClaudeCode Adapter

```go
// ClaudeCode 通过 CLI 子进程方式接入
type ClaudeCodeAdapter struct {
    binaryPath string
    sessions   map[string]*ClaudeCodeSession
}

// ClaudeCode 的执行方式：
// 1. 启动 claude 子进程
// 2. 通过 stdin/stdout 进行交互
// 3. 解析输出流获取实时状态
// 4. 监控文件系统变更作为产出物

func (a *ClaudeCodeAdapter) Execute(ctx context.Context, req *TaskRequest) (*TaskResponse, error) {
    // 1. 构建命令
    args := []string{
        "--project-dir", req.WorkDir,
        "--output-format", "json",
    }
    if req.Mode == ModeSpec {
        args = append(args, "--spec-mode")
    }

    // 2. 启动子进程
    cmd := exec.CommandContext(ctx, a.binaryPath, args...)
    stdin, _ := cmd.StdinPipe()
    stdout, _ := cmd.StdoutPipe()

    // 3. 发送prompt
    stdin.Write([]byte(req.Prompt))

    // 4. 流式读取输出并解析
    // 5. 收集文件变更
    // 6. 返回结构化结果
}
```

## 4.3 Kiro Droid Adapter

```go
// Kiro Droid 通过 CLI + 配置文件方式接入
type KiroDroidAdapter struct {
    binaryPath string
    configDir  string
}

// Droid 的执行方式：
// 1. 生成 droid 配置文件（.kiro/droid.yaml）
// 2. 启动 kiro droid 子进程
// 3. 通过 stdout 流式获取进度
// 4. 读取产出物
```

## 4.4 Human Agent（人工节点）

```go
// 人工节点不是真正的Agent，而是暂停流程等待人工操作
type HumanAgentAdapter struct {
    notifier NotificationService
}

func (a *HumanAgentAdapter) Execute(ctx context.Context, req *TaskRequest) (*TaskResponse, error) {
    // 1. 创建人工任务记录
    // 2. 通过 WebSocket 推送通知到前端
    // 3. 发送外部通知（邮件/Slack/钉钉）
    // 4. 阻塞等待人工操作完成（或超时）
    // 5. 收集人工输入作为输出返回
}
```

## 4.5 自定义Agent接入

支持通过HTTP/gRPC协议接入自定义Agent：

```yaml
# custom-agent.yaml
name: "my-custom-agent"
type: http
endpoint: "http://localhost:8080/agent"
capabilities: [code, review]
auth:
  type: bearer
  token_env: "MY_AGENT_TOKEN"
health_check:
  path: /health
  interval: 30s
timeout: 600s
retry:
  max_attempts: 3
```

## 4.6 Agent Registry

```go
// Agent注册中心：管理所有可用Agent实例
type AgentRegistry struct {
    adapters   map[string]AgentAdapter
    instances  map[string][]*AgentInstance  // role -> instances
    scheduler  AgentScheduler
}

// 对外统一接口：选择合适的 Agent 实例
func (r *AgentRegistry) SelectAgent(ctx context.Context, req *TaskRequest, candidates []*AgentInstance) (*AgentInstance, error) {
    // 内部委托给 Scheduler
    return r.scheduler.Select(ctx, req, candidates)
}

// Agent调度策略
type AgentScheduler interface {
    // 根据任务需求选择最合适的Agent实例
    Select(ctx context.Context, req *TaskRequest, candidates []*AgentInstance) (*AgentInstance, error)
}

// 内置调度策略：
// - RoundRobin：轮询
// - LeastBusy：最空闲优先
// - Capability：能力匹配优先
// - Priority：优先级调度
// - CostAware：成本预算感知（P1 新增）
// - LatencyAware：时延 SLA 感知（P1 新增）
// - QualityAware：按历史质量评分分配（P1 新增）
```

## 4.7 多 Agent 协同协议（P0-3 新增）

### 4.7.1 协同上下文策略

定义协同任务中 Agent 之间的数据可见性：

```go
type SharedContextPolicy struct {
    // 所有 Agent 可读的字段（从上游节点输出中选取）
    Readable []string `yaml:"readable"`
    // 可写字段（各 Agent 独立写，不共享中间结果）
    Writable []string `yaml:"writable"`
    // 是否允许 Agent 看到其他 Agent 的输出（debate 模式需要）
    CrossVisible bool `yaml:"cross_visible"`
}
```

### 4.7.2 产出归属（Attribution）

记录每段产出的来源 Agent，支持追责与回放：

```go
type Attribution struct {
    NodeRunID   string
    AgentRole   string
    AgentID     string
    OutputHash  string         // 输出内容 hash，用于去重
    Output      map[string]any
    Metrics     *ExecutionMetrics
    CreatedAt   time.Time
}

// 存储在 node_run_attributions 表中
// 供 adjudicate 节点和审计日志使用
```

### 4.7.3 冲突解决策略

当多个 Agent 产出存在冲突时的处理：

```go
type ConflictResolutionPolicy struct {
    // 自动解决策略
    Auto string `yaml:"auto"` // latest | highest_weight | highest_score | merge
    // 无法自动解决时的降级
    Fallback string `yaml:"fallback"` // human_review | lead_decides
}
```

### 4.7.4 协同模式详解

**parallel_draft（并行草拟 + 仲裁）**
```
Input ──→ Agent A ──→ Output A ──┐
      ──→ Agent B ──→ Output B ──├──→ Adjudicate ──→ Best Output
      ──→ Agent C ──→ Output C ──┘
```
- 适用场景：PRD 起草、方案设计等创造性任务
- 优点：多视角，质量上限高
- 缺点：成本 = N × 单次成本

**lead_review（主执笔 + 审稿人）**
```
Input ──→ Lead Agent ──→ Draft ──→ Reviewer A ──→ Feedback ──┐
                                  Reviewer B ──→ Feedback ──├──→ Lead Agent ──→ Final
                                                            │    (可循环 N 轮)
```
- 适用场景：代码编写、文档完善
- 优点：成本可控，主线清晰
- 缺点：质量依赖 Lead Agent

**debate（辩论式协作）**
```
Round 1: Agent A 提案 ──→ Agent B 评审 ──→ Agent A 反驳
Round 2: Agent B 提案 ──→ Agent A 评审 ──→ Agent B 反驳
...
Judge Agent ──→ 最终裁决
```
- 适用场景：高风险决策、架构选型
- 优点：深度论证
- 缺点：成本高，耗时长

## 4.7 Agent 角色模板

预定义常用角色，用户也可自定义：

```yaml
# roles/requirement-analyst.yaml
role: requirement-analyst
name: "需求分析师"
description: "分析需求，理解项目上下文，拆分子任务"
default_agent: claude-code
default_model: claude-sonnet
system_prompt: |
  你是一个资深的需求分析师。你的职责是：
  1. 深入理解用户需求
  2. 分析项目代码结构和上下文
  3. 将需求拆分为可独立执行的子任务
  4. 评估每个子任务的复杂度和依赖关系
capabilities_required: [code_understanding, planning]

---
# roles/code-reviewer.yaml
role: code-reviewer
name: "代码审查员"
description: "Review代码变更，检查质量和规范"
default_agent: claude-code
default_model: claude-opus
system_prompt: |
  你是一个严格的代码审查员。请关注：
  1. 代码质量和可维护性
  2. 潜在的bug和安全问题
  3. 性能问题
  4. 是否符合项目规范
  5. 测试覆盖率
capabilities_required: [code_review]
```

## 4.8 执行器分层（Type Adapter + Runtime Executor）

将"Agent 类型"与"运行通道"拆成两层，支持灵活组合：

- **Type Adapter**（语义层）：负责构建 prompt、解析输出（ClaudeCodeAdapter / CodexAdapter）
- **Runtime Executor**（通道层）：负责实际通信（CLIExecutor / HTTPExecutor / GRPCExecutor）

```go
// 执行器接口（通道层）
type Executor interface {
    Kind() string  // cli / http / grpc
    Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error)
    Stream(ctx context.Context, req *ExecutorRequest) (<-chan *StreamEvent, error)
}

type ExecutorRequest struct {
    Command string            // CLI 命令（cli 模式）
    Args    []string          // CLI 参数
    Stdin   string            // 标准输入
    Env     map[string]string // 环境变量
    URL     string            // HTTP/gRPC 端点（remote 模式）
    Body    []byte            // HTTP 请求体
    Timeout time.Duration
}

type ExecutorResponse struct {
    ExitCode int
    Stdout   string
    Stderr   string
    Body     []byte            // HTTP 响应体
}
```

支持的组合：

| Agent 类型 | 运行通道 | 场景 |
|-----------|---------|------|
| claude-code + CLI | 本地/容器 | 桌面端本地执行 |
| claude-code + gRPC | 远程 | 云端调度 |
| codex + CLI | 本地/容器 | 桌面端本地执行 |
| codex + HTTP | 远程 | 云端 API 调用 |

## 4.9 Codex Adapter

```go
// internal/agent/codex_adapter.go
type CodexAdapter struct {
    executor Executor
    config   *CodexConfig
}

func (a *CodexAdapter) Name() string { return "codex" }

func (a *CodexAdapter) Capabilities() []Capability {
    return []Capability{Planning, Coding, Review}
}

func (a *CodexAdapter) Execute(ctx context.Context, req *TaskRequest) (*TaskResponse, error) {
    execReq := a.BuildRequest(req)
    execResp, err := a.executor.Execute(ctx, execReq)
    if err != nil {
        return nil, err
    }
    return a.ParseResponse(execResp)
}

func (a *CodexAdapter) Stream(ctx context.Context, req *TaskRequest) (<-chan *StreamEvent, error) {
    execReq := a.BuildRequest(req)
    return a.executor.Stream(ctx, execReq)
}

func (a *CodexAdapter) BuildRequest(req *TaskRequest) *ExecutorRequest {
    switch a.executor.Kind() {
    case "cli":
        return &ExecutorRequest{
            Command: "codex",
            Args:    []string{"execute", "--mode", string(req.Mode)},
            Stdin:   buildCodexPrompt(req),
            Env:     buildEnv(req),
        }
    case "http":
        // endpoint 只配基址，代码追加路径
        return &ExecutorRequest{
            URL:  a.config.Endpoint + "/execute",
            Body: marshalCodexHTTPRequest(req),
        }
    default:
        return nil
    }
}

func (a *CodexAdapter) ParseResponse(resp *ExecutorResponse) (*TaskResponse, error) {
    // 统一解析为 TaskResponse，屏蔽厂商差异
    var result CodexOutput
    json.Unmarshal([]byte(resp.Stdout), &result)
    return &TaskResponse{
        Status:    mapCodexStatus(result.Status),
        Output:    result.Output,
        Artifacts: mapCodexArtifacts(result.Files),
        Metrics:   &ExecutionMetrics{TokenInput: result.TokensIn, TokenOutput: result.TokensOut},
    }, nil
}
```

配置示例：

```yaml
# Codex 远程模式
name: "codex-main"
agent_type: "codex"
runtime: "remote"
execution_domain: "cloud"
executor:
  kind: "http"
  endpoint: "http://codex-runtime.internal"  # 只配基址，不含 /execute
capabilities: [planning, coding, review]
roles: [general-developer, code-reviewer]
max_concurrent: 3
timeout_seconds: 900

# Codex 本地模式（桌面端）
name: "codex-local"
agent_type: "codex"
runtime: "local"
execution_domain: "local"
visibility_scope: "desktop_only"
executor:
  kind: "cli"
  command: "codex"
capabilities: [planning, coding, review]
roles: [general-developer]
max_concurrent: 1
```
