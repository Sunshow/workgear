# Proposal: Git Diff Viewer Link — 变更文件可点击跳转 Diff 查看

## 背景（Why）

当前 Git Tab 的「变更文件」区域仅以纯文本形式展示文件路径列表，用户无法直接点击文件查看具体的代码变更内容。要查看某个文件的 diff，用户必须手动复制文件名，切换到 GitHub/GitLab 的 PR 页面，再定位到对应文件——这个流程繁琐且打断工作心流。

### 用户痛点

- 变更文件列表是纯文本，无法点击交互
- 查看文件 diff 需要手动跳转到 PR 页面并搜索文件
- 没有 PR 时（仅有 commit），完全无法从 WorkGear 内查看 diff
- 文件变更类型（新增/修改/删除）不可见，无法快速判断变更范围
- commit hash 也是纯文本，无法跳转到对应的 commit 详情页

### 根因分析

Git Tab（`git-tab.tsx`）的 Changed Files 区域仅渲染 `<code>` 标签展示文件名，没有构建指向 Git 平台 diff 页面的链接。同时，Orchestrator 推送的 `git_pushed` 事件中只包含 `changed_files: string[]`，缺少文件变更类型（added/modified/deleted）信息。Commit 记录同样只展示 hash 文本，未链接到 Git 平台的 commit 详情页。

## 目标（What）

为 Git Tab 的变更文件和 commit 记录添加可点击的外部链接，让用户一键跳转到 Git 平台查看 diff 详情：

| 元素 | 当前状态 | 目标状态 |
|------|----------|----------|
| 变更文件名 | 纯文本 | 可点击，跳转到 PR diff 页面对应文件锚点 |
| 文件变更类型 | 不显示 | 显示 A/M/D 标记（Added/Modified/Deleted） |
| Commit hash | 纯文本 | 可点击，跳转到 Git 平台 commit 详情页 |
| 无 PR 时的文件 | 纯文本 | 可点击，跳转到 commit diff 页面 |

### 具体方案

1. 变更文件列表中每个文件增加「View Diff」外部链接按钮，构建 GitHub PR file diff URL（`{prUrl}/files#diff-{sha256(filePath)}`）
2. 当无 PR 但有 commit 时，链接指向 commit diff 页面（`{repoUrl}/commit/{hash}#diff-{sha256(filePath)}`）
3. Orchestrator 的 `git_pushed` 事件增加文件变更类型信息（`changed_files_detail: [{path, status}]`）
4. 前端展示文件变更类型标记（A = 绿色, M = 黄色, D = 红色）
5. Commit hash 增加外部链接，跳转到 Git 平台 commit 详情页

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| kanban (Git Tab) | 代码变更 | `git-tab.tsx` 增加链接构建逻辑和 UI 交互 |
| orchestrator | 代码变更 | `adapter.go` / `node_handlers.go` 增加文件变更类型信息 |
| artifact | Spec 更新 | 补充 Git 产物的链接行为规范 |
| api | Spec 更新 | 补充 timeline 事件内容格式变更 |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/src/pages/kanban/task-detail/git-tab.tsx` | MODIFY | 增加 diff 链接、文件类型标记、commit 链接 |
| `packages/orchestrator/internal/agent/adapter.go` | MODIFY | `ChangedFiles` 扩展为包含 status 的结构体 |
| `packages/orchestrator/internal/engine/node_handlers.go` | MODIFY | 推送 `changed_files_detail` 到 timeline 事件 |

### 不涉及

- 不新增 API 路由（链接在前端构建，直接跳转外部 Git 平台）
- 不实现内嵌 diff 查看器（仅外部链接跳转，避免引入复杂的 diff 渲染依赖）
- 数据库 schema 无变更（timeline_events.content 为 jsonb，天然支持扩展字段）
- PR 创建/合并逻辑不变

## 非目标

- 不实现 WorkGear 内嵌的 diff 渲染器（如 Monaco diff editor），当前阶段仅做外部链接跳转
- 不支持 GitLab / Bitbucket 等非 GitHub 平台的 diff URL 格式（后续迭代）
- 不实现文件级别的 review comment 功能
- 不实现 diff 内容缓存或离线查看

## 风险评估

- **风险等级：低** — 变更集中在前端 UI 层和 Orchestrator 事件数据，不影响核心流程执行
- GitHub diff URL 的锚点格式（`#diff-{sha256}`）依赖 GitHub 的 URL 规则，如果 GitHub 变更 URL 格式可能失效，但影响仅限于链接跳转
- Orchestrator 事件格式扩展向后兼容（新增 `changed_files_detail` 字段，保留原 `changed_files` 字段）
