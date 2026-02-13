
## 核心思路

将 OpenSpec 的 Spec 驱动开发理念与 WorkGear 的流程引擎深度融合：

- **宏观层面**：WorkGear 流程引擎编排 "需求 → Spec → 实施 → Review → 归档" 的完整生命周期
- **微观层面**：Agent 在 Docker 容器内使用 OpenSpec CLI 管理用户项目 Git 仓库中的 `openspec/` 目录
- **数据存储**：Spec 数据以 Git 仓库中的 `openspec/` 目录为 Source of Truth，WorkGear 不在数据库中冗余存储

---

## 一、整体架构

```
WorkGear 流程引擎（宏观编排）
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  human_input     agent_task      human_review    agent_task         │
│  (提交需求)  →  (Spec 规划)  →  (Review Spec) → (实施代码)  → ... │
│                  mode: spec      approve/reject   mode: execute     │
│                  ↓                                ↓                 │
│           Docker 容器内                     Docker 容器内           │
│     ┌──────────────────┐              ┌──────────────────┐         │
│     │ git clone repo   │              │ git clone repo   │         │
│     │ openspec init    │              │ openspec 读取    │         │
│     │ /opsx:new        │              │ tasks.md         │         │
│     │ /opsx:ff         │              │ /opsx:apply      │         │
│     │ git push         │              │ git push         │         │
│     └──────────────────┘              └──────────────────┘         │
│                                                                     │
│                    用户 Git 仓库中的 openspec/ 目录                  │
│                    ┌─────────────────────────────────┐              │
│                    │ openspec/                        │              │
│                    │ ├── specs/        (Source of Truth)             │
│                    │ ├── changes/      (进行中的变更)  │              │
│                    │ │   ├── feat-xxx/ (当前变更)     │              │
│                    │ │   └── archive/  (历史归档)     │              │
│                    │ └── config.yaml   (项目配置)     │              │
│                    └─────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、新增 agent_task mode: `opsx_plan` 和 `opsx_apply`

### 2.1 现有 mode 回顾

当前 `agent_task` 支持三种 mode：
- `spec` — Agent 只输出计划，不执行代码
- `execute` — Agent 执行代码变更
- `review` — Agent 做 Code Review

### 2.2 新增两种 OpenSpec 专用 mode

| mode | 说明 | Agent 在容器内的行为 |
|------|------|---------------------|
| `opsx_plan` | Spec 规划阶段 | `openspec init`（首次）→ `/opsx:new <change-name>` → `/opsx:ff` → `git push` |
| `opsx_apply` | Spec 实施阶段 | 读取 `openspec/changes/<name>/tasks.md` → `/opsx:apply` → `git push` |

也可以不新增 mode，而是通过 `prompt_template` + 现有 `spec`/`execute` mode 配合 OpenSpec CLI 来实现（更灵活但约束更弱）。建议先用新增 mode 的方式，语义更清晰。

### 2.3 DSL 示例：Spec 驱动开发流水线

```yaml
name: "openspec-dev-pipeline"
version: "1.0"
description: "基于 OpenSpec 的 Spec 驱动开发流水线"

variables:
  project_id: ""
  requirement_text: ""
  git_repo: ""
  git_base_branch: "main"
  change_name: ""          # OpenSpec change 名称

