# Design: PR Merge Commit Record — 记录 PR 合并的 Merge Commit 信息

## 技术方案

### 方案概述

在 PR 合并成功后，将 GitHub API 返回的 merge commit SHA 持久化到 `flow_runs` 表，同时写入 `pr_merged` timeline 事件的 content 中。前端 Git Tab 读取这些数据，在 PR 区域和提交记录列表中展示 merge commit 信息和可点击链接。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| SHA 存储位置 | `flow_runs.merge_commit_sha` 列 | 与 `pr_url`、`pr_number`、`pr_merged_at` 同表，查询时无需 JOIN timeline_events |
| 列类型 | `varchar(100)` 可空 | SHA 为 40 字符 hex，预留空间；可空兼容历史数据 |
| 同时写入 timeline | `pr_merged` 事件 content 增加字段 | timeline 是事件溯源的完整记录，保持数据冗余以支持独立查询 |
| 前端数据来源 | 优先从 `FlowRun.mergeCommitSha` 读取 | 避免遍历 timeline 事件查找，直接从 flow run 对象获取 |
| repoUrl 来源 | 复用现有 `repoUrl` state（来自 git_pushed 事件） | 无需新增数据源，git-tab.tsx 已有此逻辑 |
| merge commit 在提交列表的位置 | 追加到列表末尾 | merge commit 是最后发生的操作，时间顺序正确 |

### 备选方案（已排除）

- **仅存储在 timeline 事件中**：排除原因 — 查询 FlowRun 时需要额外 JOIN 或子查询才能获取 merge commit SHA，增加查询复杂度。
- **新增独立的 merge_commits 表**：排除原因 — 过度设计，一个 FlowRun 最多一次 merge，一个字段足够。
- **回填历史数据**：排除原因 — 需要调用 GitHub API 查询已合并 PR 的 merge commit，增加复杂度且历史数据量有限。

---

## 数据流

### 自动合并 — Merge Commit SHA 记录

```
flow.completed 事件触发
    │
    ▼
handleFlowCompletedAutoMerge(flowRunId)
    │
    ├── 查询 flowRun → 检查 prNumber 存在
    ├── 查询 project → 检查 autoMergePr = true
    │
    ▼
provider.mergePullRequest({ squash, commitTitle })
    │
    ├── GitHub API: PUT /repos/{owner}/{repo}/pulls/{number}/merge
    │   │
    │   ▼
    │   Response: { sha: "abc123...", merged: true, message: "..." }
    │
    ▼
mergeResult.merged === true
    │
    ├── UPDATE flow_runs SET
    │     pr_merged_at = NOW(),
    │     merge_commit_sha = mergeResult.sha    ← 新增
    │   WHERE id = flowRunId
    │
    ├── INSERT timeline_events (event_type = 'pr_merged')
    │     content = {
    │       prUrl: flowRun.prUrl,
    │       message: "PR 已自动合并",
    │       merge_commit_sha: mergeResult.sha   ← 新增
    │     }
    │
    ▼
删除 feature branch → 完成
```

### 手动合并 — Merge Commit SHA 记录

```
PUT /flow-runs/:id/merge-pr
    │
    ├── 查询 flowRun → 检查 prNumber 存在且未合并
    ├── 查询 project → 获取 gitAccessToken
    │
    ▼
provider.mergePullRequest({ squash, commitTitle })
    │
    ▼
mergeResult.merged === true
    │
    ├── UPDATE flow_runs SET
    │     pr_merged_at = NOW(),
    │     merge_commit_sha = mergeResult.sha    ← 新增
    │   WHERE id = flowRunId
    │
    ├── INSERT timeline_events (event_type = 'pr_merged')
    │     content = {
    │       prUrl: flowRun.prUrl,
    │       message: "PR 已手动合并",
    │       merge_commit_sha: mergeResult.sha   ← 新增
    │     }
    │
    ▼
返回 { merged: true, mergeCommitSha: mergeResult.sha }
```

### 前端展示 — Merge Commit 信息

```
Git Tab 加载数据
    │
    ├── GET /flow-runs?taskId={taskId}
    │   │
    │   ▼
    │   flowRun.mergeCommitSha = "abc123..."
    │   flowRun.prMergedAt = "2026-02-14T..."
    │
    ├── GET /tasks/{taskId}/timeline
    │   │
    │   ▼
    │   git_pushed 事件 → 提取 repoUrl
    │
    ▼
渲染 PR 区域
    │
    ├── prMergedAt 存在 → 显示「已合并」Badge + 时间戳
    │
    ├── mergeCommitSha 存在？
    │   │
    │   ├── repoUrl 存在 → 渲染可点击链接
    │   │   <a href="{repoUrl}/commit/{mergeCommitSha}">
    │   │     <code>{mergeCommitSha.slice(0,7)}</code>
    │   │   </a>
    │   │
    │   └── repoUrl 不存在 → 渲染纯文本
    │       <code>{mergeCommitSha.slice(0,7)}</code>
    │
    ▼
渲染提交记录列表
    │
    ├── feature branch commits（来自 git_pushed 事件）
    │
    └── mergeCommitSha 存在？
        │
        ▼
        追加 merge commit 条目：
        [GitMerge icon] {sha.slice(0,7)}  Merge PR #{prNumber}
```

---

## 文件变更清单

