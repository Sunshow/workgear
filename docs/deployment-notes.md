# WorkGear 部署调试笔记

> 记录从项目部署到需求分析流程跑通的完整过程，包括遇到的所有问题及解决方案。

---

## 一、项目概述

WorkGear 是一个 AI Agent 工作流编排平台，核心能力是让 AI Agent（如 Claude Code / Droid）按预定义 YAML 流程执行任务，配合人工 Review 和看板管理。

### 架构

```
浏览器 → Vite(:3000) --/api代理-→ Fastify(:4000) --gRPC-→ Go Orchestrator(:50051)
                                       ↓
                                  PostgreSQL(:5432) + Redis(:6379)
```

### 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React + Vite + Tailwind CSS 4 + TypeScript |
| API | Fastify + Drizzle ORM + PostgreSQL |
| 调度 | Go + gRPC |
| Agent 执行 | Docker 容器（agent-droid 镜像） |
| 缓存 | Redis |

### 核心流程：需求分析（requirement-analysis）

```
输入需求(human_input) → Agent 分析需求(agent_task, spec mode)
  → Review PRD(human_review) → 拆解 User Story(agent_task, spec mode)
  → Review User Stories(human_review)
```

YAML 模板位置：`packages/api/src/seeds/templates/requirement-analysis.yaml`

### 关键数据流

1. 用户在前端创建 Task，选择流程模板，触发 flow run
2. Flow run 的 DSL 来源链：`workflow_templates.template` → `workflows.dsl` → `flow_runs.dsl_snapshot`
3. Orchestrator 的 worker loop 轮询 `node_runs` 表中 `status='queued'` 的记录，原子性地 acquire 并执行
4. Agent 在 Docker 容器中执行，通过 git worktree 操作代码仓库
5. 产物存储在 `artifacts` + `artifact_versions` 表，spec 模式下同时写入 git

### 数据库连接

```bash
docker exec -i workgear-postgres psql -U workgear -d workgear_dev -c "SQL"
```

宿主机未安装 psql，必须通过 docker exec。

---

## 二、问题清单与解决方案

### 1. Git Worktree Docker 挂载失败（exit code 128）

**现象**：Agent 执行失败，exit code 128，git 操作报错。

**根因**：Agent 容器内挂载的是 worktree 目录，但 worktree 的 `.git` 文件指向宿主机的 bare repo 绝对路径，容器内路径不存在。

**修复**：
- `adapter.go`：新增 `BareRepoPath` 字段
- `executor.go`：挂载 bare repo 到容器，添加 `rewriteWorktreeGitPaths` 函数重写 `.git` 文件中的路径
- `droid_adapter.go` / `claude_adapter.go` / `codex_adapter.go`：传递 `BareRepoPath`

**涉及文件**：
- `packages/orchestrator/internal/agent/adapter.go`
- `packages/orchestrator/internal/agent/executor.go`
- `packages/orchestrator/internal/agent/droid_adapter.go`
- `packages/orchestrator/internal/agent/claude_adapter.go`
- `packages/orchestrator/internal/agent/codex_adapter.go`

---

### 2. Agent 执行超时（5 分钟）

**现象**：`container execution timed out after 5m0s`

**根因**：YAML 模板中 `timeout: 300s`（5 分钟）对于 LLM 生成 PRD/User Story 不够用。

**修复**：YAML 中 `timeout: 300s` → `timeout: 15m`

**关键坑**：修改 YAML 文件后，需要同步更新三处数据库记录：
1. `workflow_templates.template` — 模板定义
2. `workflows.dsl` — 工作流实例的 DSL（**容易遗漏！flow 创建时从这里取 DSL，不是从 workflow_templates**）
3. `flow_runs.dsl_snapshot` — 已创建的 flow run 快照

```sql
-- 同步模板到所有位置
UPDATE workflow_templates SET template = $YAML WHERE slug = 'requirement-analysis';
UPDATE workflows SET dsl = $YAML WHERE template_id = '<template_id>';
UPDATE flow_runs SET dsl_snapshot = $YAML WHERE status NOT IN ('completed', 'cancelled', 'failed');
```

---

### 3. PRD 输出内容为空

**现象**：Agent 分析需求完成，但 Review PRD 节点看到的内容为空。

