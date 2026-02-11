# Phase 4 实施方案：真实 Agent 调用

> **日期**: 2026-02-12
> **状态**: 已实施
> **前置条件**: Phase 3（流程引擎 + Mock Agent）已完成

---

## 1. 概述

### 1.1 目标

将 Phase 3 的 Mock Agent 替换为真实的容器化 Agent 调用，实现：

- 通过 Docker 容器运行 ClaudeCode CLI 执行任务
- 容器内通过 Git 交互读写代码仓库
- 支持自定义 API 端点和认证方式
- 优雅降级：Docker 不可用时自动回退到 Mock

### 1.2 架构决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Adapter 架构 | TypeAdapter + Executor 两层分离 | 语义与运行解耦，支持灵活组合 |
| 首个 Agent | ClaudeCode CLI | 项目核心 Agent |
| 运行方式 | Docker 容器化 | 资源隔离，环境一致 |
| CLI 交互 | `claude -p "..." --output-format json` | 单次调用，输出结构化 |
| Prompt 策略 | 角色 prompt + DSL 模板 + 上游输出 + 反馈 | 完整上下文传递 |
| 文件交互 | Git clone → 执行 → push | 版本可追溯 |
| 容器生命周期 | 每节点启动/销毁 | 隔离性最强 |

### 1.3 实现范围

```
packages/orchestrator/internal/agent/
├── adapter.go           # 重构：新增 TypeAdapter / Executor / CombinedAdapter
├── mock_adapter.go      # 保留：Mock 实现不变
├── executor.go          # 新增：DockerExecutor
├── claude_adapter.go    # 新增：ClaudeCode TypeAdapter
└── prompt_builder.go    # 新增：Prompt 组合构建器

docker/agent-claude/
├── Dockerfile           # 新增：ClaudeCode Agent 镜像
├── entrypoint.sh        # 新增：容器入口脚本
└── README.md            # 新增：镜像使用说明
```

---

## 2. 架构设计

### 2.1 两层架构

```
┌─────────────────────────────────────────────────────┐
│                   Orchestrator Worker                │
│                                                     │
│  executeAgentTask()                                 │
│       │                                             │
│       ▼                                             │
│  AgentRegistry.GetAdapter(role)                     │
│       │                                             │
│       ▼                                             │
│  ┌─────────────────────────────────────────────┐    │
│  │         Adapter 接口 (Name + Execute)        │    │
│  │                                             │    │
│  │  ┌─────────────┐    ┌───────────────────┐   │    │
│  │  │ MockAdapter  │    │ CombinedAdapter   │   │    │
│  │  │ (直接实现)   │    │                   │   │    │
│  │  └─────────────┘    │  TypeAdapter       │   │    │
│  │                     │  ┌───────────────┐ │   │    │
│  │                     │  │ClaudeCode     │ │   │    │
│  │                     │  │ BuildRequest  │ │   │    │
│  │                     │  │ ParseResponse │ │   │    │
│  │                     │  └───────┬───────┘ │   │    │
│  │                     │          │         │   │    │
│  │                     │  Executor│         │   │    │
│  │                     │  ┌───────▼───────┐ │   │    │
│  │                     │  │DockerExecutor │ │   │    │
│  │                     │  │ Create → Start│ │   │    │
│  │                     │  │ Wait → Logs   │ │   │    │
│  │                     │  │ Remove        │ │   │    │
│  │                     │  └───────────────┘ │   │    │
│  │                     └───────────────────┘   │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
1. Worker 获取 QUEUED 的 agent_task NodeRun
2. 从 DSL 解析节点配置（role, mode, prompt_template）
3. 从 DB 获取 Git 信息（project.git_repo_url, task.git_branch）
4. Registry 根据 role 选择 Adapter
5. CombinedAdapter:
   a. TypeAdapter.BuildRequest() → 构建 prompt + 环境变量
   b. Executor.Execute() → Docker 容器执行
   c. TypeAdapter.ParseResponse() → 解析 JSON 输出
6. 保存 output → 标记 COMPLETED → advanceDAG
```

### 2.3 降级策略

