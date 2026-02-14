# OpenSpec 集成技术架构文档

> 本文档面向 WorkGear 开发者，介绍 OpenSpec 集成的技术实现、代码结构和扩展方式。

---

## 目录

- [架构概览](#架构概览)
- [代码变更清单](#代码变更清单)
- [Docker 层](#docker-层)
- [Go Orchestrator 层](#go-orchestrator-层)
- [API 层](#api-层)
- [前端层](#前端层)
- [流程模板](#流程模板)
- [数据流时序](#数据流时序)
- [扩展指南](#扩展指南)

---

## 架构概览

OpenSpec 集成采用两层架构：

```
┌─────────────────────────────────────────────────────────────┐
│ WorkGear 流程引擎（宏观编排）                                │
│                                                             │
│  DSL YAML 定义 7 个节点的 DAG 流水线                         │
│  human_input → agent_task(opsx_plan) → human_review →       │
│  agent_task(opsx_apply) → agent_task(review) →              │
│  human_review → agent_task(archive)                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Docker Agent 容器（微观执行）                        │    │
│  │                                                     │    │
│  │  entrypoint.sh                                      │    │
│  │  ├── git clone 用户仓库                              │    │
│  │  ├── openspec init（首次）                           │    │
│  │  ├── claude -p "$AGENT_PROMPT"                       │    │
│  │  │   └── Agent 使用 OpenSpec CLI 操作 openspec/ 目录  │    │
│  │  ├── git commit (语义化 commit message)              │    │
│  │  └── git push                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  用户 Git 仓库: openspec/ 目录 = Source of Truth             │
└─────────────────────────────────────────────────────────────┘
```

关键设计决策：

| 决策 | 选择 | 理由 |
|------|------|------|
| Spec 存储 | Git 仓库 `openspec/` 目录 | 与代码同源，天然版本控制 |
| Agent 模式 | 新增 `opsx_plan` / `opsx_apply` | 语义清晰，与现有 mode 正交 |
| OpenSpec CLI | 预装在 Docker 镜像中 | Agent 可直接调用，无需运行时安装 |
| API 读取 Spec | shallow clone + git show | 无需持久化 clone，按需获取 |

---

## 代码变更清单

### 修改的文件

| 文件 | 变更内容 |
|------|---------|
| `docker/agent-claude/Dockerfile` | 新增 `npm install -g @fission-ai/openspec@latest` |
| `docker/agent-claude/entrypoint.sh` | 新增 Step 1.5 OpenSpec 初始化；重写 Step 3 支持 opsx 模式的语义化 commit |
| `packages/orchestrator/internal/agent/adapter.go` | 新增 `OpsxConfig` 结构体；`AgentRequest` 新增 `OpsxConfig` 字段 |
| `packages/orchestrator/internal/agent/claude_adapter.go` | `BuildRequest()` 注入 OPSX_* 环境变量 |
| `packages/orchestrator/internal/agent/prompt_builder.go` | 新增 `spec-architect` 角色 prompt；新增 `opsx_plan` / `opsx_apply` 模式指令 |
| `packages/orchestrator/internal/engine/dsl_parser.go` | `NodeConfigDef` 新增 `Opsx` / `ShowArtifacts` / `ArtifactPaths` 字段；新增 `OpsxConfigDef` 结构体 |
| `packages/orchestrator/internal/engine/node_handlers.go` | `executeAgentTask()` 解析 `OpsxConfig` 并传递给 `AgentRequest` |
| `packages/api/src/server.ts` | 注册 `openspecRoutes` |
| `packages/api/src/seeds/seed-templates.ts` | 注册 `openspec-dev-pipeline` 和 `openspec-init` 模板 |

### 新增的文件

| 文件 | 说明 |
|------|------|
| `packages/api/src/routes/openspec.ts` | OpenSpec API 路由（5 个端点） |
| `packages/api/src/seeds/templates/openspec-dev-pipeline.yaml` | Spec 驱动开发流水线模板 |
| `packages/api/src/seeds/templates/openspec-init.yaml` | OpenSpec 项目初始化模板 |
| `packages/web/src/components/spec-artifact-viewer.tsx` | 前端 Spec Artifact 查看器组件 |

---

## Docker 层

### Dockerfile 变更

在 `docker/agent-claude/Dockerfile` 中新增一行：

```dockerfile
# 安装 OpenSpec CLI globally
RUN npm install -g @fission-ai/openspec@latest
```

这确保 Agent 容器内可以直接使用 `openspec` 命令。

### entrypoint.sh 增强

#### Step 1.5：OpenSpec 初始化

在 git clone 之后、claude 执行之前，新增条件初始化：

```bash
if [ "$AGENT_MODE" = "opsx_plan" ] || [ "$AGENT_MODE" = "opsx_apply" ]; then
    if [ ! -d "openspec" ] && [ "$OPSX_INIT_IF_MISSING" = "true" ]; then
        openspec init --non-interactive
    fi
fi
```

仅在 opsx 模式下且仓库中不存在 `openspec/` 目录时执行初始化。

#### Step 3：语义化 Git Commit

根据 `AGENT_MODE` 生成不同的 commit message：

| AGENT_MODE | Commit Message 格式 |
|------------|-------------------|
| `opsx_plan` | `spec(<change-name>): generate OpenSpec artifacts` |
| `opsx_plan` + `OPSX_ACTION=archive` | `spec(<change-name>): archive OpenSpec change` |
| `opsx_apply` | `feat(<change-name>): implement tasks from OpenSpec` |
| `execute` | `agent(<node-id>): auto-commit from workflow` |

### 环境变量

Docker 容器接收的 OpenSpec 相关环境变量：

| 变量 | 来源 | 说明 |
|------|------|------|
| `AGENT_MODE` | `AgentRequest.Mode` | `opsx_plan` 或 `opsx_apply` |
| `OPSX_CHANGE_NAME` | `OpsxConfig.ChangeName` | OpenSpec change 名称 |
| `OPSX_SCHEMA` | `OpsxConfig.Schema` | Spec schema 类型（`spec-driven` / `rapid`） |
| `OPSX_INIT_IF_MISSING` | `OpsxConfig.InitIfMissing` | 是否自动初始化（`true` / `false`） |
| `OPSX_ACTION` | `OpsxConfig.Action` | 特殊动作（`archive` / `sync` / 空） |

---

## Go Orchestrator 层

### OpsxConfig 数据结构

在 `adapter.go` 中定义：

```go
// OpsxConfig holds OpenSpec-specific configuration for opsx_plan / opsx_apply modes
type OpsxConfig struct {
    ChangeName    string `json:"change_name" yaml:"change_name"`
    Schema        string `json:"schema,omitempty" yaml:"schema"`
    InitIfMissing bool   `json:"init_if_missing,omitempty" yaml:"init_if_missing"`
    Action        string `json:"action,omitempty" yaml:"action"` // "", "archive", "sync"
}
```

`AgentRequest` 新增可选字段：

```go
type AgentRequest struct {
    // ... 现有字段 ...
    OpsxConfig *OpsxConfig `json:"opsx,omitempty"`
}
```

### DSL Parser 扩展

在 `dsl_parser.go` 中，`NodeConfigDef` 新增三个字段：

```go
type NodeConfigDef struct {
    // ... 现有字段 ...
    Opsx          *OpsxConfigDef `yaml:"opsx"`
    ShowArtifacts bool           `yaml:"show_artifacts"`
    ArtifactPaths []string       `yaml:"artifact_paths"`
}

type OpsxConfigDef struct {
    ChangeName    string `yaml:"change_name"`
    Schema        string `yaml:"schema"`
    InitIfMissing bool   `yaml:"init_if_missing"`
    Action        string `yaml:"action"`
}
```

`OpsxConfigDef` 是 DSL 层的定义，`OpsxConfig` 是 Agent 层的运行时结构。两者字段一致，但分属不同 package，保持关注点分离。

### node_handlers.go 中的 OpsxConfig 解析

在 `executeAgentTask()` 中，构建 `AgentRequest` 后追加 OpsxConfig 解析：

```go
// Resolve OpenSpec config for opsx_plan / opsx_apply modes
if nodeDef.Config != nil && nodeDef.Config.Opsx != nil {
    opsxDef := nodeDef.Config.Opsx
    changeName := opsxDef.ChangeName
    // Render change_name template expression
    if rendered, err := RenderTemplate(changeName, runtimeCtx); err == nil {
        changeName = rendered
    }
    agentReq.OpsxConfig = &agent.OpsxConfig{
        ChangeName:    changeName,
        Schema:        opsxDef.Schema,
        InitIfMissing: opsxDef.InitIfMissing,
        Action:        opsxDef.Action,
    }
}
```

`change_name` 支持模板表达式（如 `{{nodes.submit_requirement.outputs.change_name}}`），在运行时通过 pongo2 渲染。

### ClaudeCodeAdapter 环境变量注入

在 `claude_adapter.go` 的 `BuildRequest()` 中：

```go
// OpenSpec configuration (opsx_plan / opsx_apply modes)
if req.Mode == "opsx_plan" || req.Mode == "opsx_apply" {
    if opsx := req.OpsxConfig; opsx != nil {
        env["OPSX_CHANGE_NAME"] = opsx.ChangeName
        if opsx.Schema != "" {
            env["OPSX_SCHEMA"] = opsx.Schema
        }
        env["OPSX_INIT_IF_MISSING"] = strconv.FormatBool(opsx.InitIfMissing)
        if opsx.Action != "" {
            env["OPSX_ACTION"] = opsx.Action
        }
    }
}
```

仅在 opsx 模式下注入，不影响现有的 `spec` / `execute` / `review` 模式。

### PromptBuilder 新增内容

#### spec-architect 角色

```go
"spec-architect": `你是一个资深的 Spec 架构师，精通 OpenSpec 规范驱动开发（SDD）方法论。你的职责是：
1. 将需求转化为结构化的 OpenSpec 规划文档
2. 编写清晰的 proposal.md（为什么做、做什么、影响范围）
3. 使用 Given/When/Then 格式编写 delta specs（ADDED/MODIFIED/REMOVED）
4. 设计合理的技术方案（design.md）
5. 拆分可执行的任务清单（tasks.md）
6. 维护项目的 Spec Source of Truth
请确保所有产出符合 OpenSpec 目录结构规范。`
```

#### opsx_plan 模式指令

指导 Agent 按 OpenSpec 工作流生成规划文档，包含 `OPSX_ACTION=archive` 时的归档逻辑。

#### opsx_apply 模式指令

指导 Agent 读取 tasks.md / design.md / specs/ 并逐项实施，完成后标记 `[x]`。

---

## API 层

### 路由注册

在 `server.ts` 中：

```typescript
import { openspecRoutes } from './routes/openspec.js'
await app.register(openspecRoutes, { prefix: '/api/projects/:projectId/openspec' })
```

注意：路由挂载在 `/api/projects/:projectId/openspec` 下，`projectId` 作为路径参数传递。

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/changes` | 获取所有 change 名称列表 |
| GET | `/changes/:changeName` | 获取 change 下所有 artifact 文件和内容 |
| GET | `/changes/:changeName/artifacts/*` | 获取指定 artifact 文件内容 |
| GET | `/specs` | 获取 Source of Truth specs 文件列表和内容 |
| PUT | `/changes/:changeName/artifacts/*` | 更新 artifact 文件（编辑后 commit 回 Git） |

所有 GET 端点支持 `?branch=<branch>` 查询参数，默认 `main`。

### Git 操作实现

API 通过临时 shallow clone 读取 Git 仓库文件：

```
listGitFiles():
  1. git clone --depth 1 --no-checkout → 临时目录
  2. git ls-tree -r --name-only HEAD <path>
  3. 清理临时目录

getGitFileContent():
  1. git clone --depth 1 --no-checkout → 临时目录
  2. git show HEAD:<path>
  3. 清理临时目录

updateGitFile():
  1. git clone --depth 1 → 临时目录（需要 checkout）
  2. 写入文件
  3. git add + git commit + git push
  4. 清理临时目录
```

每次请求都是独立的 clone，无状态。临时目录使用 `os.tmpdir()` + `mkdtemp`，操作完成后 `rm -rf`。

> 性能说明：shallow clone (`--depth 1`) 只下载最新一个 commit，对于大仓库也很快。如果后续需要优化，可以考虑在 API Server 侧维护一个 bare clone 缓存。

### PUT 端点（文件编辑）

请求体：

```json
{
  "content": "# Updated proposal\n...",
  "branch": "main",
  "commitMessage": "docs: update proposal.md"
}
```

`branch` 和 `commitMessage` 可选，有默认值。

---

## 前端层

### SpecArtifactViewer 组件

位置：`packages/web/src/components/spec-artifact-viewer.tsx`

#### Props

```typescript
interface SpecArtifactViewerProps {
  projectId: string      // 项目 ID
  changeName: string     // OpenSpec change 名称
  branch?: string        // Git 分支，默认 'main'
  editable?: boolean     // 是否允许编辑
  onSave?: (path: string, content: string) => Promise<void>  // 保存回调
}
```

#### 功能

1. 从 API 获取 `openspec/changes/<changeName>/` 下的所有文件
2. 按类型分组到 4 个 Tab：Proposal / Specs / Design / Tasks
3. 以 `<pre>` 渲染 Markdown 内容（纯文本展示）
4. 可选的编辑功能：点击 "编辑" 切换到 `<Textarea>` 编辑模式

#### 使用方式

在 `human_review` 节点的 Review 页面中集成：

```tsx
<SpecArtifactViewer
  projectId={project.id}
  changeName={nodeOutput.change_name}
  branch={flowRun.gitBranch}
  editable={true}
  onSave={async (path, content) => {
    await fetch(`/api/projects/${project.id}/openspec/changes/${changeName}/artifacts/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, branch }),
    })
  }}
/>
```

---

## 流程模板

### openspec-dev-pipeline.yaml

7 个节点的完整 Spec 驱动开发流水线：

```
submit_requirement (human_input)
    ↓
generate_spec (agent_task, mode: opsx_plan)
    ↓
review_spec (human_review, show_artifacts: true)
    ↓  ← reject → generate_spec (max 3 loops)
implement_code (agent_task, mode: opsx_apply)
    ↓
code_review (agent_task, mode: review)
    ↓
final_review (human_review)
    ↓  ← reject → implement_code (max 2 loops)
archive_spec (agent_task, mode: opsx_plan, action: archive)
```

参数：`spec_role`, `developer_role`, `reviewer_role`, `model`, `spec_schema`, `max_spec_review_loops`, `max_code_review_loops`

### openspec-init.yaml

2 个节点的初始化流程：

```
init_openspec (agent_task, mode: opsx_plan, init_if_missing: true)
    ↓
review_init (human_review, show_artifacts: true)
    ↓  ← reject → init_openspec (max 2 loops)
```

参数：`spec_role`, `model`

### 种子数据注册

在 `seed-templates.ts` 的 `templates` 数组中新增两个条目，slug 分别为 `openspec-dev-pipeline` 和 `openspec-init`。运行 `pnpm db:seed` 即可导入。

---

## 数据流时序

### opsx_plan 模式完整时序

```
FlowExecutor                  ClaudeCodeAdapter           DockerExecutor              Container
    │                              │                          │                         │
    │ executeAgentTask()           │                          │                         │
    │ ├─ getNodeDef()              │                          │                         │
    │ ├─ resolve OpsxConfig        │                          │                         │
    │ │  (render change_name       │                          │                         │
    │ │   template expression)     │                          │                         │
    │ ├─ build AgentRequest        │                          │                         │
    │ │  {Mode: "opsx_plan",       │                          │                         │
    │ │   OpsxConfig: {...}}       │                          │                         │
    │ │                            │                          │                         │
    │ ├─ adapter.Execute()         │                          │                         │
    │ │──────────────────────────>│                          │                         │
    │ │                            │ BuildRequest()           │                         │
    │ │                            │ ├─ promptBuilder.Build() │                         │
    │ │                            │ ├─ inject OPSX_* env     │                         │
    │ │                            │ │                        │                         │
    │ │                            │ executor.Execute()       │                         │
    │ │                            │──────────────────────────>│                        │
    │ │                            │                          │ ContainerCreate         │
    │ │                            │                          │ ContainerStart          │
    │ │                            │                          │────────────────────────>│
    │ │                            │                          │                        │ entrypoint.sh:
    │ │                            │                          │                        │ 1. git clone
    │ │                            │                          │                        │ 2. openspec init
    │ │                            │                          │                        │ 3. claude -p ...
    │ │                            │                          │                        │    (generates specs)
    │ │                            │                          │                        │ 4. git commit
    │ │                            │                          │                        │    "spec(name): ..."
    │ │                            │                          │                        │ 5. git push
    │ │                            │                          │<────────────────────────│
    │ │                            │                          │ ContainerLogs           │
    │ │                            │<──────────────────────────│                        │
    │ │                            │ ParseResponse()          │                         │
    │ │<──────────────────────────│                          │                         │
    │ │                            │                          │                         │
    │ ├─ UpdateNodeRunOutput()     │                          │                         │
    │ ├─ UpdateNodeRunStatus()     │                          │                         │
    │ └─ publishEvent()            │                          │                         │
```

---

## 扩展指南

### 添加新的 OpenSpec Action

1. 在 `OpsxConfig.Action` / `OpsxConfigDef.Action` 中定义新值（如 `"validate"`）
2. 在 `entrypoint.sh` 的 commit message 逻辑中添加对应分支
3. 在 `prompt_builder.go` 的 `opsx_plan` 模式指令中添加对应说明
4. 在流程模板 YAML 中使用：`opsx.action: validate`

### 自定义 spec-architect 角色 Prompt

方式一：在 Go 代码中修改 `DefaultRolePrompts["spec-architect"]`

方式二：通过 DSL 的 `prompt_template` 覆盖默认 prompt（优先级更高）

方式三：后续支持在 WorkGear 前端的 Agent 角色管理中自定义（Phase 5+）

### 扩展 Spec Artifact 查看器

当前查看器使用 `<pre>` 纯文本渲染。可以增强为：

1. **Markdown 渲染** — 集成 `react-markdown` 或 `@uiw/react-md-editor`
2. **Delta Spec 结构化视图** — 解析 ADDED/MODIFIED/REMOVED 前缀，分色标注
3. **Tasks 进度条** — 解析 `[x]` / `[ ]` 复选框，显示完成百分比
4. **Monaco Editor** — 替换 `<Textarea>` 为 Monaco Editor，支持 Markdown 语法高亮

### 添加新的 Agent 模式

如果需要添加更多 OpenSpec 相关模式（如 `opsx_validate`）：

1. `adapter.go` — `AgentRequest.Mode` 注释中添加新值
2. `dsl_parser.go` — `NodeConfigDef.Mode` 注释中添加新值
3. `claude_adapter.go` — `BuildRequest()` 中的 mode 条件判断添加新值
4. `prompt_builder.go` — `modeInstruction()` 中添加新 case
5. `entrypoint.sh` — Step 1.5 和 Step 3 中添加新 mode 的处理逻辑
6. 前端 `dsl-parser.ts` — 如果需要在 DAG 预览中区分显示

---

**最后更新**: 2026-02-14
**适用版本**: Phase 4 (OpenSpec 集成)
