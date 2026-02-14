# Delta Spec: Git 事件增加 Repo URL 字段

> **Type:** MODIFIED
> **Module:** api
> **Date:** 2026-02-14
> **Change:** git-diff-viewer-link

## 概述

修改 REST API 的 timeline 事件内容格式规范，补充 `git_pushed` 事件中的 `repo_url` 和 `changed_files_detail` 字段。

---

## 场景

### Scenario 1: git_pushed 事件包含 repo_url

```gherkin
Given Orchestrator 执行 Agent 节点完成 git push 操作
  And Agent 配置中包含 git 仓库 URL
When Orchestrator 创建 git_pushed timeline 事件
Then 事件 content (jsonb) 包含 repo_url 字段
  And repo_url 为 HTTPS 格式的仓库地址（如 https://github.com/owner/repo）
  And 保留现有字段：commit, commit_message, branch, changed_files
```

### Scenario 2: git_pushed 事件包含 changed_files_detail

```gherkin
Given Orchestrator 执行 Agent 节点完成 git push 操作
  And git diff 输出包含文件变更类型信息
When Orchestrator 创建 git_pushed timeline 事件
Then 事件 content (jsonb) 包含 changed_files_detail 数组
  And 每个元素格式为 { path: string, status: "added" | "modified" | "deleted" | "renamed" }
  And 同时保留 changed_files (string[]) 字段以保持向后兼容
```

### Scenario 3: 向后兼容 — 旧事件无新字段

```gherkin
Given 历史 git_pushed 事件在新版本部署前创建
When 前端读取这些事件的 content
Then repo_url 字段不存在（undefined）
  And changed_files_detail 字段不存在（undefined）
  And 前端应优雅降级，不显示链接和类型标记
```

---

## 事件 Content Schema

### git_pushed 事件 content 格式（更新后）

```typescript
interface GitPushedContent {
  // 现有字段（保持不变）
  commit: string           // 完整 commit hash
  commit_message: string   // commit 消息
  branch: string           // 分支名
  changed_files: string[]  // 变更文件路径列表（向后兼容）

  // 新增字段
  repo_url?: string        // 仓库 HTTPS URL（如 https://github.com/owner/repo）
  changed_files_detail?: Array<{
    path: string           // 文件路径
    status: 'added' | 'modified' | 'deleted' | 'renamed'
  }>
}
```
