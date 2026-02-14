# Design: Git Diff Viewer Link — 变更文件可点击跳转 Diff 查看

## 技术方案

### 方案概述

在 Git Tab 的变更文件列表和 Commit 记录中增加外部链接，用户可一键跳转到 GitHub 查看文件 diff 或 commit 详情。同时增强 Orchestrator 的 git 事件数据，携带仓库 URL 和文件变更类型信息。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Diff 查看方式 | 外部链接跳转 GitHub | 避免引入 diff 渲染库（如 react-diff-viewer），保持前端轻量；GitHub 的 diff 视图功能完善 |
| PR diff URL 格式 | `{prUrl}/files#diff-{sha256(path)}` | GitHub PR Files tab 的标准锚点格式，精确定位到文件 |
| Commit diff URL 格式 | `{repoUrl}/commit/{hash}` | GitHub commit 详情页标准格式 |
| 文件类型信息来源 | Orchestrator 解析 `git diff --name-status` | 在 Agent 执行层获取最准确的变更类型，无需额外 API 调用 |
| 仓库 URL 来源 | Agent 配置优先，git remote 兜底 | Agent 配置中已有仓库信息，避免运行时解析的不确定性 |
| 向后兼容 | 保留 `changed_files` 字段，新增 `changed_files_detail` | 旧版前端仍可正常工作，新版前端优先使用 detail 字段 |
| SHA256 计算 | 前端使用 Web Crypto API | 浏览器原生支持，无需引入额外依赖 |

### 备选方案（已排除）

- **内嵌 Monaco Diff Editor**：在 WorkGear 内直接展示 diff 内容。排除原因：需要通过 API 获取文件内容（两个版本），引入大量复杂度，且 Monaco Editor 已用于 YAML 编辑，diff 模式会增加 bundle 体积。
- **后端代理 GitHub API 获取 diff**：API 层调用 GitHub API 获取 diff 内容返回前端。排除原因：增加 API 复杂度和延迟，需要处理 GitHub API rate limit，且外部链接已能满足需求。
- **前端调用 GitHub API**：前端直接调用 GitHub REST API 获取 diff。排除原因：需要在前端暴露 GitHub token，存在安全风险。

---

## 数据流

### 变更文件 Diff 链接构建（有 PR）

```
用户展开 Git Tab 变更文件列表
    │
    ▼
前端检查 flowRun.prUrl 是否存在
    │
    ├── prUrl 存在
    │   │
    │   ▼
    │   对每个文件路径计算 SHA256 hash
    │   │  await crypto.subtle.digest('SHA-256', encoder.encode(filePath))
    │   │
    │   ▼
    │   构建链接: {prUrl}/files#diff-{sha256hex}
    │   │
    │   ▼
    │   渲染 <a href={link} target="_blank"> <ExternalLink /> </a>
    │
    └── prUrl 不存在，检查 repoUrl + commit hash
        │
        ├── 都存在 → 构建链接: {repoUrl}/commit/{hash}
        │
        └── 缺失 → 不渲染链接图标
```

### Orchestrator 事件数据增强

```
Agent 容器执行 git 操作
    │
    ▼
adapter.go 解析 Agent 输出
    │
    ├── 解析 git diff --name-status 输出
    │   │  "A\tpath/to/new-file.ts"
    │   │  "M\tpath/to/modified-file.ts"
    │   │  "D\tpath/to/deleted-file.ts"
    │   │
    │   ▼
    │   构建 ChangedFilesDetail: [{path, status}]
    │
    ├── 解析 repo_url
    │   │  优先: AgentConfig.RepoURL
    │   │  兜底: git remote get-url origin → 转换为 HTTPS
    │   │
    │   ▼
    │   设置 GitMetadata.RepoURL
    │
    ▼
node_handlers.go 构建 timeline 事件
    │
    ├── content.changed_files = []string{...}        ← 保留（向后兼容）
    ├── content.changed_files_detail = []Detail{...}  ← 新增
    ├── content.repo_url = "https://..."              ← 新增
    │
    ▼
INSERT INTO timeline_events (content jsonb)
    │
    ▼
WebSocket 推送事件 → 前端 Git Tab 刷新
```

### Commit Hash 链接构建

```
前端渲染 Commit 列表
    │
    ▼
对每个 commit，检查 repoUrl 是否可用
    │
    ├── repoUrl 存在（来自 git_pushed 事件的 repo_url 字段）
    │   │
    │   ▼
    │   构建链接: {repoUrl}/commit/{fullHash}
    │   │
    │   ▼
    │   渲染 <a href={link}><code>{hash.slice(0,7)}</code></a>
    │
    └── repoUrl 不存在
        │
        ▼
        渲染纯文本 <code>{hash.slice(0,7)}</code>（当前行为）
```