```
启动时检测:
  Docker 可用?
    ├─ 否 → 所有角色映射到 MockAdapter
    └─ 是 → ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN 存在?
              ├─ 否 → 所有角色映射到 MockAdapter
              └─ 是 → 所有角色映射到 ClaudeCode CombinedAdapter
```

---

## 3. 核心组件详解

### 3.1 接口定义 (`adapter.go`)

```go
// Adapter — 顶层接口（向后兼容，MockAdapter 直接实现）
type Adapter interface {
    Name() string
    Execute(ctx context.Context, req *AgentRequest) (*AgentResponse, error)
}

// TypeAdapter — 语义层：构建 prompt、解析输出
type TypeAdapter interface {
    Name() string
    BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error)
    ParseResponse(execResp *ExecutorResponse) (*AgentResponse, error)
}

// Executor — 运行层：实际执行 Agent
type Executor interface {
    Kind() string  // "docker" / "cli" / "http"
    Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error)
}

// CombinedAdapter — 桥接 TypeAdapter + Executor → Adapter
type CombinedAdapter struct {
    typeAdapter TypeAdapter
    executor    Executor
}
```

`AgentRequest` 扩展了以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `GitRepoURL` | string | 项目 Git 仓库地址 |
| `RolePrompt` | string | 角色 system prompt |
| `Feedback` | string | 打回反馈内容 |

### 3.2 DockerExecutor (`executor.go`)

通过 Docker SDK (`github.com/docker/docker/client`) 管理容器生命周期：

```
Create Container → Start → Wait (with timeout) → Collect Logs → Remove
```

关键特性：
- **镜像自动拉取**：本地不存在时自动 `docker pull`
- **超时控制**：默认 10 分钟，超时后 `SIGKILL` 容器
- **强制清理**：`defer` 确保容器始终被删除
- **日志分离**：stdout/stderr 分别收集

### 3.3 ClaudeCodeAdapter (`claude_adapter.go`)

语义层实现：

- `BuildRequest()`: 用 PromptBuilder 组合完整 prompt，构建容器环境变量
- `ParseResponse()`: 解析 `claude --output-format json` 的 JSON 输出，提取 result/summary/changed_files/metrics

输出解析支持两种情况：
1. 标准 JSON → 结构化提取
2. 非 JSON → 包装为 `{result: raw_text, raw: true}`

### 3.4 PromptBuilder (`prompt_builder.go`)

Prompt 由 5 部分组合：

```
┌─────────────────────────────────┐
│ 1. 角色 System Prompt           │  ← DefaultRolePrompts 或自定义
├─────────────────────────────────┤
│ 2. 任务说明 (DSL prompt_template)│  ← 节点配置
├─────────────────────────────────┤
│ 3. 上游节点输出                  │  ← JSON 格式，过滤 _ 前缀字段
├─────────────────────────────────┤
│ 4. 人工反馈                      │  ← reject 场景注入
├─────────────────────────────────┤
│ 5. 模式指令                      │  ← spec/execute/review 不同指令
└─────────────────────────────────┘
```

内置角色 prompt：

| 角色 | 说明 |
|------|------|
| `requirement-analyst` | 需求分析师 |
| `general-developer` | 全栈开发工程师 |
| `code-reviewer` | 代码审查员 |
| `qa-engineer` | QA 工程师 |

### 3.5 Docker Agent 镜像 (`docker/agent-claude/`)

**Dockerfile** 基于 `node:22-slim`：
- 安装 `@anthropic-ai/claude-code` CLI
- 安装 `git`、`ca-certificates`、`curl`
- 创建 `/workspace` 和 `/output` 目录

**entrypoint.sh** 执行流程：

```
1. git clone $GIT_REPO_URL --branch $GIT_BRANCH /workspace
2. cd /workspace
3. claude -p "$AGENT_PROMPT" --output-format json > /output/result.json
4. (execute 模式) git add -A && git commit && git push
5. cat /output/result.json  → stdout
```

---

## 4. 容器化执行流程

### 4.1 完整时序