**根因**：模板表达式使用了 `.outputs` 而不是 `.outputs.result`。Agent 的输出结构是 `{"result": "..."}`, 需要用 `.outputs.result` 取值。

**修复**：所有模板中 `{{nodes.xxx.outputs}}` → `{{nodes.xxx.outputs.result}}`

---

### 4. 模板渲染显示 `<map[string]interface {} Value>`

**现象**：下游节点收到的上游输出显示为 Go 的 map 类型字符串。

**根因**：同问题 3，`.outputs` 返回整个 map 对象而非字符串字段。

**修复**：同上，使用 `.outputs.result`。

---

### 5. Human Input 表单数据未持久化

**现象**：用户提交需求后，数据丢失，下游节点拿不到输入。

**修复**：
- `node_handlers.go` 中 `executeHumanInput` 添加表单数据持久化逻辑
- 添加模板 fallback：`{% if nodes.input_requirement.outputs.requirement_text %}...{% else %}...{% endif %}`

---

### 6. Droid Agent 卡在 spec mode 思考循环

**现象**：User Story 节点输出为空，Agent 日志显示反复进入 `<thinking>` 循环尝试调用 `ExitSpecMode` 工具。

**根因**：`docker/agent-droid/entrypoint.sh` 中 `spec` 模式被映射为 `ACP_MODE="normal"`，导致 Droid agent 进入 spec 模式后无法正常输出。

**修复**：删除 `spec) ACP_MODE="normal"` case，让 spec 模式 fall through 到 `*) ACP_MODE="auto-high"`。

**注意**：修改后需要重新构建 Docker 镜像：
```bash
cd docker/agent-droid && docker build -t workgear/agent-droid:latest .
```

---

### 7. 复用历史产物后并行执行冲突

**现象**：跳过节点后，下游节点被调度器立即拾取执行，与用户操作产生竞争。

**修复**：`HandleSkipNode` 中添加上游依赖检查，确保所有上游节点已完成才允许跳过。`canSkip` 限制为 `queued` / `waiting_human` 状态。

---

### 8. 复用历史产物按钮不显示

**现象**：前端没有显示"复用历史产物"按钮。

**根因**：API 查询 previous-output 时只查了最近一个 flow，但那个 flow 可能没有完成的节点。

**修复**：API 改为 `innerJoin` 跨所有历史 flow 查询，取最新的 completed 节点输出。

---

### 9. Spec 模式产物未提交到 Git

**现象**：PRD 和 User Story 生成后只存在数据库中，没有推送到 Git 仓库。

**根因**：Git 集成代码只对 `execute` / `opsx_plan` / `opsx_apply` 模式生效，`spec` 模式被跳过。`handleArtifact` 只创建 DB 记录，不写文件。

**修复**：
1. `ArtifactConfigDef` 新增 `file_path` 字段（如 `docs/prd.md`）
2. `executeAgentTask` 中 spec 模式下，agent 返回后自动将产物写入 worktree 并 commit
3. `requiresCommit` 条件增加 `spec` 模式
4. `HandleSkipNode`（复用路径）中添加 `writeSkippedArtifactToGit`：创建临时 worktree → 写文件 → commit → integrate → push → cleanup

**涉及文件**：
- `packages/orchestrator/internal/engine/dsl_parser.go` — `FilePath` 字段
- `packages/orchestrator/internal/engine/node_handlers.go` — `writeArtifactToGit` 函数 + spec 模式写入逻辑
- `packages/orchestrator/internal/engine/dag.go` — `writeSkippedArtifactToGit` 方法

---

## 三、新增功能：产物复用（Artifact Reuse）

### 功能描述

当同一个 Task 多次运行流程时，如果之前的 flow 已经产出了有效的 PRD / User Story，用户可以选择复用历史产物跳过 Agent 执行，节省时间和 token。

### 实现架构

#### 后端（Go Orchestrator）

- `db/queries.go`：
  - `GetPreviousFlowCompletedNodes` — 获取前一个 flow 的所有已完成节点输出
  - `UpdateNodeRunOutputRaw` — 直接写入 output JSON
  - `HasPreviousFlowOutput` — 检查某节点是否有可复用的历史输出