nodes:
  # ─── 阶段 1：提交需求 ───
  - id: submit_requirement
    name: "提交需求"
    type: human_input
    config:
      form:
        - field: requirement_text
          type: textarea
          label: "需求描述"
          required: true
        - field: change_name
          type: text
          label: "变更名称（英文，如 add-dark-mode）"
          required: true
    outputs:
      requirement_text: "{{form.requirement_text}}"
      change_name: "{{form.change_name}}"

  # ─── 阶段 2：Agent 生成 Spec（proposal + specs + design + tasks）───
  - id: generate_spec
    name: "Agent 生成 Spec"
    type: agent_task
    agent:
      role: "spec-architect"
    config:
      mode: opsx_plan
      opsx:
        change_name: "{{nodes.submit_requirement.outputs.change_name}}"
        schema: "spec-driven"          # 可选，默认 spec-driven
        init_if_missing: true          # 首次自动 openspec init
      prompt_template: |
        请基于以下需求，使用 OpenSpec 工作流生成完整的规划文档：
        
        需求描述：{{nodes.submit_requirement.outputs.requirement_text}}
        
        你需要：
        1. 创建 OpenSpec change: {{nodes.submit_requirement.outputs.change_name}}
        2. 生成 proposal.md（为什么做、做什么、影响范围）
        3. 生成 delta specs（ADDED/MODIFIED/REMOVED 需求和场景）
        4. 生成 design.md（技术方案、数据流、文件变更）
        5. 生成 tasks.md（按模块分组的实施清单）
      output_schema:
        type: object
        properties:
          change_name: { type: string }
          artifacts_created: { type: array, items: { type: string } }
          proposal_summary: { type: string }
          task_count: { type: integer }
    timeout: 600s

  # ─── 阶段 3：人工 Review Spec ───
  - id: review_spec
    name: "Review Spec 文档"
    type: human_review
    config:
      review_target: "{{nodes.generate_spec.outputs}}"
      # 前端展示 openspec/changes/<name>/ 下的所有 artifact
      show_artifacts: true
      artifact_paths:
        - "openspec/changes/{{variables.change_name}}/proposal.md"
        - "openspec/changes/{{variables.change_name}}/specs/"
        - "openspec/changes/{{variables.change_name}}/design.md"
        - "openspec/changes/{{variables.change_name}}/tasks.md"
      actions:
        - approve
        - reject
        - edit            # 人工直接编辑 artifact 文件
    on_reject:
      goto: generate_spec
      inject:
        feedback: "{{review.comment}}"
      max_loops: 3

  # ─── 阶段 4：Agent 按 tasks.md 实施代码 ───
  - id: implement_code
    name: "Agent 实施代码"
    type: agent_task
    agent:
      role: "general-developer"
    config:
      mode: opsx_apply
      opsx:
        change_name: "{{nodes.submit_requirement.outputs.change_name}}"
      prompt_template: |
        请按照 OpenSpec 的 tasks.md 实施所有任务。
        
        变更名称：{{nodes.submit_requirement.outputs.change_name}}
        
        要求：
        1. 读取 openspec/changes/{{variables.change_name}}/tasks.md
        2. 逐项实施，完成后在 tasks.md 中打勾 [x]
        3. 确保代码符合 design.md 中的技术方案
        4. 实施完成后 git commit && git push
      git:
        create_branch: true
        branch_pattern: "feat/{{variables.change_name}}"
        auto_commit: true
    timeout: 1200s

  # ─── 阶段 5：Agent Code Review ───
  - id: code_review
    name: "Agent Code Review"
    type: agent_task
    agent:
      role: "code-reviewer"
    config:
      mode: review
      prompt_template: |
        请 Review 以下代码变更，对照 OpenSpec 的 specs 和 design 文档：
        
        变更名称：{{variables.change_name}}
        Spec 文档：openspec/changes/{{variables.change_name}}/
        代码分支：feat/{{variables.change_name}}
        
        检查维度：
        1. 完整性：所有 tasks.md 中的任务是否都已实施
        2. 正确性：实施是否符合 specs 中的需求和场景
        3. 一致性：代码是否符合 design.md 中的技术方案

  # ─── 阶段 6：人工最终确认 ───
  - id: final_review
    name: "人工最终确认"
    type: human_review
    config:
      review_target:
        code_review: "{{nodes.code_review.outputs}}"
        spec_artifacts: "openspec/changes/{{variables.change_name}}/"
      actions: [approve, reject]
    on_reject:
      goto: implement_code
      inject:
        feedback: "{{review.comment}}"
      max_loops: 2

  # ─── 阶段 7：归档 Spec ───
  - id: archive_spec
    name: "归档 Spec"
    type: agent_task
    agent:
      role: "spec-architect"
    config:
      mode: opsx_plan    # 复用 plan mode 执行归档
      opsx:
        change_name: "{{nodes.submit_requirement.outputs.change_name}}"
        action: archive   # 特殊动作：执行 /opsx:archive
      prompt_template: |
        请归档已完成的 OpenSpec 变更：
        1. 执行 /opsx:sync 将 delta specs 合并到主 specs
        2. 执行 /opsx:archive 将变更移到 archive/
        3. git commit && git push