```
Orchestrator                    Docker Daemon                Container
    │                               │                          │
    │ ContainerCreate(image, env)   │                          │
    │──────────────────────────────>│                          │
    │                               │ Create container         │
    │<──────────────────────────────│                          │
    │                               │                          │
    │ ContainerStart(id)            │                          │
    │──────────────────────────────>│ Start                    │
    │                               │─────────────────────────>│
    │                               │                          │ git clone
    │                               │                          │ claude -p ...
    │ ContainerWait(id)             │                          │ git push
    │──────────────────────────────>│                          │
    │                               │<─────────────────────────│ exit
    │<──────────────────────────────│                          │
    │                               │                          │
    │ ContainerLogs(id)             │                          │
    │──────────────────────────────>│                          │
    │<──────────────────────────────│ stdout + stderr          │
    │                               │                          │
    │ ContainerRemove(id, force)    │                          │
    │──────────────────────────────>│ Remove                   │
    │<──────────────────────────────│                          │
```

### 4.2 超时处理

```go
// 默认 10 分钟超时
execCtx, cancel := context.WithTimeout(ctx, timeout)
defer cancel()

select {
case status := <-statusCh:    // 正常完成
case err := <-errCh:          // Docker 错误
case <-execCtx.Done():        // 超时 → SIGKILL → 返回错误
}
```

### 4.3 错误处理

| 场景 | 处理方式 |
|------|---------|
| Docker 不可用 | 启动时降级到 Mock |
| 镜像不存在 | 自动 pull |
| 容器创建失败 | 返回错误，NodeRun 标记 FAILED |
| 执行超时 | SIGKILL 容器，返回超时错误 |
| 非零退出码 | 返回错误，包含 stderr |
| 输出非 JSON | 包装为 raw 输出，不报错 |
| 容器删除失败 | 仅 warn 日志，不影响结果 |

---

## 5. 配置说明

### 5.1 环境变量

在 `packages/orchestrator/.env` 中配置：

```env
# ─── 必需 ───
DATABASE_URL=postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev
GRPC_PORT=50051

# ─── Agent 配置（至少设置 API_KEY 或 AUTH_TOKEN 之一） ───
# 方式一：直接使用 Anthropic API
ANTHROPIC_API_KEY=<your-anthropic-api-key>

# 方式二：使用自定义端点 + Token（代理场景）
ANTHROPIC_BASE_URL=https://your-proxy.example.com
ANTHROPIC_AUTH_TOKEN=<your-auth-token>

# ─── 可选 ───
AGENT_DOCKER_IMAGE=workgear/agent-claude:latest   # Agent 镜像名
CLAUDE_MODEL=claude-sonnet-3.5                     # 默认模型
```

### 5.2 环境变量详解

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `ANTHROPIC_API_KEY` | 二选一* | - | Anthropic API Key |
| `ANTHROPIC_AUTH_TOKEN` | 二选一* | - | 替代认证 Token |
| `ANTHROPIC_BASE_URL` | 否 | Anthropic 官方 | 自定义 API 端点 |
| `AGENT_DOCKER_IMAGE` | 否 | `workgear/agent-claude:latest` | Agent Docker 镜像 |
| `CLAUDE_MODEL` | 否 | `claude-sonnet-3.5` | Claude 模型选择 |

\* `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN` 至少设置一个才会启用真实 Agent。

### 5.3 启用条件

Orchestrator 启动时按以下逻辑决定 Agent 模式：

```
1. 尝试连接 Docker daemon
   → 失败：所有角色 → MockAdapter，日志 WARN
   → 成功：继续

2. 检查 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN
   → 都为空：所有角色 → MockAdapter，日志 WARN
   → 任一存在：所有角色 → ClaudeCode CombinedAdapter，日志 INFO
```

MockAdapter 始终注册为 fallback。

---

## 6. 使用指南

### 6.1 构建 Agent 镜像

```bash
cd docker/agent-claude
docker build -t workgear/agent-claude:latest .
```

### 6.2 配置环境变量

```bash
# 编辑 Orchestrator 环境变量
vim packages/orchestrator/.env

# 至少配置以下之一：
# ANTHROPIC_API_KEY=<your-anthropic-api-key>
# 或
# ANTHROPIC_BASE_URL=https://your-proxy.example.com
# ANTHROPIC_AUTH_TOKEN=<your-auth-token>
```

