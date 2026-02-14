# Tasks: Git Diff Viewer Link — 变更文件可点击跳转 Diff 查看

## 模块：Orchestrator 数据结构 (packages/orchestrator/internal/agent)

### 扩展 GitMetadata 结构体

- [ ] 在 `adapter.go` 中新增 `ChangedFileDetail` 结构体（Path, Status 字段） **[S]**
- [ ] 在 `GitMetadata` 中新增 `RepoURL string` 字段 **[S]**
- [ ] 在 `GitMetadata` 中新增 `ChangedFilesDetail []ChangedFileDetail` 字段 **[S]**
- [ ] 保留原 `ChangedFiles []string` 字段不变（向后兼容） **[S]**

## 模块：Orchestrator 节点处理 (packages/orchestrator/internal/engine)

### 解析文件变更类型

- [ ] 在 `node_handlers.go` 中新增 `parseChangedFilesDetail(output string)` 函数 **[S]**
- [ ] 实现 git status 字母到标准类型的映射（A→added, M→modified, D→deleted, R→renamed） **[S]**
- [ ] 在 Agent 节点执行完成后，调用 `git diff --name-status` 获取变更类型 **[M]**
- [ ] 将解析结果填充到 `GitMetadata.ChangedFilesDetail` **[S]**

### 解析仓库 URL

- [ ] 在 `node_handlers.go` 中新增 `resolveRepoURL(agentConfig, gitRemoteOutput string)` 函数 **[S]**
- [ ] 优先使用 AgentConfig 中的 repoUrl 字段 **[S]**
- [ ] 兜底解析 `git remote get-url origin` 输出，SSH 格式转 HTTPS **[S]**
- [ ] 将结果填充到 `GitMetadata.RepoURL` **[S]**

### 推送增强事件

- [ ] 在构建 `git_pushed` timeline 事件 content 时，新增 `repo_url` 字段 **[S]**
- [ ] 在构建 `git_pushed` timeline 事件 content 时，新增 `changed_files_detail` 字段 **[S]**

## 模块：前端 Git Tab (packages/web/src/pages/kanban/task-detail)

### SHA256 工具函数

- [ ] 在 `git-tab.tsx` 中新增 `sha256(text: string): Promise<string>` 工具函数 **[S]**
- [ ] 使用 Web Crypto API (`crypto.subtle.digest`) 实现，无需外部依赖 **[S]**

### 数据模型扩展

- [ ] 新增 `ChangedFileDetail` 接口（path, status） **[S]**
- [ ] 在 `loadData` 中解析 `changed_files_detail` 字段，构建 `Map<string, string>` (path → status) **[S]**
- [ ] 在 `loadData` 中提取 `repo_url` 字段，存入新的 state 变量 `repoUrl` **[S]**

### 变更文件 Diff 链接

- [ ] 新增 `buildFileDiffUrl(filePath: string)` 函数 **[M]**
- [ ] 有 PR 时：构建 `{prUrl}/files#diff-{sha256(filePath)}` 链接 **[S]**
- [ ] 无 PR 有 commit 时：构建 `{repoUrl}/commit/{latestCommitHash}` 链接 **[S]**
- [ ] 在变更文件行右侧渲染 `<ExternalLink>` 图标按钮（`target="_blank"`） **[S]**
- [ ] 无 URL 信息时不渲染链接图标 **[S]**

### 文件变更类型标记

- [ ] 新增 `StatusBadge` 组件，根据 status 渲染 A/M/D/R 单字母标记 **[S]**
- [ ] 颜色映射：added=绿色, modified=黄色, deleted=红色, renamed=蓝色 **[S]**
- [ ] 无 status 信息时（旧事件）不显示标记 **[S]**

### Commit Hash 链接

- [ ] commit hash 有 repoUrl 时渲染为 `<a>` 链接，指向 `{repoUrl}/commit/{fullHash}` **[S]**
- [ ] 无 repoUrl 时保持纯文本 `<code>` 显示（当前行为） **[S]**

## 测试验证

### 端到端验证

- [ ] 有 PR 的任务 → 展开变更文件 → 点击链接 → 确认跳转到 GitHub PR diff 页面 **[S]**
- [ ] 无 PR 有 commit 的任务 → 点击文件链接 → 确认跳转到 commit 页面 **[S]**
- [ ] 点击 commit hash → 确认跳转到 GitHub commit 详情页 **[S]**
- [ ] 历史任务（无 repo_url）→ 确认不显示链接，文件名为纯文本 **[S]**
- [ ] 文件变更类型标记 → 确认 A/M/D/R 颜色正确 **[S]**
- [ ] 有 changed_files 但无 changed_files_detail 的旧事件 → 确认优雅降级 **[S]**

## 模块：OpenSpec 文档

- [ ] 归档完成后更新 `openspec/specs/kanban/2026-02-14-kanban-board.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/artifact/2026-02-14-artifact-management.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/api/2026-02-14-rest-api.md` **[S]**