edges:
  - from: submit_requirement
    to: generate_spec
  - from: generate_spec
    to: review_spec
  - from: review_spec
    to: implement_code
  - from: implement_code
    to: code_review
  - from: code_review
    to: final_review
  - from: final_review
    to: archive_spec
```

---

## 三、Docker Agent 镜像增强

### 3.1 在 Agent 镜像中预装 OpenSpec CLI

修改 `docker/agent-claude/Dockerfile`：

```dockerfile
FROM node:22-slim

# 安装基础工具
RUN apt-get update && apt-get install -y git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# 安装 Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# 安装 OpenSpec CLI（新增）
RUN npm install -g @fission-ai/openspec@latest

# 创建工作目录
RUN mkdir -p /workspace /output

WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

### 3.2 entrypoint.sh 增强

```bash
#!/bin/bash
set -e

# 1. Clone 仓库
git clone "$GIT_REPO_URL" --branch "$GIT_BRANCH" /workspace
cd /workspace

# 2. 如果是 opsx_plan 或 opsx_apply mode，确保 openspec 已初始化
if [ "$AGENT_MODE" = "opsx_plan" ] || [ "$AGENT_MODE" = "opsx_apply" ]; then
  if [ ! -d "openspec" ] && [ "$OPSX_INIT_IF_MISSING" = "true" ]; then
    openspec init --non-interactive
  fi
fi

# 3. 执行 Claude
claude -p "$AGENT_PROMPT" --output-format json > /output/result.json

# 4. Git push（如果有变更）
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "${GIT_COMMIT_MSG:-"agent: auto commit"}"
  git push origin "$GIT_BRANCH"
fi

# 5. 输出结果
cat /output/result.json
```

---

## 四、ClaudeCodeAdapter 增强（Go 侧）

### 4.1 新增环境变量传递

在 `claude_adapter.go` 的 `BuildRequest()` 中，根据 mode 注入额外环境变量：

```go
func (a *ClaudeCodeAdapter) BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error) {
    prompt := a.promptBuilder.Build(req)
    
    env := map[string]string{
        "AGENT_PROMPT":    prompt,
        "GIT_REPO_URL":    req.GitRepoURL,
        "GIT_BRANCH":      req.GitBranch,
        "AGENT_MODE":      string(req.Mode),
        // ... 现有环境变量
    }
    
    // OpenSpec 专用环境变量
    if req.Mode == "opsx_plan" || req.Mode == "opsx_apply" {
        if opsx := req.OpsxConfig; opsx != nil {
            env["OPSX_CHANGE_NAME"] = opsx.ChangeName
            env["OPSX_SCHEMA"] = opsx.Schema
            env["OPSX_INIT_IF_MISSING"] = strconv.FormatBool(opsx.InitIfMissing)
            if opsx.Action != "" {
                env["OPSX_ACTION"] = opsx.Action  // "archive" 等
            }
        }
    }
    
    return &ExecutorRequest{
        Image:   a.dockerImage,
        Env:     env,
        Timeout: req.Timeout,
    }, nil
}
```

### 4.2 PromptBuilder 增强

为 `opsx_plan` 和 `opsx_apply` mode 添加专用的模式指令：

```go
var modeInstructions = map[string]string{
    "spec": "只输出计划和分析，不要修改任何代码文件。",
    "execute": "按照计划执行代码变更，确保所有修改都有对应的 git commit。",
    "review": "审查代码变更，输出问题列表和改进建议。",
    
    // 新增
    "opsx_plan": `你正在使用 OpenSpec 工作流。请按以下步骤操作：
1. 如果项目中没有 openspec/ 目录，先运行 openspec init
2. 运行 openspec 创建新的 change（使用环境变量 OPSX_CHANGE_NAME）
3. 生成所有规划 artifact（proposal.md, specs/, design.md, tasks.md）
4. 确保所有文件都已 git add
注意：使用 Given/When/Then 格式编写 specs 中的场景。`,
    
    "opsx_apply": `你正在使用 OpenSpec 工作流执行实施。请按以下步骤操作：
