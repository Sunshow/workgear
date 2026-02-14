# Delta Spec: Git Tab 展示 Merge Commit 信息

> **Type:** MODIFIED
> **Module:** kanban
> **Date:** 2026-02-14
> **Change:** add-pr-merge-commit-record

## 概述

修改看板模块 Git Tab 的 PR 区域和提交记录区域，展示 merge commit 的 SHA 和可点击链接。

---

## 场景

### Scenario 1: PR 已合并时显示 merge commit 短 hash

```gherkin
Given FlowRun 的 PR 已合并（prMergedAt 不为空）
  And FlowRun.mergeCommitSha 存在（如 "abc123def456..."）
  And repoUrl 可用（来自 git_pushed 事件或项目配置）
When 用户查看 Git Tab 的 PR 区域
Then 合并时间戳下方显示 merge commit 短 hash（前 7 位）
  And 短 hash 显示为可点击链接
  And 链接指向 {repoUrl}/commit/{mergeCommitSha}
  And 点击在新标签页打开 GitHub merge commit 详情页
```

### Scenario 2: PR 已合并但无 mergeCommitSha 时优雅降级

```gherkin
Given FlowRun 的 PR 已合并（prMergedAt 不为空）
  And FlowRun.mergeCommitSha 为 null（历史数据）
When 用户查看 Git Tab 的 PR 区域
Then 仅显示合并时间戳（与当前行为一致）
  And 不显示 merge commit hash 和链接
```

### Scenario 3: PR 已合并但无 repoUrl 时显示纯文本 hash

```gherkin
Given FlowRun 的 PR 已合并
  And FlowRun.mergeCommitSha 存在
  And repoUrl 不可用（无 git_pushed 事件或事件中无 repo_url）
When 用户查看 Git Tab 的 PR 区域
Then merge commit 短 hash 显示为纯文本（不可点击）
  And 使用 text-muted-foreground 样式
```

### Scenario 4: 提交记录列表追加 merge commit

```gherkin
Given FlowRun 的 PR 已合并
  And FlowRun.mergeCommitSha 存在
  And 提交记录列表已包含 feature branch 的 commits
When Git Tab 渲染提交记录列表
Then 列表末尾追加一条 merge commit 条目
  And 条目显示 merge commit 短 hash（前 7 位）
  And 条目 message 显示为 "Merge PR #{prNumber}"
  And 条目带有 GitMerge 图标以区分普通 commit
  And 短 hash 可点击跳转到 {repoUrl}/commit/{mergeCommitSha}
```

### Scenario 5: PR 未合并时不显示 merge commit

```gherkin
Given FlowRun 的 PR 未合并（prMergedAt 为空）
When 用户查看 Git Tab
Then PR 区域不显示 merge commit 信息
  And 提交记录列表不包含 merge commit 条目
```

---

## UI 规格

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