### 6.3 启动服务

```bash
# 启动所有服务
pnpm dev

# 或单独启动 Orchestrator
pnpm run dev:orchestrator
```

### 6.4 验证 Agent 模式

启动日志中会显示当前模式：

```
# 真实 Agent 模式
INFO  ClaudeCode adapter enabled (Docker + ANTHROPIC_API_KEY)
INFO  Phase 4: Persistent state machine + Docker agent support

# Mock 模式（Docker 不可用）
WARN  Docker not available, using mock adapter only

# Mock 模式（无 API Key）
WARN  ANTHROPIC_API_KEY not set, using mock adapter
```

### 6.5 触发 Agent 执行

1. 在前端创建 Task，选择 Workflow 模板
2. 启动 FlowRun
3. 当流程到达 `agent_task` 节点时，Orchestrator 会：
   - 启动 Docker 容器
   - 注入 prompt 和环境变量
   - 等待执行完成
   - 解析输出并推进 DAG

### 6.6 查看执行日志

```
# Orchestrator 日志会显示：
INFO  Executing agent task  node_id=analyze_requirement  role=requirement-analyst  adapter=claude-code
INFO  Creating agent container  image=workgear/agent-claude:latest  timeout=10m0s
INFO  Started agent container  container_id=a1b2c3d4e5f6
INFO  Agent container finished  container_id=a1b2c3d4e5f6  exit_code=0  stdout_len=4523
INFO  Removed agent container  container_id=a1b2c3d4e5f6
```

---

## 7. Prompt 构建策略

### 7.1 组合结构

以 `requirement-analyst` 角色、`spec` 模式、有打回反馈为例：

```
你是一个资深的需求分析师。你的职责是：
1. 深入理解用户需求
2. 分析项目代码结构和上下文
3. 将需求拆分为可独立执行的子任务
4. 评估每个子任务的复杂度和依赖关系
请用中文输出结构化的分析结果。

---
## 任务说明
你是一个需求分析师。请分析以下需求并输出 PRD：

需求描述：实现用户登录功能
优先级：P1

请输出：
1. 需求理解摘要
2. 功能点列表
3. 技术方案建议
4. 风险评估

---
## 上游节点输出
{
  "requirement_text": "实现用户登录功能",
  "priority": "P1"
}

---
## 人工反馈（请根据以下反馈修改）
需要补充 OAuth2 第三方登录的支持

---
## 输出要求
当前模式：规划（spec）
请输出详细的实施方案，包括：
- 实现思路和步骤
- 涉及的文件列表
- 预估工作量
- 风险评估
不要直接修改代码。
```

### 7.2 自定义角色 Prompt

```go
promptBuilder := agent.NewPromptBuilder()
promptBuilder.SetRolePrompt("my-custom-role", "你是一个...")
```

---

## 8. Git 认证配置

容器内需要访问 Git 仓库，需配置认证方式。

### 8.1 HTTPS + Token（推荐）

在项目的 `git_repo_url` 中包含 token：

```
https://<token>@github.com/user/repo.git
```

### 8.2 SSH Key

需要修改 DockerExecutor 挂载 SSH key（当前未实现，后续扩展）：

```go
// 未来扩展：HostConfig 中添加 Binds
hostConfig := &container.HostConfig{
    Binds: []string{
        os.Getenv("HOME") + "/.ssh:/root/.ssh:ro",
    },
}
```

### 8.3 容器内 Git 配置

entrypoint.sh 自动配置：

```bash
git config --global user.email "agent@workgear.dev"
git config --global user.name "WorkGear Agent"
```

---

## 9. 故障排查

### 9.1 Docker 连接失败

```
WARN  Docker not available, using mock adapter only
```

**原因**：Docker daemon 未运行或无权限

**解决**：
```bash
# 检查 Docker 是否运行
docker info

# macOS：启动 Docker Desktop
# Linux：sudo systemctl start docker
```

### 9.2 镜像不存在

```
ERROR ensure image workgear/agent-claude:latest: pull image: ...
```

