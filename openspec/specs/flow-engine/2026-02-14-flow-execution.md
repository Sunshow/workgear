# Delta Spec: Flow Run 记录 Merge Commit SHA

> **Type:** MODIFIED
> **Module:** flow-engine
> **Date:** 2026-02-14
> **Change:** add-pr-merge-commit-record

## 概述

修改 flow 执行模块的行为规范，在 PR 合并成功后将 merge commit SHA 记录到 flow_runs 表。

---

## 场景

### Scenario 1: 自动合并成功后记录 merge commit SHA

```gherkin
Given FlowRun 状态为 COMPLETED
  And FlowRun 关联的 PR 存在（prNumber 不为空）
  And 项目配置 autoMergePr = true
When handleFlowCompletedAutoMerge 调用 GitHub Merge API 成功
  And mergeResult.merged = true
  And mergeResult.sha 包含 merge commit 的完整 SHA
Then flow_runs.merge_commit_sha 更新为 mergeResult.sha
  And flow_runs.pr_merged_at 更新为当前时间
  And 两个字段在同一次 UPDATE 中写入
```

### Scenario 2: 手动合并成功后记录 merge commit SHA

```gherkin
Given 用户调用 PUT /flow-runs/:id/merge-pr
  And FlowRun 关联的 PR 存在且未合并
When GitHub Merge API 返回成功
  And mergeResult.sha 包含 merge commit 的完整 SHA
Then flow_runs.merge_commit_sha 更新为 mergeResult.sha
  And flow_runs.pr_merged_at 更新为当前时间
  And 返回 { merged: true, mergeCommitSha: mergeResult.sha }
```

### Scenario 3: 合并失败时不记录 merge commit SHA

```gherkin
Given FlowRun 关联的 PR 存在
When GitHub Merge API 返回失败（mergeResult.merged = false）
Then flow_runs.merge_commit_sha 保持为 NULL
  And flow_runs.pr_merged_at 保持为 NULL
  And 记录 pr_merge_failed timeline 事件
```

### Scenario 4: 历史已合并 PR 的 merge_commit_sha 为 NULL

```gherkin
Given 在此功能上线前已合并的 FlowRun
  And flow_runs.pr_merged_at 已有值
When 前端查询 FlowRun 数据
Then flow_runs.merge_commit_sha 为 NULL
  And 前端优雅降级，不显示 merge commit 链接
```
