# Delta Spec: pr_merged 事件增加 Merge Commit SHA

> **Type:** MODIFIED
> **Module:** artifact
> **Date:** 2026-02-14
> **Change:** add-pr-merge-commit-record

## 概述

修改产物管理模块中与 Git 产物相关的行为规范，补充 `pr_merged` timeline 事件中的 merge commit SHA 字段。

---

## 场景

### Scenario 1: pr_merged 事件包含 merge_commit_sha

```gherkin
Given PR 合并成功（自动合并或手动合并）
  And GitHub Merge API 返回 merge commit SHA
When 系统创建 pr_merged timeline 事件
Then 事件 content (jsonb) 包含 merge_commit_sha 字段
  And merge_commit_sha 为完整的 40 字符 commit SHA
  And 保留现有字段：prUrl, message
```

### Scenario 2: pr_merge_failed 事件不包含 merge_commit_sha

```gherkin
Given PR 合并失败
When 系统创建 pr_merge_failed timeline 事件
Then 事件 content 不包含 merge_commit_sha 字段
  And 保留现有字段：prUrl, error, message
```

### Scenario 3: 向后兼容 — 旧 pr_merged 事件无 merge_commit_sha

```gherkin
Given 历史 pr_merged 事件在此功能上线前创建
When 前端或其他消费方读取事件 content
Then merge_commit_sha 字段不存在（undefined）
  And 消费方应检查字段存在性后再使用
```

---

## 数据结构

### pr_merged 事件 content 格式（更新后）

```typescript
interface PrMergedEventContent {
  // 现有字段
  prUrl: string              // PR HTML URL
  message: string            // 人类可读消息

  // 新增字段
  merge_commit_sha?: string  // Merge commit SHA（40 字符），历史事件中不存在
}
```