**解决**：
```bash
cd docker/agent-claude
docker build -t workgear/agent-claude:latest .
```

### 9.3 容器执行超时

```
ERROR container execution timed out after 10m0s
```

**原因**：Agent 执行时间超过 10 分钟

**解决**：检查 prompt 复杂度，或在代码中调整 `Timeout` 值

### 9.4 Claude API 错误

```
ERROR claude execution failed (exit code 1): Authentication failed
```

**解决**：
- 检查 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 是否正确
- 检查 `ANTHROPIC_BASE_URL` 是否可达
- 在容器外测试：`claude -p "hello" --output-format json`

### 9.5 Git 认证失败

```
[agent] Failed to clone branch main, trying default branch...
fatal: Authentication failed
```

**解决**：
- 确认 `git_repo_url` 包含有效的认证信息
- 使用 HTTPS + Token 方式：`https://token@github.com/user/repo.git`

---

## 10. 扩展性设计

### 10.1 新增 Agent 类型

实现 `TypeAdapter` 接口即可：

```go
// internal/agent/codex_adapter.go
type CodexAdapter struct { ... }

func (a *CodexAdapter) Name() string { return "codex" }
func (a *CodexAdapter) BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error) { ... }
func (a *CodexAdapter) ParseResponse(resp *ExecutorResponse) (*AgentResponse, error) { ... }

// 注册
codexAdapter := agent.NewCombinedAdapter(
    NewCodexAdapter(...),
    dockerExec,  // 复用同一个 DockerExecutor
)
registry.Register(codexAdapter)
registry.MapRole("some-role", "codex")
```

### 10.2 新增 Executor 类型

实现 `Executor` 接口：

```go
// CLIExecutor — 本地子进程执行
type CLIExecutor struct { ... }
func (e *CLIExecutor) Kind() string { return "cli" }
func (e *CLIExecutor) Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error) { ... }

// HTTPExecutor — HTTP API 调用
type HTTPExecutor struct { ... }
func (e *HTTPExecutor) Kind() string { return "http" }
func (e *HTTPExecutor) Execute(ctx context.Context, req *ExecutorRequest) (*ExecutorResponse, error) { ... }
```

### 10.3 组合示例

```go
// ClaudeCode + Docker（当前实现）
agent.NewCombinedAdapter(claudeAdapter, dockerExec)

// ClaudeCode + 本地 CLI（未来桌面端）
agent.NewCombinedAdapter(claudeAdapter, cliExec)

// Codex + HTTP（未来远程调用）
agent.NewCombinedAdapter(codexAdapter, httpExec)
```

---

## 11. 性能与资源

### 11.1 容器资源限制

当前未设置资源限制。后续可通过 `HostConfig` 配置：

```go
hostConfig := &container.HostConfig{
    Resources: container.Resources{
        Memory:   2 * 1024 * 1024 * 1024, // 2GB
        NanoCPUs: 2 * 1e9,                // 2 CPU
    },
}
```

### 11.2 并发控制

当前 Worker 单线程轮询，同一时刻只有一个 agent_task 在执行。后续可通过增加 Worker 数量实现并发。

### 11.3 镜像缓存

DockerExecutor 在执行前检查本地镜像：
- 存在 → 直接使用
- 不存在 → 自动 pull

首次执行会较慢（需要拉取镜像），后续执行使用本地缓存。

---

## 12. 安全考虑

### 12.1 API Key 传递

- API Key 通过环境变量注入容器，不写入文件
- `.env` 文件已在 `.gitignore` 中，不会提交到仓库
- 容器销毁后环境变量随之消失

### 12.2 容器隔离

- 每个 agent_task 使用独立容器
- 容器无特权模式
- 容器执行完毕后强制删除

### 12.3 Git 凭证

- 建议使用短期 Token 而非长期密码
- Token 通过 URL 传递，不持久化到容器文件系统
- 容器销毁后凭证消失

### 12.4 日志安全

- Orchestrator 日志不输出 prompt 全文和 API Key
- 仅记录 stdout/stderr 长度，不记录内容
- 容器名包含 task ID 便于审计追踪