---

## 文件变更清单

### 修改文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/src/pages/kanban/task-detail/git-tab.tsx` | MODIFY | 增加 diff 链接构建、文件类型标记、commit 链接 |
| `packages/orchestrator/internal/agent/adapter.go` | MODIFY | 扩展 `GitMetadata` 结构体，新增 `ChangedFilesDetail` 和 `RepoURL` 字段 |
| `packages/orchestrator/internal/engine/node_handlers.go` | MODIFY | 解析 `git diff --name-status` 输出，填充新字段到 timeline 事件 |

### 新增文件

无

### 删除文件

无

---

## 具体代码变更

### 1. `packages/orchestrator/internal/agent/adapter.go`

扩展结构体：

```go
// ChangedFileDetail represents a file change with its status
type ChangedFileDetail struct {
    Path   string `json:"path"`
    Status string `json:"status"` // "added", "modified", "deleted", "renamed"
}

type GitMetadata struct {
    Commit             string              `json:"commit"`
    CommitMessage      string              `json:"commit_message"`
    Branch             string              `json:"branch"`
    ChangedFiles       []string            `json:"changed_files"`        // 保留，向后兼容
    RepoURL            string              `json:"repo_url"`             // 新增
    ChangedFilesDetail []ChangedFileDetail `json:"changed_files_detail"` // 新增
}
```

### 2. `packages/orchestrator/internal/engine/node_handlers.go`

在解析 git 输出时增加 `--name-status` 解析逻辑：

```go
// parseChangedFilesDetail parses "git diff --name-status" output
func parseChangedFilesDetail(output string) []ChangedFileDetail {
    var details []ChangedFileDetail
    statusMap := map[string]string{
        "A": "added",
        "M": "modified",
        "D": "deleted",
        "R": "renamed",
    }
    for _, line := range strings.Split(output, "\n") {
        parts := strings.SplitN(strings.TrimSpace(line), "\t", 2)
        if len(parts) == 2 {
            status := statusMap[parts[0]]
            if status == "" {
                status = "modified"
            }
            details = append(details, ChangedFileDetail{
                Path:   parts[1],
                Status: status,
            })
        }
    }
    return details
}
```

在构建 timeline 事件 content 时填充新字段：

```go
content["repo_url"] = gitMeta.RepoURL
content["changed_files_detail"] = gitMeta.ChangedFilesDetail
```

### 3. `packages/web/src/pages/kanban/task-detail/git-tab.tsx`

新增 SHA256 工具函数：

```typescript
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
```

扩展数据模型：

```typescript
interface ChangedFileDetail {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

// 在 loadData 中解析 changed_files_detail
const allFileDetails = new Map<string, string>() // path → status
for (const evt of gitPushEvents) {
  if (Array.isArray(evt.content.changed_files_detail)) {
    for (const f of evt.content.changed_files_detail) {
      allFileDetails.set(f.path, f.status)
    }
  }
}
```

变更文件行增加链接和类型标记：

```tsx
{changedFiles.map((file, i) => (
  <div key={i} className="px-3 py-1.5 flex items-center gap-2">
    {fileDetails.get(file) && (
      <StatusBadge status={fileDetails.get(file)!} />
    )}
    <code className="text-xs text-muted-foreground flex-1 truncate">{file}</code>
    {diffUrl && (
      <a href={buildDiffUrl(file)} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-blue-500" />
      </a>
    )}
  </div>
))}
```

---

## 前端 URL 构建策略

### 优先级

1. 有 PR → `{prUrl}/files#diff-{sha256(filePath)}`
2. 无 PR，有 repoUrl + commit → `{repoUrl}/commit/{latestCommitHash}`
3. 都没有 → 不显示链接

### GitHub URL 格式参考

| 场景 | URL 格式 |
|------|----------|
| PR 文件 diff | `https://github.com/owner/repo/pull/123/files#diff-{sha256hex}` |
| Commit 详情 | `https://github.com/owner/repo/commit/{40-char-hash}` |
| Commit 文件 diff | `https://github.com/owner/repo/commit/{hash}#diff-{sha256hex}` |

---

## 测试策略

- 手动验证：有 PR 的任务 → 展开变更文件 → 点击链接 → 确认跳转到 GitHub PR diff 页面对应文件
- 手动验证：无 PR 但有 commit 的任务 → 点击文件链接 → 确认跳转到 commit 页面
- 手动验证：点击 commit hash → 确认跳转到 GitHub commit 详情页
- 手动验证：历史任务（无 repo_url）→ 确认不显示链接，文件名为纯文本
- 手动验证：文件变更类型标记 → 确认 A/M/D 颜色正确
