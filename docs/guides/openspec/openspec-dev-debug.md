# OpenSpec 集成开发调试指南

> 本文档面向 WorkGear 开发者，介绍如何在本地开发和调试 OpenSpec 集成功能。

---

## 目录

- [环境准备](#环境准备)
- [本地调试流程](#本地调试流程)
- [API 调试](#api-调试)
- [前端调试](#前端调试)
- [流程模板调试](#流程模板调试)
- [日志和排查](#日志和排查)
- [单元测试](#单元测试)
- [常见问题](#常见问题)

---

## 环境准备

### 1. 构建 Agent Docker 镜像

OpenSpec CLI 预装在 Agent 镜像中，需要重新构建：

```bash
cd docker/agent-claude
docker build -t workgear/agent-claude:latest .
```

验证 OpenSpec CLI 已安装：

```bash
docker run --rm --entrypoint openspec workgear/agent-claude:latest --version
```

### 2. 配置 Anthropic API Key

在 `packages/orchestrator/.env` 中配置：

```env
# 至少配置一个
ANTHROPIC_API_KEY=sk-ant-xxx
# 或
ANTHROPIC_BASE_URL=https://your-proxy.example.com
ANTHROPIC_AUTH_TOKEN=your-auth-token
```

### 3. 准备测试用 Git 仓库

OpenSpec 功能需要一个可读写的 Git 仓库。推荐创建一个专用的测试仓库：

```bash
# 创建本地测试仓库
mkdir /tmp/test-openspec-repo
cd /tmp/test-openspec-repo
git init
echo "# Test Project" > README.md
echo '{"name": "test-project", "version": "1.0.0"}' > package.json
git add -A
git commit -m "init"

# 如果需要远程仓库，推送到 GitHub/GitLab
# git remote add origin <your-test-repo-url>
# git push -u origin main
```

在 WorkGear 中创建项目时，将 `gitRepoUrl` 设置为这个测试仓库的地址。

### 4. 导入种子数据

确保 OpenSpec 流程模板已导入数据库：

```bash
cd packages/api
pnpm db:seed
```

验证模板已导入：

```bash
curl http://localhost:4000/api/workflow-templates | jq '.[] | select(.slug | startswith("openspec"))'
```

应该看到 `openspec-dev-pipeline` 和 `openspec-init` 两个模板。

---

## 本地调试流程

### 方式一：手动测试 Docker 容器（不通过 WorkGear）

直接运行 Agent 容器，模拟 `opsx_plan` 模式：

```bash
docker run --rm \
  -e AGENT_MODE=opsx_plan \
  -e GIT_REPO_URL=<your-test-repo-url> \
  -e GIT_BRANCH=main \
  -e OPSX_CHANGE_NAME=test-feature \
  -e OPSX_INIT_IF_MISSING=true \
  -e OPSX_SCHEMA=spec-driven \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -e AGENT_PROMPT="请为项目创建一个简单的 OpenSpec change: test-feature。需求：添加用户登录功能。" \
  workgear/agent-claude:latest
```

模拟 `opsx_apply` 模式：

```bash
docker run --rm \
  -e AGENT_MODE=opsx_apply \
  -e GIT_REPO_URL=<your-test-repo-url> \
  -e GIT_BRANCH=feat/test-feature \
  -e OPSX_CHANGE_NAME=test-feature \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -e AGENT_PROMPT="请按照 openspec/changes/test-feature/tasks.md 实施所有任务。" \
  workgear/agent-claude:latest
```

模拟归档模式：

```bash
docker run --rm \
  -e AGENT_MODE=opsx_plan \
  -e GIT_REPO_URL=<your-test-repo-url> \
  -e GIT_BRANCH=main \
  -e OPSX_CHANGE_NAME=test-feature \
  -e OPSX_ACTION=archive \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -e AGENT_PROMPT="请归档 OpenSpec 变更 test-feature。" \
  workgear/agent-claude:latest
```

### 方式二：手动测试 OpenSpec CLI

进入容器交互模式，手动操作 OpenSpec：

```bash
docker run --rm -it \
  -e GIT_REPO_URL=<your-test-repo-url> \
  -e GIT_BRANCH=main \
  --entrypoint /bin/bash \
  workgear/agent-claude:latest

# 在容器内
git clone $GIT_REPO_URL --branch $GIT_BRANCH /workspace
cd /workspace

# 初始化 OpenSpec
openspec init

# 查看目录结构
ls -la openspec/

# 手动创建 change
mkdir -p openspec/changes/test-feature/specs
echo "# Proposal" > openspec/changes/test-feature/proposal.md
echo "# Design" > openspec/changes/test-feature/design.md
echo "- [ ] Task 1" > openspec/changes/test-feature/tasks.md
```

### 方式三：使用 Mock Agent 调试流程引擎

不配置 `ANTHROPIC_API_KEY`，Orchestrator 会自动降级到 Mock Agent。Mock Agent 会模拟 2 秒延迟后返回固定输出。

这种方式适合调试流程引擎的 DAG 推进、打回、状态机等逻辑，不需要真实的 Agent 执行。

```bash
# 确保 .env 中没有 ANTHROPIC_API_KEY
# 启动 Orchestrator
pnpm run dev:orchestrator

# 日志中应该看到：
# WARN  ANTHROPIC_API_KEY not set, using mock adapter
```

### 方式四：端到端测试

完整的端到端测试流程：

```bash
# 1. 启动所有服务
pnpm dev

# 2. 在浏览器中访问 http://localhost:3000
# 3. 创建项目（配置 Git 仓库地址）
# 4. 创建 Task
# 5. 选择 "OpenSpec 项目初始化" 模板启动流程
# 6. 等待 Agent 执行完成
# 7. Review 初始化结果
# 8. 创建新 Task，选择 "Spec 驱动开发流水线" 模板
# 9. 填写需求和变更名称
# 10. 逐步 Review 和 Approve
```

---

## API 调试

### 前置条件

确保 API Server 正在运行，且数据库中有项目数据：

```bash
# 启动 API
pnpm run dev:api

# 创建测试项目（如果没有）
curl -X POST http://localhost:4000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project", "gitRepoUrl": "<your-test-repo-url>"}'

# 记下返回的 project ID
```

### 测试 OpenSpec API 端点

#### 获取所有 changes

```bash
PROJECT_ID=<your-project-id>

curl "http://localhost:4000/api/projects/$PROJECT_ID/openspec/changes?branch=main" | jq
```

#### 获取指定 change 的所有 artifact

```bash
curl "http://localhost:4000/api/projects/$PROJECT_ID/openspec/changes/test-feature?branch=main" | jq
```

预期响应：

```json
{
  "changeName": "test-feature",
  "branch": "main",
  "artifacts": [
    {
      "path": "openspec/changes/test-feature/proposal.md",
      "relativePath": "proposal.md",
      "content": "# Proposal\n..."
    },
    {
      "path": "openspec/changes/test-feature/design.md",
      "relativePath": "design.md",
      "content": "# Design\n..."
    }
  ]
}
```

#### 获取指定 artifact 文件

```bash
curl "http://localhost:4000/api/projects/$PROJECT_ID/openspec/changes/test-feature/artifacts/proposal.md?branch=main" | jq
```

#### 获取 Source of Truth specs

```bash
curl "http://localhost:4000/api/projects/$PROJECT_ID/openspec/specs?branch=main" | jq
```

#### 更新 artifact 文件

```bash
curl -X PUT "http://localhost:4000/api/projects/$PROJECT_ID/openspec/changes/test-feature/artifacts/proposal.md" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# Updated Proposal\n\nThis is the updated content.",
    "branch": "main",
    "commitMessage": "docs: update proposal for test-feature"
  }' | jq
```

### 常见错误

| 状态码 | 错误 | 原因 |
|--------|------|------|
| 404 | `Project not found` | projectId 不存在 |
| 400 | `Project has no Git repo configured` | 项目未配置 gitRepoUrl |
| 404 | `No OpenSpec change found: xxx` | 仓库中不存在该 change 目录 |
| 500 | `Failed to update file in Git repo` | Git push 失败（权限/网络问题） |

---

## 前端调试

### SpecArtifactViewer 组件

组件位于 `packages/web/src/components/spec-artifact-viewer.tsx`。

#### 在页面中集成测试

在任意页面中临时引入组件进行测试：

```tsx
import { SpecArtifactViewer } from '@/components/spec-artifact-viewer'

function TestPage() {
  return (
    <SpecArtifactViewer
      projectId="<your-project-id>"
      changeName="test-feature"
      branch="main"
      editable={true}
      onSave={async (path, content) => {
        const relativePath = path.replace(`openspec/changes/test-feature/`, '')
        const res = await fetch(
          `/api/projects/<your-project-id>/openspec/changes/test-feature/artifacts/${relativePath}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, branch: 'main' }),
          }
        )
        if (!res.ok) throw new Error('Save failed')
      }}
    />
  )
}
```

#### 模拟 API 响应

如果没有真实的 Git 仓库，可以在浏览器 DevTools 中拦截 API 请求：

```javascript
// 在浏览器 Console 中
const originalFetch = window.fetch
window.fetch = async (url, options) => {
  if (typeof url === 'string' && url.includes('/openspec/changes/')) {
    return new Response(JSON.stringify({
      changeName: 'test-feature',
      branch: 'main',
      artifacts: [
        { path: 'openspec/changes/test-feature/proposal.md', relativePath: 'proposal.md', content: '# Proposal\n\n## Why\nWe need dark mode.\n\n## What\nAdd theme toggle.' },
        { path: 'openspec/changes/test-feature/design.md', relativePath: 'design.md', content: '# Design\n\n## Approach\nCSS variables + context.' },
        { path: 'openspec/changes/test-feature/tasks.md', relativePath: 'tasks.md', content: '# Tasks\n\n- [ ] Add ThemeContext\n- [ ] Add toggle button\n- [x] Update CSS variables' },
        { path: 'openspec/changes/test-feature/specs/ADDED-dark-mode.md', relativePath: 'specs/ADDED-dark-mode.md', content: '# ADDED: Dark Mode\n\nGiven user is on settings page\nWhen they click the theme toggle\nThen the UI switches to dark mode' },
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return originalFetch(url, options)
}
```

---

## 流程模板调试

### 查看模板 YAML

```bash
cat packages/api/src/seeds/templates/openspec-dev-pipeline.yaml
cat packages/api/src/seeds/templates/openspec-init.yaml
```

### 重新导入种子数据

修改模板 YAML 后，重新导入：

```bash
cd packages/api
pnpm db:seed
```

种子脚本使用 `onConflictDoUpdate`，会更新已存在的模板。

### 在 YAML 编辑器中预览

1. 在前端进入项目的流程管理页面
2. 点击 "创建流程"
3. 选择 OpenSpec 模板
4. 在 YAML 编辑器中查看和修改
5. 右侧 DAG 预览会实时更新

### 手动触发 FlowRun

通过 API 手动创建 FlowRun：

```bash
# 1. 获取 workflow ID
curl "http://localhost:4000/api/workflows?projectId=$PROJECT_ID" | jq

# 2. 获取 task ID
curl "http://localhost:4000/api/tasks?projectId=$PROJECT_ID" | jq

# 3. 启动 FlowRun
curl -X POST http://localhost:4000/api/flow-runs \
  -H "Content-Type: application/json" \
  -d "{
    \"taskId\": \"<task-id>\",
    \"workflowId\": \"<workflow-id>\"
  }" | jq
```

### 查看 FlowRun 状态

```bash
FLOW_RUN_ID=<flow-run-id>

# FlowRun 详情
curl "http://localhost:4000/api/flow-runs/$FLOW_RUN_ID" | jq

# 所有 NodeRun
curl "http://localhost:4000/api/flow-runs/$FLOW_RUN_ID/nodes" | jq

# 查看特定 NodeRun 的输出
curl "http://localhost:4000/api/flow-runs/$FLOW_RUN_ID/nodes" | jq '.[] | select(.nodeId == "generate_spec")'
```

---

## 日志和排查

### Orchestrator 日志

启动 Orchestrator 后，日志中会显示 OpenSpec 相关信息：

```
# Agent 模式检测
INFO  ClaudeCode adapter enabled (Docker + ANTHROPIC_API_KEY)

# 执行 opsx_plan 节点
INFO  Executing agent task  node_id=generate_spec  role=spec-architect  mode=opsx_plan
INFO  Creating agent container  image=workgear/agent-claude:latest  timeout=10m0s
INFO  Started agent container  container_id=abc123def456
INFO  Agent container finished  container_id=abc123def456  exit_code=0

# 执行 opsx_apply 节点
INFO  Executing agent task  node_id=implement_code  role=general-developer  mode=opsx_apply
```

### Docker 容器日志

如果 Agent 执行失败，查看容器日志：

```bash
# 列出最近的 Agent 容器（包括已停止的）
docker ps -a --filter "name=workgear-agent" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.CreatedAt}}"

# 查看容器日志
docker logs <container-id>
```

容器日志中的关键标记：

```
[agent] Starting ClaudeCode agent...
[agent] Mode: opsx_plan                    ← 确认模式正确
[agent] Git repo: https://...              ← 确认仓库地址
[agent] Cloning repository...
[agent] Repository cloned successfully.
[agent] OpenSpec mode detected: opsx_plan  ← OpenSpec 初始化检测
[agent] Initializing OpenSpec...           ← 首次初始化
[agent] Running claude CLI...
[agent] Committing changes...              ← 有文件变更
[agent] Pushing to main...
[agent] Changes pushed successfully.
```

### 常见错误排查

#### Agent 容器中 openspec 命令不存在

```
/entrypoint.sh: line 42: openspec: command not found
```

原因：Docker 镜像未重新构建。

解决：

```bash
cd docker/agent-claude
docker build -t workgear/agent-claude:latest .
```

#### Git clone 失败

```
[agent] Failed to clone branch main, trying default branch...
```

原因：Git 仓库地址错误或无权限。

排查：

```bash
# 在本地测试 clone
git clone <repo-url> /tmp/test-clone
```

#### OpenSpec init 失败

```
[agent] Warning: openspec init failed, continuing anyway...
```

原因：OpenSpec CLI 版本不兼容或仓库状态异常。

排查：

```bash
# 进入容器手动测试
docker run --rm -it --entrypoint /bin/bash workgear/agent-claude:latest
openspec --version
mkdir /tmp/test && cd /tmp/test && git init && openspec init
```

#### API 返回 400: Project has no Git repo configured

原因：项目创建时未填写 `gitRepoUrl`。

解决：

```bash
curl -X PUT "http://localhost:4000/api/projects/$PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{"gitRepoUrl": "<your-repo-url>"}'
```

---

## 单元测试

### Go 侧测试

#### OpsxConfig 解析测试

测试 DSL Parser 能正确解析 `opsx` 配置块：

```go
// packages/orchestrator/internal/engine/dsl_parser_test.go

func TestParseDSL_OpsxConfig(t *testing.T) {
    yaml := `
name: test
version: "1.0"
nodes:
  - id: gen_spec
    name: "Generate Spec"
    type: agent_task
    config:
      mode: opsx_plan
      opsx:
        change_name: "{{nodes.input.outputs.change_name}}"
        schema: spec-driven
        init_if_missing: true
        action: ""
`
    wf, dag, err := ParseDSL(yaml)
    assert.NoError(t, err)
    assert.NotNil(t, wf)

    node := dag.GetNode("gen_spec")
    assert.NotNil(t, node)
    assert.Equal(t, "opsx_plan", node.Config.Mode)
    assert.NotNil(t, node.Config.Opsx)
    assert.Equal(t, "{{nodes.input.outputs.change_name}}", node.Config.Opsx.ChangeName)
    assert.Equal(t, "spec-driven", node.Config.Opsx.Schema)
    assert.True(t, node.Config.Opsx.InitIfMissing)
    assert.Empty(t, node.Config.Opsx.Action)
}

func TestParseDSL_OpsxArchiveAction(t *testing.T) {
    yaml := `
name: test
version: "1.0"
nodes:
  - id: archive
    name: "Archive"
    type: agent_task
    config:
      mode: opsx_plan
      opsx:
        change_name: my-feature
        action: archive
`
    _, dag, err := ParseDSL(yaml)
    assert.NoError(t, err)

    node := dag.GetNode("archive")
    assert.Equal(t, "archive", node.Config.Opsx.Action)
}
```

#### PromptBuilder 模式指令测试

```go
// packages/orchestrator/internal/agent/prompt_builder_test.go

func TestModeInstruction_OpsxPlan(t *testing.T) {
    instr := modeInstruction("opsx_plan")
    assert.Contains(t, instr, "OpenSpec 规划")
    assert.Contains(t, instr, "proposal.md")
    assert.Contains(t, instr, "Given/When/Then")
    assert.Contains(t, instr, "OPSX_ACTION")
}

func TestModeInstruction_OpsxApply(t *testing.T) {
    instr := modeInstruction("opsx_apply")
    assert.Contains(t, instr, "OpenSpec 实施")
    assert.Contains(t, instr, "tasks.md")
    assert.Contains(t, instr, "[x]")
}

func TestDefaultRolePrompts_SpecArchitect(t *testing.T) {
    _, ok := DefaultRolePrompts["spec-architect"]
    assert.True(t, ok)
}

func TestPromptBuilder_OpsxPlanMode(t *testing.T) {
    pb := NewPromptBuilder()
    req := &AgentRequest{
        Mode:   "opsx_plan",
        Prompt: "创建 OpenSpec change: add-dark-mode",
        Context: map[string]any{
            "_role": "spec-architect",
        },
    }
    prompt := pb.Build(req)
    assert.Contains(t, prompt, "Spec 架构师")
    assert.Contains(t, prompt, "add-dark-mode")
    assert.Contains(t, prompt, "OpenSpec 规划")
}
```

#### ClaudeCodeAdapter 环境变量测试

```go
// packages/orchestrator/internal/agent/claude_adapter_test.go

func TestBuildRequest_OpsxPlanEnvVars(t *testing.T) {
    pb := NewPromptBuilder()
    adapter := NewClaudeCodeAdapter(pb, "claude-sonnet-3.5")

    req := &AgentRequest{
        Mode:       "opsx_plan",
        TaskID:     "task-1",
        NodeID:     "gen-spec",
        GitRepoURL: "https://github.com/test/repo.git",
        GitBranch:  "main",
        OpsxConfig: &OpsxConfig{
            ChangeName:    "add-dark-mode",
            Schema:        "spec-driven",
            InitIfMissing: true,
            Action:        "",
        },
    }

    execReq, err := adapter.BuildRequest(context.Background(), req)
    assert.NoError(t, err)
    assert.Equal(t, "opsx_plan", execReq.Env["AGENT_MODE"])
    assert.Equal(t, "add-dark-mode", execReq.Env["OPSX_CHANGE_NAME"])
    assert.Equal(t, "spec-driven", execReq.Env["OPSX_SCHEMA"])
    assert.Equal(t, "true", execReq.Env["OPSX_INIT_IF_MISSING"])
    assert.Empty(t, execReq.Env["OPSX_ACTION"])
}

func TestBuildRequest_OpsxApplyEnvVars(t *testing.T) {
    pb := NewPromptBuilder()
    adapter := NewClaudeCodeAdapter(pb, "claude-sonnet-3.5")

    req := &AgentRequest{
        Mode:   "opsx_apply",
        TaskID: "task-2",
        NodeID: "impl",
        OpsxConfig: &OpsxConfig{
            ChangeName: "add-dark-mode",
        },
    }

    execReq, err := adapter.BuildRequest(context.Background(), req)
    assert.NoError(t, err)
    assert.Equal(t, "opsx_apply", execReq.Env["AGENT_MODE"])
    assert.Equal(t, "add-dark-mode", execReq.Env["OPSX_CHANGE_NAME"])
}

func TestBuildRequest_NonOpsxMode_NoOpsxEnvVars(t *testing.T) {
    pb := NewPromptBuilder()
    adapter := NewClaudeCodeAdapter(pb, "claude-sonnet-3.5")

    req := &AgentRequest{
        Mode:   "execute",
        TaskID: "task-3",
        NodeID: "exec",
    }

    execReq, err := adapter.BuildRequest(context.Background(), req)
    assert.NoError(t, err)
    assert.Empty(t, execReq.Env["OPSX_CHANGE_NAME"])
    assert.Empty(t, execReq.Env["OPSX_SCHEMA"])
}
```

### 运行测试

```bash
cd packages/orchestrator
go test ./internal/engine/ -v -run TestParseDSL_Opsx
go test ./internal/agent/ -v -run TestBuildRequest_Opsx
go test ./internal/agent/ -v -run TestModeInstruction_Opsx
go test ./internal/agent/ -v -run TestPromptBuilder_Opsx
```

---

**最后更新**: 2026-02-14
**适用版本**: Phase 4 (OpenSpec 集成)
