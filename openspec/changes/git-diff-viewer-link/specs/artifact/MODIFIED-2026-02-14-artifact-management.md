# Delta Spec: Orchestrator Git 事件数据增强

> **Type:** MODIFIED
> **Module:** artifact
> **Date:** 2026-02-14
> **Change:** git-diff-viewer-link

## 概述

修改产物管理模块中与 Git 产物相关的行为规范，补充 Orchestrator 推送 git 事件时携带仓库 URL 和文件变更类型的规范。

---

## 场景

### Scenario 1: Agent 执行 git 操作后推送增强事件

```gherkin
Given Agent 在容器中执行了 git commit 和 git push 操作
  And Agent adapter 解析了 git 操作的输出
When Orchestrator 构建 git_pushed timeline 事件
Then 事件 content 中包含 repo_url（从 Agent 配置或 git remote 解析）
  And 事件 content 中包含 changed_files_detail 数组
  And changed_files_detail 通过 git diff --name-status 获取文件变更类型
```

### Scenario 2: 从 git diff 输出解析文件变更类型

```gherkin
Given Agent 执行了 git diff --name-status HEAD~1 命令
  And 输出格式为 "<status>\t<filepath>" 每行一个文件
When Orchestrator 解析 diff 输出
Then 将 git status 字母映射为标准类型：
  | git status | mapped status |
  | A          | added         |
  | M          | modified      |
  | D          | deleted       |
  | R          | renamed       |
  And 未识别的 status 默认映射为 modified
```

### Scenario 3: 从 git remote 解析仓库 URL

```gherkin
Given Agent 容器中的 git 仓库配置了 remote origin
  And remote URL 可能是 HTTPS 或 SSH 格式
When Orchestrator 解析 repo_url
Then SSH 格式 (git@github.com:owner/repo.git) 转换为 HTTPS (https://github.com/owner/repo)
  And HTTPS 格式保持不变，去除末尾 .git 后缀
  And 解析失败时 repo_url 为空字符串，不阻塞事件推送
```

### Scenario 4: Agent 配置中预设仓库 URL

```gherkin
Given 项目的 Agent 配置中包含 repoUrl 字段
When Orchestrator 构建 git_pushed 事件
Then 优先使用 Agent 配置中的 repoUrl
  And 如果配置中无 repoUrl，则从 git remote 解析
  And 如果都无法获取，repo_url 字段为空字符串
```

---

## 数据结构

### ChangedFileDetail（Go 结构体扩展）

```go
type ChangedFileDetail struct {
    Path   string `json:"path"`
    Status string `json:"status"` // "added", "modified", "deleted", "renamed"
}
```

### GitMetadata（扩展后）

```go
type GitMetadata struct {
    Commit             string              `json:"commit"`
    CommitMessage      string              `json:"commit_message"`
    Branch             string              `json:"branch"`
    ChangedFiles       []string            `json:"changed_files"`
    RepoURL            string              `json:"repo_url"`
    ChangedFilesDetail []ChangedFileDetail `json:"changed_files_detail"`
}
```