- `engine/dag.go`：
  - `HandleSkipNode` — 跳过节点，注入历史输出，标记完成，触发 advanceDAG
  - `advanceDAG` 中增加级联复用检查：激活 `agent_task` 节点时，如果有历史输出，设为 `waiting_human` 而非 `queued`，防止调度器自动拾取
  - `writeSkippedArtifactToGit` — 复用时也写入 git
- `grpc/server.go`：`SkipNode` RPC 方法
- `grpc/pb/orchestrator_grpc.pb.go`：手动添加 `SkipNode` 方法（未用 protoc 生成）

#### API（Fastify）

- `routes/node-runs.ts`：
  - `GET /:id/previous-output` — 查询历史产物（innerJoin 所有历史 flow）
  - `POST /:id/skip` — 跳过节点（调用 gRPC SkipNode）
  - `POST /:id/proceed` — 继续执行（将 `waiting_human` 改为 `queued`，清除 `_reuse_available` 标记）
- `grpc/client.ts`：`skipNode` 函数

#### 前端（React）

- `flow-tab.tsx`：
  - 自动检查每个 `queued` / `waiting_human` 节点是否有可复用的历史输出
  - 蓝色"复用历史产物"按钮 — 调用 skip API
  - 绿色"继续执行"按钮 — 调用 proceed API（仅对被暂停的 agent_task 节点显示）

### 级联复用流程

```
用户跳过"输入需求" → advanceDAG 检查"Agent 分析需求"
  → 有历史输出 → 设为 waiting_human + _reuse_available
  → 前端显示"复用历史产物"+"继续执行"两个按钮
  → 用户选择复用 → HandleSkipNode → advanceDAG → "Review PRD" 正常进行
  → Review 通过 → advanceDAG 检查"拆解 User Story"
  → 有历史输出 → 同样暂停等待用户选择
```

---

## 四、YAML 模板变更记录

### 简化输入表单

原来 4 个字段（requirement_text, business_goal, target_users, deadline）→ 简化为 1 个 textarea（requirement_text）。

### 添加产物文件路径

```yaml
artifact:
  type: prd
  title: "..."
  file_path: "docs/prd.md"    # 新增：写入 git 的文件路径
```

### Prompt 模板简化

移除了对 business_goal / target_users / deadline 的引用，保留 `{% if %}` fallback 兼容旧数据。

---

## 五、注意事项

1. **修改 YAML 模板后必须同步三处 DB**：`workflow_templates.template`、`workflows.dsl`、活跃的 `flow_runs.dsl_snapshot`
2. **修改 Go 代码后需要重启 orchestrator**：`pnpm dev` 不会自动热重载 Go 服务
3. **修改 entrypoint.sh 后需要重建 Docker 镜像**：`cd docker/agent-droid && docker build -t workgear/agent-droid:latest .`
4. **清理坏的历史产物**：如果历史产物内容有误，需要手动清除 `node_runs.output`，否则复用功能会注入错误内容
5. **gRPC proto 变更**：当前 proto 变更是手动 patch pb 文件，未使用 protoc 生成。如果后续需要 protoc 生成，需要确保手动添加的方法不被覆盖
6. **Git 推送依赖项目配置**：项目需要配置 `git_repo_url` 和 `git_access_token`，否则产物无法推送到远端

---

## 六、当前未修改文件的变更清单（未提交）

```
docker/agent-droid/entrypoint.sh          — spec mode ACP_MODE 修复 + ACP acp_wait_response 轮询重写
packages/api/src/grpc/client.ts           — skipNode gRPC 客户端
packages/api/src/routes/node-runs.ts      — previous-output / skip / proceed API
packages/api/src/seeds/templates/requirement-analysis.yaml — 简化表单 + file_path
packages/api/src/seeds/templates/openspec-dev-pipeline-v2.yaml — 统一 git.branch_pattern
packages/orchestrator/internal/agent/*    — BareRepoPath + Docker 挂载 + git branch 逻辑修复
packages/orchestrator/internal/db/queries.go — 复用相关查询
packages/orchestrator/internal/engine/dag.go — HandleSkipNode + 级联复用 + git 写入
packages/orchestrator/internal/engine/dsl_parser.go — FilePath 字段 + FormFieldDef json tag + GitConfigDef
packages/orchestrator/internal/engine/node_handlers.go — spec 模式 git 写入 + opsx_plan 验证 + branch_pattern 渲染
packages/orchestrator/internal/grpc/*     — SkipNode RPC
packages/shared/proto/orchestrator.proto  — SkipNode 定义
packages/web/src/pages/kanban/task-detail/flow-tab.tsx — 复用 UI
```