1. 读取 openspec/changes/<change-name>/tasks.md 获取任务清单
2. 读取 design.md 了解技术方案
3. 逐项实施任务，完成后在 tasks.md 中标记 [x]
4. 确保实施符合 specs/ 中定义的需求和场景
5. 所有代码变更都要 git commit`,
}
```

---

## 五、DSL Parser 增强

### 5.1 新增 opsx 配置块解析

在 `dsl_parser.go` 中，为 `agent_task` 节点的 config 新增 `opsx` 字段：

```go
type AgentTaskConfig struct {
    Mode           string            `yaml:"mode"`
    PromptTemplate string            `yaml:"prompt_template"`
    OutputSchema   map[string]any    `yaml:"output_schema"`
    Git            *GitConfig        `yaml:"git"`
    Opsx           *OpsxConfig       `yaml:"opsx"`  // 新增
}

type OpsxConfig struct {
    ChangeName    string `yaml:"change_name"`
    Schema        string `yaml:"schema"`
    InitIfMissing bool   `yaml:"init_if_missing"`
    Action        string `yaml:"action"`  // "", "archive", "sync"
}
```

### 5.2 表达式解析支持

`change_name` 等字段支持模板表达式，在运行时解析：

```go
func (e *FlowExecutor) resolveOpsxConfig(ctx context.Context, config *OpsxConfig, nodeRun *NodeRun) *OpsxConfig {
    if config == nil {
        return nil
    }
    return &OpsxConfig{
        ChangeName:    e.resolveExpression(config.ChangeName, nodeRun.Input),
        Schema:        config.Schema,
        InitIfMissing: config.InitIfMissing,
        Action:        config.Action,
    }
}
```

---

## 六、前端 Review 界面增强

### 6.1 Spec Artifact 查看器

当 `human_review` 节点配置了 `show_artifacts: true` 时，前端需要：

1. 通过 API 从 Git 仓库获取 `openspec/changes/<name>/` 下的文件内容
2. 以 Markdown 渲染展示 proposal.md、design.md、tasks.md
3. specs/ 目录下的 delta spec 文件用结构化视图展示（ADDED/MODIFIED/REMOVED 分色标注）

### 6.2 新增 API 端点

```
GET /api/projects/:projectId/openspec/changes/:changeName
  → 返回该 change 下所有 artifact 文件列表和内容

GET /api/projects/:projectId/openspec/specs
  → 返回当前 Source of Truth 的 spec 文件列表

GET /api/projects/:projectId/openspec/changes/:changeName/artifacts/:path
  → 返回指定 artifact 文件内容（Markdown）
```

这些 API 通过 Git 操作（`git show` 或 clone）从用户仓库读取文件。

### 6.3 人工编辑 Artifact

`human_review` 的 `edit` 动作允许人工直接编辑 artifact 文件：

1. 前端提供 Monaco Editor 编辑 Markdown
2. 编辑后通过 API 提交变更
3. API Server 将变更 commit 到 Git 仓库
4. 流程继续（不触发打回）

---

## 七、内置流程模板

### 7.1 新增 "Spec 驱动开发" 模板

在 WorkGear 的内置模板库中新增一个基于 OpenSpec 的模板：

```yaml
# templates/openspec-dev-pipeline.yaml
name: "Spec 驱动开发流水线"
description: "基于 OpenSpec 的规范化开发流程：需求 → Spec → Review → 实施 → 归档"
category: "development"
params:
  - name: change_name
    label: "变更名称"
    type: text
    required: true
    placeholder: "add-dark-mode"
  - name: spec_schema
    label: "Spec Schema"
    type: select
    options: ["spec-driven", "rapid"]
    default: "spec-driven"
  - name: max_review_loops
    label: "最大 Review 打回次数"
    type: number
    default: 3
  - name: agent_model
    label: "Agent 模型"
    type: select
    options: ["claude-sonnet-3.5", "claude-opus-4"]
    default: "claude-sonnet-3.5"
```

