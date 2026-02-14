# OpenSpec 用户使用指南

> 本文档面向 WorkGear 用户，介绍如何在项目中使用 OpenSpec 流程模板进行 Spec 驱动开发。

---

## 目录

- [什么是 OpenSpec](#什么是-openspec)
- [前置条件](#前置条件)
- [快速开始：初始化 OpenSpec](#快速开始初始化-openspec)
- [日常使用：Spec 驱动开发流水线](#日常使用spec-驱动开发流水线)
- [Review Spec 文档](#review-spec-文档)
- [OpenSpec 目录结构](#openspec-目录结构)
- [自定义流程模板](#自定义流程模板)
- [常见问题](#常见问题)

---

## 什么是 OpenSpec

OpenSpec 是一套规范驱动开发（Spec-Driven Development, SDD）方法论。核心理念是：

1. **先规划，后编码** — Agent 在写代码之前，先生成结构化的规划文档（Spec）
2. **Source of Truth** — 项目的功能规范以 Spec 文件形式维护在 Git 仓库中，作为唯一的真实来源
3. **增量演进** — 每次变更通过 delta spec 描述新增/修改/删除的需求，完成后合并到主 Spec

WorkGear 集成了 OpenSpec，让你可以通过内置的流程模板，让 Agent 按照 SDD 方法论自动执行开发任务。

### 与传统流程的区别

| 传统流程 | OpenSpec 流程 |
|---------|-------------|
| Agent 直接写代码 | Agent 先生成 Spec，Review 后再写代码 |
| 需求在 Task 描述中 | 需求结构化为 specs 文件（Given/When/Then） |
| 无历史追溯 | 每次变更有完整的 proposal → specs → design → tasks 记录 |
| 代码是唯一产出 | Spec + 代码双产出，Spec 持续演进 |

---

## 前置条件

1. **项目已配置 Git 仓库** — 在 WorkGear 中创建项目时，需要填写 Git 仓库地址（`gitRepoUrl`）
2. **Agent 已配置** — Orchestrator 已配置 Anthropic API Key，Docker 镜像已构建
3. **种子数据已导入** — 运行过 `pnpm db:seed` 导入内置流程模板

---

## 快速开始：初始化 OpenSpec

首次在项目中使用 OpenSpec 时，需要先初始化 `openspec/` 目录结构。

### 步骤 1：创建 Task

在项目看板的 Backlog 列中创建一个新 Task，标题如 "初始化 OpenSpec"。

### 步骤 2：选择模板并启动流程

1. 在 Task 详情中点击 "启动任务"
2. 选择 **"OpenSpec 项目初始化"** 模板
3. 配置参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| Spec 架构师角色 | 执行初始化的 Agent 角色 | `spec-architect` |
| AI 模型 | 使用的 Claude 模型 | `claude-sonnet` |

4. 点击 "启动"

### 步骤 3：Agent 执行初始化

Agent 会自动：
- 克隆你的 Git 仓库
- 运行 `openspec init` 创建目录结构
- 分析项目的 README、package.json、代码结构
- 生成 `openspec/config.yaml` 配置文件
- 为项目现有功能编写初始 specs（Source of Truth）
- 将所有文件 commit 并 push 到仓库

### 步骤 4：Review 初始化结果

流程进入 "Review 初始化结果" 节点，你可以：
- 查看 Agent 生成的 `openspec/config.yaml` 和 `openspec/specs/` 文件
- 如果满意，点击 **Approve**
- 如果需要调整，点击 **Reject** 并填写反馈，Agent 会根据反馈重新生成

初始化完成后，你的 Git 仓库中会出现以下结构：

```
your-project/
├── openspec/
│   ├── config.yaml          # 项目配置
│   └── specs/               # Source of Truth
│       ├── auth.md           # 认证模块规范
│       ├── user-management.md # 用户管理规范
│       └── ...               # 其他模块
├── src/
└── ...
```

---

## 日常使用：Spec 驱动开发流水线

初始化完成后，每次新需求都可以使用 "Spec 驱动开发流水线" 模板。

### 步骤 1：创建 Task 并启动流程

1. 在看板中创建新 Task
2. 选择 **"Spec 驱动开发流水线"** 模板
3. 配置参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| Spec 架构师角色 | 生成 Spec 的 Agent 角色 | `spec-architect` |
| Agent 开发者角色 | 实施代码的 Agent 角色 | `general-developer` |
| Agent Reviewer 角色 | Code Review 的 Agent 角色 | `code-reviewer` |
| AI 模型 | 使用的 Claude 模型 | `claude-sonnet` |
| Spec Schema | OpenSpec schema 类型 | `spec-driven` |
| Spec Review 最大打回次数 | Spec 被 Reject 后最多重试几次 | `3` |
| Code Review 最大打回次数 | 代码被 Reject 后最多重试几次 | `2` |

4. 点击 "启动"

### 步骤 2：提交需求（阶段 1）

流程首先进入 "提交需求" 节点，你需要填写：

- **需求描述** — 详细描述你想要实现的功能
- **变更名称** — 英文标识符，如 `add-dark-mode`、`fix-login-timeout`

> 变更名称会用于创建 `openspec/changes/<变更名称>/` 目录和 Git 分支名。

### 步骤 3：Agent 生成 Spec（阶段 2）

Agent（spec-architect 角色）会自动：

1. 克隆仓库，读取现有的 `openspec/specs/`（Source of Truth）
2. 创建 `openspec/changes/<变更名称>/` 目录
3. 生成以下规划文档：

| 文件 | 内容 |
|------|------|
| `proposal.md` | 为什么做、做什么、影响范围、风险评估 |
| `specs/` | Delta spec 文件，描述新增/修改/删除的需求和场景（Given/When/Then 格式） |
| `design.md` | 技术方案、数据流、涉及的文件变更清单 |
| `tasks.md` | 按模块分组的实施任务清单（`[ ]` 复选框格式） |

4. 将所有文件 commit 并 push

### 步骤 4：Review Spec（阶段 3）

这是最关键的人工环节。流程进入 "Review Spec 文档" 节点：

- 在 Spec Artifact 查看器中逐个查看 proposal、specs、design、tasks
- 确认需求理解是否正确、技术方案是否合理、任务拆分是否完整
- 三种操作：
  - **Approve** — 确认 Spec，进入实施阶段
  - **Reject** — 填写反馈，Agent 根据反馈重新生成 Spec
  - **Edit** — 直接在线编辑 artifact 文件（修改后自动 commit 回 Git）

> 建议重点关注 `specs/` 中的场景定义和 `tasks.md` 中的任务清单，这两个文件直接指导 Agent 的实施行为。

### 步骤 5：Agent 实施代码（阶段 4）

Spec 通过 Review 后，Agent（general-developer 角色）会：

1. 克隆仓库，创建 `feat/<变更名称>` 分支
2. 读取 `tasks.md` 获取任务清单
3. 参考 `design.md` 和 `specs/` 逐项实施
4. 完成的任务在 `tasks.md` 中标记 `[x]`
5. 代码 commit 并 push 到 feat 分支

### 步骤 6：Agent Code Review（阶段 5）

Agent（code-reviewer 角色）会对照 Spec 文档审查代码：

- 检查 tasks.md 中的任务是否全部完成
- 检查实施是否符合 specs 中的场景定义
- 检查代码是否符合 design.md 中的技术方案
- 输出结构化的审查报告

### 步骤 7：人工最终确认（阶段 6）

你可以查看 Agent 的 Code Review 报告和 Spec 文档：

- **Approve** — 确认代码，进入归档阶段
- **Reject** — 填写反馈，Agent 根据反馈重新实施代码

### 步骤 8：归档 Spec（阶段 7）

Agent 自动执行归档操作：

1. 将 `openspec/changes/<变更名称>/specs/` 中的 delta specs 合并到 `openspec/specs/`（更新 Source of Truth）
2. 将 `openspec/changes/<变更名称>/` 移动到 `openspec/changes/archive/`
3. Commit 并 push

归档完成后，`openspec/specs/` 中的内容已更新为最新的完整规范，下次变更将基于更新后的 Spec 进行增量开发。

---

## Review Spec 文档

### Spec Artifact 查看器

当流程进入 `human_review` 节点且配置了 `show_artifacts: true` 时，前端会显示 Spec Artifact 查看器。

查看器包含 4 个 Tab：

| Tab | 内容 | 关注点 |
|-----|------|--------|
| Proposal | proposal.md | 需求理解是否正确、影响范围是否完整 |
| Specs | specs/ 目录下的 delta spec 文件 | Given/When/Then 场景是否覆盖所有用例 |
| Design | design.md | 技术方案是否合理、文件变更清单是否完整 |
| Tasks | tasks.md | 任务拆分是否合理、粒度是否适当 |

### 在线编辑

如果 Review 节点配置了 `edit` 操作，你可以直接在查看器中编辑 artifact 文件：

1. 点击文件右上角的 "编辑" 按钮
2. 在文本编辑器中修改内容
3. 点击 "保存"，修改会自动 commit 到 Git 仓库
4. 编辑不会触发打回，流程继续等待你的 Approve/Reject 决定

---

## OpenSpec 目录结构

```
your-project/
└── openspec/
    ├── config.yaml                    # 项目配置（技术栈、约定、规则）
    ├── specs/                         # Source of Truth（当前完整规范）
    │   ├── auth.md                    # 认证模块
    │   ├── user-management.md         # 用户管理
    │   └── ...
    └── changes/                       # 变更目录
        ├── add-dark-mode/             # 进行中的变更
        │   ├── proposal.md            # 提案
        │   ├── specs/                 # Delta specs
        │   │   ├── ADDED-dark-mode-toggle.md
        │   │   └── MODIFIED-theme-settings.md
        │   ├── design.md              # 技术方案
        │   └── tasks.md               # 任务清单
        └── archive/                   # 已完成的变更归档
            └── fix-login-timeout/
                ├── proposal.md
                ├── specs/
                ├── design.md
                └── tasks.md
```

### 关键概念

| 概念 | 说明 |
|------|------|
| Source of Truth | `openspec/specs/` 目录，包含项目当前的完整功能规范 |
| Change | 一次变更的完整规划，存放在 `openspec/changes/<name>/` |
| Delta Spec | 变更中新增/修改/删除的需求，文件名以 ADDED/MODIFIED/REMOVED 开头 |
| Archive | 已完成的变更归档，delta specs 已合并到 Source of Truth |

---

## 自定义流程模板

你可以基于内置的 OpenSpec 模板创建自定义流程。在项目的流程管理页面：

1. 点击 "创建流程"
2. 选择 "Spec 驱动开发流水线" 作为基础模板
3. 在 YAML 编辑器中修改

### 常见自定义场景

#### 跳过 Agent Code Review

删除 `code_review` 节点，将 `implement_code` 直接连接到 `final_review`：

```yaml
edges:
  - from: implement_code
    to: final_review    # 跳过 code_review
```

#### 增加测试验证阶段

在 `implement_code` 和 `code_review` 之间添加 QA 节点：

```yaml
nodes:
  # ... 其他节点 ...
  - id: run_tests
    name: "Agent 运行测试"
    type: agent_task
    agent:
      role: "qa-engineer"
    config:
      mode: execute
      prompt_template: |
        请运行项目的测试套件，验证变更是否引入了回归问题。
        变更名称：{{nodes.submit_requirement.outputs.change_name}}
    timeout: 600s

edges:
  - from: implement_code
    to: run_tests
  - from: run_tests
    to: code_review
```

#### 调整 Spec Schema

将 `spec_schema` 参数改为 `rapid` 可以使用更轻量的 Spec 格式，适合小型变更：

```yaml
opsx:
  schema: "rapid"    # 轻量模式，减少 artifact 数量
```

---

## 常见问题

### Q: 项目没有配置 Git 仓库，能用 OpenSpec 吗？

不能。OpenSpec 的所有 artifact 都存储在 Git 仓库的 `openspec/` 目录中，Agent 需要 clone 仓库来读写这些文件。请先在项目设置中配置 Git 仓库地址。

### Q: 多个 Task 可以同时使用 OpenSpec 吗？

可以。每个 Task 使用不同的 `change_name`，对应不同的 `openspec/changes/<name>/` 目录，互不干扰。但归档时需要注意顺序，因为 delta specs 合并到 Source of Truth 可能存在冲突。

### Q: Agent 生成的 Spec 质量不好怎么办？

1. 在 Review 阶段 Reject 并提供详细的反馈
2. 直接 Edit artifact 文件进行修改
3. 调整 `prompt_template` 中的指令，提供更多上下文
4. 考虑在 `openspec/config.yaml` 中添加项目特定的规则和约定

### Q: 归档后发现 Spec 有问题怎么办？

归档操作会将 delta specs 合并到 `openspec/specs/`。如果发现问题：
1. 可以手动编辑 `openspec/specs/` 中的文件并 commit
2. 或者创建一个新的 change 来修正 Spec

### Q: 如何查看历史变更？

已归档的变更保存在 `openspec/changes/archive/` 目录中，你可以通过 Git 历史或直接浏览该目录查看。

### Q: Spec Schema 的 `spec-driven` 和 `rapid` 有什么区别？

| Schema | 适用场景 | 产出 |
|--------|---------|------|
| `spec-driven` | 中大型功能开发 | 完整的 proposal + specs + design + tasks |
| `rapid` | 小型修复/调整 | 精简的 proposal + tasks |

---

**最后更新**: 2026-02-14
**适用版本**: Phase 4 (OpenSpec 集成)