---

### 10. Human Input 表单字段名全部变成 undefined

**现象**：前端 human_input 表单渲染出两个输入框，但提交后数据库中 output 为 `{"undefined": "..."}`，下游模板 `{{nodes.submit_requirement.outputs.requirement_text}}` 解析为空，Agent 收到空需求回复 "Process request is quite vague"。

**根因**：Go 的 `FormFieldDef` 结构体只有 `yaml` tag，没有 `json` tag。JSON 序列化时使用 Go 默认的大写字段名（`Field`, `Type`, `Label`, `Required`, `Options`），而前端读取的是小写（`field`, `type`, `label`, `required`, `options`）。前端能拿到 form 数组（length > 0），但每个元素的 `.field` 为 JS 的 `undefined`，导致 `updateField(undefined, value)` → `{"undefined": "..."}`。

**修复**：给 `FormFieldDef` 添加 `json` tag：

```go
type FormFieldDef struct {
    Field    string   `yaml:"field" json:"field"`
    Type     string   `yaml:"type" json:"type"`
    Label    string   `yaml:"label" json:"label"`
    Required bool     `yaml:"required" json:"required"`
    Options  []string `yaml:"options" json:"options,omitempty"`
}
```

**涉及文件**：
- `packages/orchestrator/internal/engine/dsl_parser.go`

---

### 11. ACP acp_wait_response 卡住导致 Agent 容器长时间无响应

**现象**：Agent 容器启动后长时间（10 分钟+）无进展，或 Agent 刚开始工具调用（创建文件）就被判定为完成，产出不完整。

**根因**：`entrypoint.sh` 中 `acp_wait_response` 函数的 `read -r -t $timeout_sec` 在 Droid 回复完毕后不再输出任何数据时会阻塞到超时（默认 600 秒）。Droid 通过 ACP 协议回复后会等待下一个 prompt，不会自动退出，所以 FIFO 上 `read` 一直阻塞。

**修复历程**（两次迭代）：

第一次修复（有缺陷）：收到 Agent 输出后将 read 超时从 600 秒降到 30 秒 → 但工具调用（创建文件、LLM 推理）间隔容易超过 30 秒，导致 Agent 还在工作就被判定完成。

最终修复：改为 5 秒轮询 + 进程存活检测：
- `read -t 5` 每 5 秒轮询一次，每次检查 Droid 进程是否还活着
- 总超时仍然是调用方传入的值（600 秒），通过递减计数器控制
- 只有在 Droid 进程退出或总超时到期时才退出循环
- Droid 进程退出后，如果已有输出则视为成功（正常完成），否则视为失败

**涉及文件**：
- `docker/agent-droid/entrypoint.sh`

**注意**：修改后需要重建 Docker 镜像。

---

### 12. opsx_plan 模式（生成 Spec）产出不完整但被标记为成功

**现象**：`generate_spec` 节点的 Agent 只输出了思考过程（"I'll generate all the artifacts in parallel:"），实际 spec 文件（proposal.md / design.md / tasks.md / specs/）没有创建，但节点状态为 `completed`。后续 `review_spec` 审核节点没有实际产物可审，人工直接通过后流程继续走下去。

**根因**：流程引擎只对 `opsx_apply` 模式有 `validateOpsxApplyResult` 验证（检查是否有代码变更），对 `opsx_plan` 模式没有任何验证，空结果也能标记成功。

**修复**：新增 `validateOpsxPlanResult` 验证函数，在 `opsx_plan` 完成后检查 Git 产物：
- 必须有 Git 变更（否则说明 Agent 提前终止）
- 必须包含 4 类必要文件：`proposal.md`、`design.md`、`tasks.md`、`specs/*.md`
- 缺少任何一个都返回错误，节点标记为 failed
- `archive` action 豁免验证（归档操作不产生新 spec 文件）

