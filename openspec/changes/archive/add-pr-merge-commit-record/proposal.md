# Proposal: PR Merge Commit Record — 记录 PR 合并的 Merge Commit 信息

## 背景（Why）

当前系统在 PR 合并（自动或手动）成功后，仅记录了合并时间戳（`flow_runs.pr_merged_at`）和一条简单的 `pr_merged` timeline 事件（内容仅包含 `prUrl` 和 `message`）。然而，GitHub Merge API 的响应中包含了 merge commit 的 SHA 和 message，这些关键信息被丢弃了。

### 用户痛点

- PR 合并后无法在 WorkGear 内查看 merge commit 的 SHA，需要手动去 GitHub 查找
- 无法从 WorkGear 一键跳转到 merge commit 详情页
- `pr_merged` timeline 事件缺少 merge commit 信息，无法追溯合并的具体内容
- Git Tab 的 PR 区域在「已合并」状态下只显示时间戳，缺少 merge commit 链接
- 提交记录列表中不包含 merge commit，信息不完整

### 根因分析

`GitHubProvider.mergePullRequest()` 已经从 GitHub API 响应中解析了 `sha` 字段（`MergePullRequestResult.sha`），但调用方（`handleFlowCompletedAutoMerge` 和手动 merge 路由）未将此信息持久化。`flow_runs` 表缺少 `merge_commit_sha` 列，`pr_merged` timeline 事件的 content 也未包含 merge commit 相关字段。

## 目标（What）

在 PR 合并成功后，完整记录 merge commit 信息，并在前端 Git Tab 中展示：

| 元素 | 当前状态 | 目标状态 |
|------|----------|----------|
| Merge commit SHA | 不记录 | 存储到 `flow_runs.merge_commit_sha`，展示在 Git Tab |
| Merge commit 链接 | 不存在 | PR 区域显示可点击的 merge commit 短 hash，跳转 GitHub |
| `pr_merged` 事件 | 仅含 prUrl + message | 增加 `merge_commit_sha` 字段 |
| 提交记录列表 | 仅含 feature branch commits | 合并后追加 merge commit 条目 |

### 具体方案

1. `flow_runs` 表新增 `merge_commit_sha` 列（varchar(100)），存储 GitHub 返回的 merge commit SHA
2. 自动合并和手动合并成功后，将 `mergeResult.sha` 写入 `flow_runs.merge_commit_sha`
3. `pr_merged` timeline 事件的 content 增加 `merge_commit_sha` 字段
4. 前端 Git Tab PR 区域在「已合并」状态下显示 merge commit 短 hash（可点击跳转）
5. 前端提交记录列表中，如果 PR 已合并，追加一条 merge commit 条目

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| flow-engine | Spec 更新 | 补充 merge commit 记录的行为规范 |
| api | 代码变更 + Spec 更新 | DB schema 新增列、merge 逻辑写入 SHA、timeline 事件增强 |
| kanban (Git Tab) | 代码变更 + Spec 更新 | 展示 merge commit 信息和链接 |
| artifact | Spec 更新 | 补充 merge 事件的数据格式规范 |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/api/src/db/schema.ts` | MODIFY | `flow_runs` 表新增 `merge_commit_sha` 列 |
| `packages/api/src/ws/gateway.ts` | MODIFY | `handleFlowCompletedAutoMerge` 写入 merge commit SHA |
| `packages/api/src/routes/flow-runs.ts` | MODIFY | 手动 merge 路由写入 merge commit SHA |
| `packages/api/src/db/migrations/` | ADD | 新增 migration 添加 `merge_commit_sha` 列 |
| `packages/web/src/pages/kanban/task-detail/git-tab.tsx` | MODIFY | 展示 merge commit 信息 |
| `packages/web/src/lib/types.ts` | MODIFY | `FlowRun` 类型新增 `mergeCommitSha` 字段 |

### 不涉及

- Orchestrator (Go) 无变更 — merge 操作在 API Server (Node.js) 层执行
- `git-provider.ts` / `github-provider.ts` 无变更 — 已正确返回 `sha` 字段
- 数据库 `timeline_events` 表结构无变更 — content 为 jsonb，天然支持扩展
- PR 创建 / git push 逻辑不变

## 非目标

- 不实现 merge commit 的 diff 内容展示（仅链接跳转到 GitHub）
- 不实现 merge commit 的文件变更列表（merge commit 通常是 squash 后的汇总，与 feature commits 重复）
- 不回填历史已合并 PR 的 merge commit SHA（仅新合并的 PR 记录）
- 不修改 merge 策略（保持 squash merge）

## 风险评估

- **风险等级：低** — 变更集中在 merge 成功后的数据记录和前端展示，不影响核心合并逻辑
- `mergeResult.sha` 在 GitHub API 成功响应中始终存在，不存在取不到的情况
- DB migration 仅新增可空列，不影响现有数据
- 前端展示对 `mergeCommitSha` 为 null 的情况优雅降级（不显示链接）
