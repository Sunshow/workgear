# Tasks: PR Merge Commit Record — 记录 PR 合并的 Merge Commit 信息

## 模块：数据库 Schema (packages/api/src/db)

### 新增 merge_commit_sha 列

- [ ] 在 `schema.ts` 的 `flowRuns` 表定义中新增 `mergeCommitSha: varchar('merge_commit_sha', { length: 100 })` 列 **[S]**
- [ ] 生成 Drizzle migration 文件：`ALTER TABLE flow_runs ADD COLUMN merge_commit_sha varchar(100)` **[S]**
- [ ] 执行 migration 验证列已添加 **[S]**

## 模块：API 自动合并 (packages/api/src/ws)

### handleFlowCompletedAutoMerge 写入 merge commit SHA

- [ ] 在 `gateway.ts` 的 `handleFlowCompletedAutoMerge` 中，合并成功后将 `mergeResult.sha` 写入 `flow_runs.merge_commit_sha` **[S]**
- [ ] 将 `db.update(flowRuns).set({ prMergedAt })` 改为 `.set({ prMergedAt, mergeCommitSha: mergeResult.sha })` **[S]**
- [ ] 在 `pr_merged` timeline 事件的 content 中新增 `merge_commit_sha` 字段 **[S]**

## 模块：API 手动合并路由 (packages/api/src/routes)

### PUT /flow-runs/:id/merge-pr 写入 merge commit SHA

- [ ] 在 `flow-runs.ts` 的手动 merge 路由中，合并成功后将 `mergeResult.sha` 写入 `flow_runs.merge_commit_sha` **[S]**
- [ ] 将 `db.update(flowRuns).set({ prMergedAt })` 改为 `.set({ prMergedAt, mergeCommitSha: mergeResult.sha })` **[S]**
- [ ] 在 `pr_merged` timeline 事件的 content 中新增 `merge_commit_sha` 字段 **[S]**
- [ ] 修改成功返回值为 `{ merged: true, mergeCommitSha: mergeResult.sha }` **[S]**

## 模块：前端类型定义 (packages/web/src/lib)

### FlowRun 类型扩展

- [ ] 在 `types.ts` 的 `FlowRun` 接口中新增 `mergeCommitSha: string | null` 字段 **[S]**

## 模块：前端 Git Tab (packages/web/src/pages/kanban/task-detail)

### PR 区域展示 merge commit

- [ ] 在 `git-tab.tsx` PR 区域的合并时间戳下方，新增 merge commit 短 hash 展示 **[S]**
- [ ] 有 repoUrl 时渲染为 `<a>` 链接，指向 `{repoUrl}/commit/{mergeCommitSha}` **[S]**
- [ ] 无 repoUrl 时渲染为纯文本 `<code>` **[S]**
- [ ] `mergeCommitSha` 为 null 时不渲染（历史数据优雅降级） **[S]**

### 提交记录列表追加 merge commit

- [ ] 在提交记录列表末尾，当 `flowRun.mergeCommitSha` 存在时追加 merge commit 条目 **[M]**
- [ ] 条目使用 `GitMerge` 图标（紫色）区分普通 commit **[S]**
- [ ] 条目 message 显示为 `Merge PR #{prNumber}` **[S]**
- [ ] 条目与普通 commits 之间有视觉分隔（`bg-muted/20 border-t-2`） **[S]**
- [ ] 短 hash 可点击跳转（复用 `buildCommitUrl` 函数） **[S]**

## 测试验证

### 端到端验证

- [ ] 自动合并 → 检查 DB `flow_runs.merge_commit_sha` 已写入 **[S]**
- [ ] 手动合并 → 检查返回值包含 `mergeCommitSha` **[S]**
- [ ] Git Tab PR 区域 → 确认显示 merge commit 短 hash 和链接 **[S]**
- [ ] 点击 merge commit 链接 → 确认跳转到 GitHub commit 详情页 **[S]**
- [ ] 提交记录列表 → 确认末尾有 merge commit 条目，带 GitMerge 图标 **[S]**
- [ ] 历史已合并 PR（无 merge_commit_sha）→ 确认不显示链接，仅显示时间戳 **[S]**
- [ ] 合并失败 → 确认 merge_commit_sha 未写入 **[S]**
- [ ] `pr_merged` timeline 事件 → 确认 content 包含 `merge_commit_sha` 字段 **[S]**

## 模块：OpenSpec 文档

- [ ] 归档完成后更新 `openspec/specs/flow-engine/2026-02-14-flow-execution.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/api/2026-02-14-rest-api.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/kanban/2026-02-14-kanban-board.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/artifact/2026-02-14-artifact-management.md` **[S]**