**涉及文件**：
- `packages/orchestrator/internal/engine/node_handlers.go`

---

### 13. DSL git.branch_pattern 配置未生效，分支名不一致

**现象**：DSL 中 `implement_code` 节点配置了 `git.branch_pattern: "feat/{{nodes.generate_change_name.outputs.change_name}}"`，但实际推送到的分支是 `agent/<change_name>`。

**根因**：orchestrator 代码中完全没有解析 DSL 的 `git:` 配置块（`branch_pattern`、`create_branch`），属于死代码。分支名由 `droid_adapter.go` 中的硬编码逻辑决定：有 `OpsxConfig.ChangeName` 时使用 `agent/` 前缀。

**修复**：

1. `dsl_parser.go` — 新增 `GitConfigDef` 结构体，解析 DSL 中的 `git:` 配置
2. `node_handlers.go` — 在构建 `agentReq` 后渲染 `branch_pattern` 模板，将结果写入 `agentReq.GitBranch`
3. `droid_adapter.go` / `claude_adapter.go` / `codex_adapter.go` — 三个 adapter 统一修复：
   - 当 `req.GitBranch` 已是具体 feature 分支名（非 main/master）时，直接用作 `GIT_FEATURE_BRANCH`
   - `GIT_BASE_BRANCH` 始终回退为 `main`
   - 没配 `git.branch_pattern` 时保持原有 fallback（`agent/` + changeName）
4. `openspec-dev-pipeline-v2.yaml` — 给 `generate_spec` 和 `archive_spec` 也加上 `git.branch_pattern`，与 `implement_code` 统一为 `feat/{{change_name}}`，确保整个流程中所有 git 节点推到同一个分支

**涉及文件**：
- `packages/orchestrator/internal/engine/dsl_parser.go`
- `packages/orchestrator/internal/engine/node_handlers.go`
- `packages/orchestrator/internal/agent/droid_adapter.go`
- `packages/orchestrator/internal/agent/claude_adapter.go`
- `packages/orchestrator/internal/agent/codex_adapter.go`
- `packages/api/src/seeds/templates/openspec-dev-pipeline-v2.yaml`

---

## 七、Git 分支策略说明

### 流程中的 Git 操作

整个 openspec-dev-pipeline-v2 流程中，只有 3 个节点会做 Git 推送操作：

| 节点 | 模式 | Git 操作 |
|------|------|---------|
| `generate_spec` | opsx_plan | 生成 spec 文件，推送到 `feat/<change_name>` 分支，创建 PR |
| `implement_code` | opsx_apply | 实现代码，推送到同一个 `feat/<change_name>` 分支，PR 自动更新 |
| `archive_spec` | opsx_plan | 归档 spec，推送到同一个 `feat/<change_name>` 分支，PR 自动更新 |

其他节点（理解需求、确认需求、生成变更名称、代码审核、人工审核）不涉及 Git 操作。

### 分支流转

```
GitHub 仓库 main 分支
    │
    │  clone main（只读，拉代码用）
    ▼
generate_spec:
  - 从 main clone
  - 本地创建 feat/<change_name> 分支
  - 生成 spec 文件
  - git push feat/<change_name>
  - 自动创建 PR: feat/<change_name> → main
    │
    │  人工审核 Spec
    ▼
implement_code:
  - 从 main clone
  - checkout 到同一个 feat/<change_name> 分支
  - 实现代码
  - git push --force feat/<change_name>
  - PR 已存在，内容自动更新
    │
    │  Agent 代码审核 + 人工最终审核
    ▼
archive_spec:
  - 归档 spec 到 archive 目录
  - git push --force feat/<change_name>
  - PR 内容最终更新
    │
    ▼
流程结束 → GitHub 上有一个完整的 PR 等待合并
            feat/<change_name> → main
            包含：spec 文件 + 实现代码 + 归档操作
            需要人工在 GitHub 上点 Merge
```

### 关键要点

- **永远不会直接推送到 main 分支**，所有推送走 feature 分支 + PR
- **合并到 main 是手动操作**，WorkGear 不自动合并
- **空白新项目**：GitHub 仓库至少需要有一个初始 commit（创建仓库时勾选 "Add a README file"），否则 `git clone --branch main` 会失败
