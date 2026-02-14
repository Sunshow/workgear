# Delta Spec: Git Tab 变更文件 Diff 链接与 Commit 链接

> **Type:** MODIFIED
> **Module:** kanban
> **Date:** 2026-02-14
> **Change:** git-diff-viewer-link

## 概述

修改看板模块 Git Tab 的变更文件展示和 Commit 记录展示，增加可点击的外部 Diff 链接和文件变更类型标记。

---

## 场景

### Scenario 1: 有 PR 时变更文件显示 Diff 链接

```gherkin
Given 任务关联的 FlowRun 已创建 PR（prUrl 和 prNumber 存在）
  And Git Tab 的变更文件列表已展开
When 用户查看变更文件列表中的某个文件
Then 文件名右侧显示一个 ExternalLink 图标按钮
  And 按钮链接指向 {prUrl}/files#diff-{sha256(filePath)}
  And 点击按钮在新标签页打开 GitHub PR 的文件 diff 视图
```

### Scenario 2: 无 PR 但有 Commit 时变更文件显示 Diff 链接

```gherkin
Given 任务有 git_pushed 事件记录（包含 commit hash）
  And FlowRun 没有 PR（prUrl 为空）
When 用户查看变更文件列表中的某个文件
Then 文件名右侧显示一个 ExternalLink 图标按钮
  And 按钮链接指向 {repoUrl}/commit/{latestCommitHash}
  And 点击按钮在新标签页打开 GitHub commit 详情页
```

### Scenario 3: 变更文件显示变更类型标记

```gherkin
Given Orchestrator 推送的 git_pushed 事件包含 changed_files_detail 字段
  And changed_files_detail 中每个文件有 path 和 status 属性
When Git Tab 渲染变更文件列表
Then 每个文件名前显示变更类型标记：
  | status   | 标记 | 颜色   |
  | added    | A    | 绿色   |
  | modified | M    | 黄色   |
  | deleted  | D    | 红色   |
  | renamed  | R    | 蓝色   |
```

### Scenario 4: 向后兼容旧格式事件

```gherkin
Given 历史 git_pushed 事件仅包含 changed_files（string[]）
  And 不包含 changed_files_detail 字段
When Git Tab 渲染变更文件列表
Then 文件正常显示，不显示变更类型标记（无 status 信息）
  And Diff 链接仍然可用（基于 prUrl 或 commit hash 构建）
```

### Scenario 5: Commit Hash 可点击跳转

```gherkin
Given 任务有 git_pushed 事件记录
  And 事件包含 commit hash 和 repo_url
When 用户查看提交记录列表
Then 每个 commit 的 7 位短 hash 显示为可点击链接
  And 链接指向 {repoUrl}/commit/{fullHash}
  And 点击在新标签页打开 GitHub commit 详情页
```

### Scenario 6: 无 Git 平台 URL 时不显示链接

```gherkin
Given git_pushed 事件中没有 repo_url 信息
  And FlowRun 没有 prUrl
When Git Tab 渲染变更文件和 commit 列表
Then 文件名和 commit hash 显示为纯文本（与当前行为一致）
  And 不显示 ExternalLink 图标按钮
```

---

## UI 规格

### 变更文件行

| 属性 | 值 |
|------|-----|
| 布局 | `flex items-center justify-between` |
| 类型标记 | `<Badge variant="outline">` 单字母，宽度固定 |
| 文件名 | `<code className="text-xs text-muted-foreground truncate">` |
| Diff 链接 | `<a target="_blank"><ExternalLink className="h-3 w-3" /></a>` |
| hover 效果 | 链接图标 hover 时显示 `text-blue-500` |

### Commit 行

| 属性 | 值 |
|------|-----|
| Hash 链接 | `<a target="_blank"><code className="text-xs text-blue-600 hover:underline">` |
| 无 URL 时 | `<code className="text-xs text-muted-foreground">` 纯文本 |

---

## Scenario: PR 已合并时显示 merge commit 短 hash

### Given
- FlowRun 的 PR 已合并（prMergedAt 不为空）
- FlowRun.mergeCommitSha 存在（如 "abc123def456..."）
- repoUrl 可用（来自 git_pushed 事件或项目配置）

### When
- 用户查看 Git Tab 的 PR 区域

### Then
- 合并时间戳下方显示 merge commit 短 hash（前 7 位）
- 短 hash 显示为可点击链接
- 链接指向 {repoUrl}/commit/{mergeCommitSha}
- 点击在新标签页打开 GitHub merge commit 详情页

---

## Scenario: PR 已合并但无 mergeCommitSha 时优雅降级

### Given
- FlowRun 的 PR 已合并（prMergedAt 不为空）
- FlowRun.mergeCommitSha 为 null（历史数据）

### When
- 用户查看 Git Tab 的 PR 区域

### Then
- 仅显示合并时间戳（与当前行为一致）
- 不显示 merge commit hash 和链接

---

## Scenario: PR 已合并但无 repoUrl 时显示纯文本 hash

### Given
- FlowRun 的 PR 已合并
- FlowRun.mergeCommitSha 存在
- repoUrl 不可用（无 git_pushed 事件或事件中无 repo_url）

### When
- 用户查看 Git Tab 的 PR 区域

### Then
- merge commit 短 hash 显示为纯文本（不可点击）
- 使用 text-muted-foreground 样式

---

## Scenario: 提交记录列表追加 merge commit

### Given
- FlowRun 的 PR 已合并
- FlowRun.mergeCommitSha 存在
- 提交记录列表已包含 feature branch 的 commits

### When
- Git Tab 渲染提交记录列表

### Then
- 列表末尾追加一条 merge commit 条目
- 条目显示 merge commit 短 hash（前 7 位）
- 条目 message 显示为 "Merge PR #{prNumber}"
- 条目带有 GitMerge 图标以区分普通 commit
- 短 hash 可点击跳转到 {repoUrl}/commit/{mergeCommitSha}

---

## Scenario: PR 未合并时不显示 merge commit

### Given
- FlowRun 的 PR 未合并（prMergedAt 为空）

### When
- 用户查看 Git Tab

### Then
- PR 区域不显示 merge commit 信息
- 提交记录列表不包含 merge commit 条目

---

## UI 规格 — Merge Commit

### PR 区域 — Merge Commit 行

| 属性 | 值 |
|------|-----|
| 位置 | 合并时间戳下方 |
| 布局 | `flex items-center gap-1.5` |
| 图标 | `<GitCommit className="h-3 w-3 text-muted-foreground" />` |
| 有链接时 | `<a target="_blank"><code className="text-xs text-blue-600 hover:underline">{sha.slice(0,7)}</code></a>` |
| 无链接时 | `<code className="text-xs text-muted-foreground">{sha.slice(0,7)}</code>` |

### 提交记录 — Merge Commit 条目

| 属性 | 值 |
|------|-----|
| 图标 | `<GitMerge className="h-3 w-3 text-purple-500" />` 替代默认无图标 |
| Hash | 与普通 commit 相同样式（可点击蓝色 / 纯文本灰色） |
| Message | `Merge PR #${prNumber}` |
| 分隔 | 与普通 commits 之间有视觉分隔（如 border-t-2 或 bg-muted/20） |