### 7.2 OpenSpec 项目初始化模板

另外提供一个一次性的 "项目初始化" 模板，用于在用户项目中首次设置 OpenSpec：

```yaml
name: "OpenSpec 项目初始化"
description: "在项目 Git 仓库中初始化 OpenSpec 目录结构和配置"
nodes:
  - id: init_openspec
    type: agent_task
    config:
      mode: opsx_plan
      opsx:
        init_if_missing: true
      prompt_template: |
        请在项目中初始化 OpenSpec：
        1. 运行 openspec init
        2. 根据项目的 README 和代码结构，生成合适的 openspec/config.yaml
        3. 为项目现有的核心功能编写初始 specs（Source of Truth）
        4. git commit -m "chore: initialize OpenSpec" && git push
```

---

## 八、OpenSpec config.yaml 自动生成

当用户在 WorkGear 中创建项目并绑定 Git 仓库时，Agent 可以根据仓库内容自动生成 `openspec/config.yaml`。

这通过 "OpenSpec 项目初始化" 流程模板实现，Agent 会：

1. 分析仓库的 `README.md`、`package.json`、目录结构等
2. 推断技术栈和项目约定
3. 生成定制化的 `config.yaml`（包含 context 和 rules）
4. 为已有功能编写初始 specs

---

## 九、Spec 演进的完整生命周期

```
用户在 WorkGear 创建 Task
        │
        ▼
选择 "Spec 驱动开发" 模板，填写变更名称
        │
        ▼
┌─ Agent (opsx_plan mode) ─────────────────────────────┐
│  1. git clone 用户仓库                                │
│  2. openspec init（如果首次）                          │
│  3. 创建 openspec/changes/<name>/                     │
│  4. 生成 proposal.md + specs/ + design.md + tasks.md  │
│  5. git push                                          │
└───────────────────────────────────────────────────────┘
        │
        ▼
人工 Review Spec（在 WorkGear 前端查看/编辑 artifact）
  ├─ approve → 继续
  └─ reject  → 回到 Agent 重新生成（带反馈）
        │
        ▼
┌─ Agent (opsx_apply mode) ────────────────────────────┐
│  1. git clone 用户仓库（feat 分支）                    │
│  2. 读取 tasks.md，逐项实施                           │
│  3. 完成后在 tasks.md 中打勾 [x]                      │
│  4. git push                                          │
└───────────────────────────────────────────────────────┘
        │
        ▼
Agent Code Review（对照 specs + design 检查实施）
        │
        ▼
人工最终确认
  ├─ approve → 继续
  └─ reject  → 回到实施（带反馈）
        │
        ▼
┌─ Agent (archive) ────────────────────────────────────┐
│  1. /opsx:sync — delta specs 合并到 openspec/specs/  │
│  2. /opsx:archive — 变更移到 archive/                 │
│  3. git push                                          │
└───────────────────────────────────────────────────────┘
        │
        ▼
openspec/specs/ 更新为最新的 Source of Truth
下次变更基于更新后的 specs 进行增量开发
```

---

## 十、实施步骤

| 阶段 | 内容 | 涉及 package | 工作量 |
|------|------|-------------|--------|
| 1 | Docker 镜像增强：预装 OpenSpec CLI | docker/ | 小 |
| 2 | DSL Parser 增强：支持 `opsx` 配置块 | orchestrator | 小 |
| 3 | ClaudeCodeAdapter 增强：opsx_plan/opsx_apply mode | orchestrator | 中 |
| 4 | PromptBuilder 增强：OpenSpec 专用模式指令 | orchestrator | 小 |
| 5 | 新增内置流程模板："Spec 驱动开发流水线" | api (seed data) | 小 |
| 6 | 前端 Spec Artifact 查看器 | web | 中 |
| 7 | API 端点：读取 Git 仓库中的 openspec 文件 | api | 中 |
| 8 | 人工编辑 Artifact 并 commit 回 Git | api + web | 中 |

建议按 1→2→3→4→5 的顺序先完成后端核心能力，再做 6→7→8 的前端展示。阶段 1-5 完成后即可通过 CLI/API 跑通完整流程。