### 修改文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/api/src/db/schema.ts` | MODIFY | `flowRuns` 表新增 `mergeCommitSha` 列 |
| `packages/api/src/ws/gateway.ts` | MODIFY | `handleFlowCompletedAutoMerge` 写入 `merge_commit_sha` |
| `packages/api/src/routes/flow-runs.ts` | MODIFY | 手动 merge 路由写入 `merge_commit_sha`，返回 `mergeCommitSha` |
| `packages/web/src/lib/types.ts` | MODIFY | `FlowRun` 接口新增 `mergeCommitSha` 字段 |
| `packages/web/src/pages/kanban/task-detail/git-tab.tsx` | MODIFY | PR 区域展示 merge commit，提交列表追加 merge commit |

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `packages/api/drizzle/migrations/XXXX_add_merge_commit_sha.sql` | Migration: ALTER TABLE flow_runs ADD COLUMN merge_commit_sha |

### 删除文件

无

---

## 具体代码变更

### 1. `packages/api/src/db/schema.ts`

新增列：

```typescript
export const flowRuns = pgTable('flow_runs', {
  // ... 现有列 ...
  prMergedAt: timestamp('pr_merged_at', { withTimezone: true }),
  mergeCommitSha: varchar('merge_commit_sha', { length: 100 }),  // ← 新增
  // ... 其余列 ...
})
```

### 2. `packages/api/src/ws/gateway.ts`

`handleFlowCompletedAutoMerge` 中合并成功后：

```typescript
if (mergeResult.merged) {
  // 同时写入 pr_merged_at 和 merge_commit_sha
  await db.update(flowRuns).set({
    prMergedAt: new Date(),
    mergeCommitSha: mergeResult.sha || null,  // ← 新增
  }).where(eq(flowRuns.id, flowRunId))

  await db.insert(timelineEvents).values({
    taskId: task.id,
    flowRunId: flowRunId,
    eventType: 'pr_merged',
    content: {
      prUrl: flowRun.prUrl,
      message: `PR 已自动合并`,
      merge_commit_sha: mergeResult.sha || undefined,  // ← 新增
    },
  })
  // ...
}
```

### 3. `packages/api/src/routes/flow-runs.ts`

手动 merge 路由中合并成功后：

```typescript
if (mergeResult.merged) {
  await db.update(flowRuns).set({
    prMergedAt: new Date(),
    mergeCommitSha: mergeResult.sha || null,  // ← 新增
  }).where(eq(flowRuns.id, id))

  await db.insert(timelineEvents).values({
    taskId: task.id,
    flowRunId: id,
    eventType: 'pr_merged',
    content: {
      prUrl: flowRun.prUrl,
      message: 'PR 已手动合并',
      merge_commit_sha: mergeResult.sha || undefined,  // ← 新增
    },
  })

  // ...
  return { merged: true, mergeCommitSha: mergeResult.sha || null }  // ← 新增返回字段
}
```

### 4. `packages/web/src/lib/types.ts`

```typescript
export interface FlowRun {
  // ... 现有字段 ...
  prMergedAt: string | null
  mergeCommitSha: string | null  // ← 新增
  // ...
}
```

### 5. `packages/web/src/pages/kanban/task-detail/git-tab.tsx`

PR 区域增加 merge commit 展示：

```tsx
{prMerged && flowRun.prMergedAt && (
  <div>
    <p className="text-xs text-muted-foreground mt-1">
      {new Date(flowRun.prMergedAt).toLocaleString('zh-CN')}
    </p>
    {flowRun.mergeCommitSha && (
      <div className="flex items-center gap-1.5 mt-1">
        <GitCommit className="h-3 w-3 text-muted-foreground" />
        {repoUrl ? (
          <a href={`${repoUrl}/commit/${flowRun.mergeCommitSha}`} target="_blank" rel="noopener noreferrer">
            <code className="text-xs text-blue-600 hover:underline">{flowRun.mergeCommitSha.slice(0, 7)}</code>
          </a>
        ) : (
          <code className="text-xs text-muted-foreground">{flowRun.mergeCommitSha.slice(0, 7)}</code>
        )}
      </div>
    )}
  </div>
)}
```

提交记录列表追加 merge commit：

```tsx
{/* Merge commit entry */}
{flowRun?.mergeCommitSha && flowRun.prMergedAt && (
  <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-t-2">
    <GitMerge className="h-3 w-3 text-purple-500 shrink-0" />
    {buildCommitUrl(flowRun.mergeCommitSha) ? (
      <a href={buildCommitUrl(flowRun.mergeCommitSha)!} target="_blank" rel="noopener noreferrer">
        <code className="text-xs text-blue-600 hover:underline shrink-0">{flowRun.mergeCommitSha.slice(0, 7)}</code>
      </a>
    ) : (
      <code className="text-xs text-muted-foreground shrink-0">{flowRun.mergeCommitSha.slice(0, 7)}</code>
    )}
    <span className="text-sm truncate text-muted-foreground">Merge PR #{flowRun.prNumber}</span>
  </div>
)}
```

---

## Migration SQL

```sql
ALTER TABLE flow_runs ADD COLUMN merge_commit_sha varchar(100);
```

---

## 测试策略

- 手动验证：自动合并 → 检查 flow_runs.merge_commit_sha 已写入 → Git Tab 显示 merge commit 链接
- 手动验证：手动合并 → 检查返回值包含 mergeCommitSha → Git Tab 刷新后显示
- 手动验证：点击 merge commit 短 hash → 确认跳转到 GitHub commit 详情页
- 手动验证：历史已合并 PR（无 merge_commit_sha）→ 确认不显示链接，仅显示时间戳
- 手动验证：提交记录列表 → 确认 merge commit 条目在末尾，带 GitMerge 图标
- 手动验证：合并失败 → 确认 merge_commit_sha 未写入
