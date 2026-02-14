# Delta Spec: REST API 支持 Merge Commit SHA

> **Type:** MODIFIED
> **Module:** api
> **Date:** 2026-02-14
> **Change:** add-pr-merge-commit-record

## 概述

修改 REST API 模块，在 flow_runs 表新增 merge_commit_sha 列，merge 路由返回 merge commit SHA，timeline 事件增加 merge commit 信息。

---

## 场景

### Scenario 1: flow_runs 表新增 merge_commit_sha 列

```gherkin
Given 数据库 flow_runs 表已存在
When 执行 migration 添加 merge_commit_sha 列
Then flow_runs 表新增 merge_commit_sha varchar(100) 可空列
  And 现有数据的 merge_commit_sha 值为 NULL
  And 不影响现有查询和写入操作
```

### Scenario 2: GET /flow-runs 返回 mergeCommitSha 字段

```gherkin
Given FlowRun 已合并，merge_commit_sha = "abc123def456..."
When 客户端请求 GET /api/flow-runs?taskId={taskId}
Then 响应中每个 FlowRun 对象包含 mergeCommitSha 字段
  And mergeCommitSha 值为 "abc123def456..."
  And 未合并的 FlowRun 的 mergeCommitSha 为 null
```

### Scenario 3: PUT /flow-runs/:id/merge-pr 返回 mergeCommitSha

```gherkin
Given 用户调用手动合并接口
When GitHub Merge API 返回成功
Then 响应体为 { merged: true, mergeCommitSha: "abc123..." }
  And mergeCommitSha 为 GitHub API 返回的 merge commit SHA
```

### Scenario 4: pr_merged timeline 事件包含 merge_commit_sha

```gherkin
Given PR 合并成功（自动或手动）
When 系统创建 pr_merged timeline 事件
Then 事件 content (jsonb) 包含 merge_commit_sha 字段
  And merge_commit_sha 为完整的 40 字符 SHA
  And 保留现有字段：prUrl, message
```

### Scenario 5: 向后兼容 — 旧 pr_merged 事件无 merge_commit_sha

```gherkin
Given 历史 pr_merged 事件在新版本部署前创建
When 前端读取这些事件的 content
Then merge_commit_sha 字段不存在（undefined）
  And 前端应优雅降级，不显示 merge commit 链接
```

---

## 事件 Content Schema

### pr_merged 事件 content 格式（更新后）

```typescript
interface PrMergedContent {
  // 现有字段（保持不变）
  prUrl: string              // PR HTML URL
  message: string            // 合并消息（如 "PR 已自动合并"）

  // 新增字段
  merge_commit_sha?: string  // Merge commit 完整 SHA（40 字符）
}
```
