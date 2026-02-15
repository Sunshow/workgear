# Git PR Flow 工作流程

## 概述

Git PR Flow 是 WorkGear 流程引擎中 Agent 执行任务后自动创建 Pull Request 并在流程完成后自动合并的完整工作流。它解决了以下问题：

- **自动化代码审查流程**：Agent 执行完成后自动创建 PR，便于人工 Review
- **分支命名规范**：支持中文任务标题，自动转拼音生成可读的分支名
- **PR 标题规范**：使用纯任务标题，避免冗余前缀
- **自动合并**：流程完成后根据项目配置自动 squash merge PR 并删除 feature branch
- **数据追踪**：完整记录 PR 信息到数据库，支持 Timeline 事件追踪

## 整体流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Orchestrator (Go) - 准备阶段                                          │
│    - 查询 task.git_branch, project.git_repo_url, project.git_access_token│
│    - 生成分支名（优先级：change_name > 已有分支 > pinyin slugify）        │
│    - 传递环境变量给 Docker 容器                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Docker Container (entrypoint.sh) - 执行阶段                           │
│    - git clone → checkout -b {feature_branch}                            │
│    - 运行 Claude CLI 执行任务                                             │
│    - git add -A && git commit -m "{commit_msg}"                          │
│    - git push origin {feature_branch} --force                            │
│    - 调用 GitHub API 创建 PR                                              │
│    - 提取 pr_url 和 pr_number                                             │
│    - 写入 /output/git_metadata.json                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Orchestrator (Go) - 回写阶段                                          │
│    - 读取 git_metadata.json                                              │
│    - 更新 tasks.git_branch = {feature_branch}                            │
│    - 更新 flow_runs.branch_name / pr_url / pr_number                     │
│    - 记录 timeline_events: git_pushed, pr_created                        │
│    - 发布 node.completed 事件                                             │
│    - 后续节点复用同一 branch，push 后 PR 自动更新                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. API Server (Node.js) - Auto-Merge 阶段                                │
│    - 监听 flow.completed 事件                                             │
│    - 查询 flow_runs.pr_number + project.auto_merge_pr                    │
│    - 如果启用 auto_merge_pr：                                             │
│      - 调用 GitHubProvider.mergePullRequest (squash merge)               │
│      - 更新 flow_runs.pr_merged_at                                       │
│      - 删除 feature branch                                                │
│      - 记录 timeline_events: pr_merged / pr_merge_failed                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## 分支命名策略

分支名生成遵循以下优先级（在 `claude_adapter.go` 的 `BuildRequest` 中实现）：

| 优先级 | 条件 | 分支名格式 | 示例 |
|--------|------|-----------|------|
| 1 | OpenSpec 模式且有 `OpsxConfig.ChangeName` | `agent/{change_name}` | `agent/flow-back-to-kanban` |
| 2 | `task.git_branch` 非空且非 `main` | 复用已有分支 | `agent/flow-back-to-kanban` |
| 3 | 中文任务标题 | `agent/{pinyin-slug}` | `agent/xiang-mu-fan-hui-kan-ban` |
| 4 | 英文任务标题 | `agent/{english-slug}` | `agent/fix-workflow-back-button` |
| 5 | 全部失败 | `agent/task` | `agent/task` |

### 分支名生成规则

- **中文转拼音**：使用 `go-pinyin` 库（`gopinyin.Normal` 风格，不带声调）
- **字符处理**：
  - CJK 字符 → 拼音
  - 英文字母/数字 → 小写保留
  - 空格/`-`/`_` → 转为 `-`
  - 其他字符 → 跳过
- **长度限制**：30 字符（不含 `agent/` 前缀）
- **清理规则**：
  - 连续 hyphen 合并为单个
  - 去除首尾 hyphen
  - 截断后再次去除尾部 hyphen

### 代码位置

`packages/orchestrator/internal/agent/claude_adapter.go`:

```go
func generateFeatureBranch(taskTitle, gitBranch string) string {
    // 已有非 main 分支，复用
    if gitBranch != "" && gitBranch != "main" {
        return gitBranch
    }

    // 中文转拼音
    a := gopinyin.NewArgs()
    a.Style = gopinyin.Normal
    pinyinResult := gopinyin.Pinyin(taskTitle, a)

    // 拼接拼音 + 保留英文数字
    var parts []string
    pinyinIdx := 0
    for _, r := range taskTitle {
        if r >= 0x4e00 && r <= 0x9fff { // CJK 字符
            if pinyinIdx < len(pinyinResult) && len(pinyinResult[pinyinIdx]) > 0 {
                parts = append(parts, pinyinResult[pinyinIdx][0])
            }
            pinyinIdx++
        } else if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
            parts = append(parts, strings.ToLower(string(r)))
        } else if r == ' ' || r == '-' || r == '_' {
            parts = append(parts, "-")
        }
    }

    slug := strings.Join(parts, "-")
    reg := regexp.MustCompile(`-+`)
    slug = reg.ReplaceAllString(slug, "-")
    slug = strings.Trim(slug, "-")

    // 限制 30 字符
    if len(slug) > 30 {
        slug = slug[:30]
    }
    slug = strings.TrimRight(slug, "-")

    if slug == "" {
        slug = "task"
    }

    return "agent/" + slug
}
```

## PR 创建

### 创建时机

- **第一个 agent_task 节点**：push 后创建 PR
- **后续节点**：push 到同一 branch，尝试创建 PR 时 GitHub 返回 422（已存在），幂等处理

### PR 标题

纯任务标题（`task.title`），不带 `[Agent]` 前缀和节点名。

在 `claude_adapter.go` 的 `BuildRequest` 中设置：

```go
env["GIT_PR_TITLE"] = req.TaskTitle
```

### 创建流程

在 `docker/agent-claude/entrypoint.sh` 的 `create_github_pr` 函数中实现：

```bash
create_github_pr() {
    local FEATURE_BRANCH="$1"
    local BASE_BRANCH="$2"
    local PR_TITLE="$3"
    local PR_BODY="$4"

    # 解析 owner/repo
    local REPO_PATH=$(echo "$GIT_REPO_URL" | sed -E 's|^https?://([^@]*@)?github\.com[/:]||' | sed 's|\.git$||')
    local OWNER=$(echo "$REPO_PATH" | cut -d'/' -f1)
    local REPO=$(echo "$REPO_PATH" | cut -d'/' -f2)

    # 调用 GitHub API
    local API_URL="https://api.github.com/repos/$OWNER/$REPO/pulls"
    local RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"$PR_TITLE\",\"head\":\"$FEATURE_BRANCH\",\"base\":\"$BASE_BRANCH\",\"body\":\"$PR_BODY\"}")

    local HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    local BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "201" ]; then
        local PR_URL=$(echo "$BODY" | grep -o '"html_url":"[^"]*"' | head -1 | cut -d'"' -f4)
        local PR_NUMBER=$(echo "$BODY" | grep -o '"number":[0-9]*' | head -1 | cut -d':' -f2)
        echo "$PR_URL" > /output/pr_url.txt
        echo "$PR_NUMBER" > /output/pr_number.txt
    elif [ "$HTTP_CODE" = "422" ]; then
        echo "[agent] PR already exists (422), continuing..."
    fi
}
```

### Git Metadata 写入

在 `entrypoint.sh` 中，push 成功后写入 `/output/git_metadata.json`：

```bash
PR_URL_VALUE=$(cat /output/pr_url.txt 2>/dev/null || echo "")
PR_NUMBER_VALUE=$(cat /output/pr_number.txt 2>/dev/null || echo "0")
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | head -50 || echo "")

jq -n \
    --arg branch "$FEATURE_BRANCH" \
    --arg base_branch "$BASE_BRANCH" \
    --arg commit "$COMMIT_HASH" \
    --arg commit_msg "$COMMIT_MSG" \
    --arg pr_url "$PR_URL_VALUE" \
    --argjson pr_number "${PR_NUMBER_VALUE:-0}" \
    --arg changed_files "$CHANGED_FILES" \
    '{
        branch: $branch,
        base_branch: $base_branch,
        commit: $commit,
        commit_message: $commit_msg,
        pr_url: $pr_url,
        pr_number: $pr_number,
        changed_files: ($changed_files | split("\n") | map(select(. != "")))
    }' > "$GIT_METADATA_FILE"
```

## 数据持久化

### flow_runs 表字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `branch_name` | varchar(200) | Feature branch 名称 |
| `pr_url` | varchar(500) | PR 的 HTML URL |
| `pr_number` | integer | PR 编号 |
| `pr_merged_at` | timestamp | PR 合并时间 |

### 更新逻辑

在 `packages/orchestrator/internal/engine/node_handlers.go` 的 `updateTaskGitInfo` 函数中：

```go
func (e *FlowExecutor) updateTaskGitInfo(ctx context.Context, taskID, flowRunID, nodeRunID string, git *agent.GitMetadata) error {
    // 1. 更新 task.git_branch
    if err := e.db.UpdateTaskGitBranch(ctx, taskID, git.Branch); err != nil {
        return fmt.Errorf("update task git branch: %w", err)
    }

    // 2. 记录 timeline: git_pushed
    e.recordTimeline(ctx, taskID, flowRunID, nodeRunID, "git_pushed", map[string]any{
        "branch": git.Branch,
        "commit": git.Commit,
        "message": fmt.Sprintf("已推送到分支 %s", git.Branch),
    })

    // 3. 记录 timeline: pr_created (如果有 PR)
    if git.PrUrl != "" {
        e.recordTimeline(ctx, taskID, flowRunID, nodeRunID, "pr_created", map[string]any{
            "pr_url":  git.PrUrl,
            "branch":  git.Branch,
            "message": fmt.Sprintf("已创建 PR: %s", git.PrUrl),
        })
    }

    // 4. 更新 flow_runs PR 信息
    if err := e.db.UpdateFlowRunPR(ctx, flowRunID, git.Branch, git.PrUrl, git.PrNumber); err != nil {
        e.logger.Warnw("Failed to update flow run PR info", "error", err)
        // Non-fatal
    }

    return nil
}
```

### 查询方法

在 `packages/orchestrator/internal/db/queries.go` 中：

```go
// UpdateFlowRunPR updates PR-related fields on a flow run.
// Uses COALESCE to only write non-empty values, preserving existing data.
func (c *Client) UpdateFlowRunPR(ctx context.Context, flowRunID, branchName, prUrl string, prNumber int) error {
    _, err := c.pool.Exec(ctx, `
        UPDATE flow_runs
        SET branch_name = COALESCE(NULLIF($2, ''), branch_name),
            pr_url = COALESCE(NULLIF($3, ''), pr_url),
            pr_number = COALESCE(NULLIF($4, 0), pr_number)
        WHERE id = $1
    `, flowRunID, branchName, prUrl, prNumber)
    return err
}
```

## Auto-Merge

### 触发条件

- 监听 `flow.completed` 事件
- `flow_runs.pr_number` 非空
- `project.auto_merge_pr = true`
- `project.git_access_token` 和 `project.git_repo_url` 已配置

### Merge 方式

项目可配置 `git_merge_method` 字段（默认 `merge`）：

| 方式 | 说明 | Git 历史 |
|------|------|---------|
| `merge` | 创建 merge commit | 保留所有 commits + "Merge pull request #X from branch" |
| `squash` | 压缩为单个 commit | 单个 commit，message 为 `task.title` |
| `rebase` | 线性合并 | 将 feature branch commits 线性合并到 main |

**推荐使用 `merge` 方式**，和手动点击 GitHub Merge 按钮效果一致，便于追踪 PR 历史。

### 实现位置

`packages/api/src/ws/gateway.ts` 的 `handleFlowCompletedAutoMerge` 函数：

```typescript
async function handleFlowCompletedAutoMerge(
  flowRunId: string,
  logger: { info: (...args: any[]) => void; error: (...args: any[]) => void; warn: (...args: any[]) => void }
) {
  // 1. 查询 flow_run
  const [flowRun] = await db.select().from(flowRuns).where(eq(flowRuns.id, flowRunId))
  if (!flowRun?.prNumber) return // 没有 PR，跳过

  // 2. 查询 task → project
  const [task] = await db.select().from(tasks).where(eq(tasks.id, flowRun.taskId))
  if (!task) return

  const [project] = await db.select().from(projects).where(eq(projects.id, task.projectId))
  if (!project?.autoMergePr || !project.gitAccessToken || !project.gitRepoUrl) return

  // 3. 执行 squash merge
  const provider = new GitHubProvider(project.gitAccessToken)
  const repoInfo = provider.parseRepoUrl(project.gitRepoUrl)
  if (!repoInfo) return

  const mergeResult = await provider.mergePullRequest({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    pullNumber: flowRun.prNumber,
    mergeMethod: 'squash',
    commitTitle: task.title,
  })

  if (mergeResult.merged) {
    // 4. 更新 flow_run
    await db.update(flowRuns).set({ prMergedAt: new Date() }).where(eq(flowRuns.id, flowRunId))

    // 5. 记录 timeline
    await db.insert(timelineEvents).values({
      taskId: task.id,
      flowRunId: flowRunId,
      eventType: 'pr_merged',
      content: { prUrl: flowRun.prUrl, message: `PR 已自动合并` },
    })

    // 6. 删除 feature branch
    if (flowRun.branchName) {
      await provider.deleteBranch(repoInfo.owner, repoInfo.repo, flowRun.branchName).catch(() => {})
    }

    logger.info(`Auto-merged PR #${flowRun.prNumber} for flow ${flowRunId}`)
  } else {
    // 记录合并失败
    await db.insert(timelineEvents).values({
      taskId: task.id,
      flowRunId: flowRunId,
      eventType: 'pr_merge_failed',
      content: { prUrl: flowRun.prUrl, error: mergeResult.message, message: `PR 自动合并失败: ${mergeResult.message}` },
    })

    logger.warn(`Failed to auto-merge PR #${flowRun.prNumber}: ${mergeResult.message}`)
  }
}
```

### Merge 方法

`packages/api/src/lib/github-provider.ts` 的 `mergePullRequest` 方法：

- **Merge 方式**：`squash`（将所有 commits 压缩为一个）
- **Commit 标题**：使用 `task.title`
- **错误处理**：
  - 405：不可合并（如需要 review）
  - 409：冲突
  - 其他：API 错误

### Branch 删除

Merge 成功后调用 `deleteBranch` 方法：

```typescript
async deleteBranch(owner: string, repo: string, branch: string): Promise<boolean> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  return response.status === 204
}
```

## Timeline 事件

| 事件类型 | 触发时机 | 内容 |
|---------|---------|------|
| `git_pushed` | 容器 push 成功后 | `{ branch, commit, message }` |
| `pr_created` | PR 创建成功后 | `{ pr_url, branch, message }` |
| `pr_merged` | Auto-merge 成功后 | `{ prUrl, message }` |
| `pr_merge_failed` | Auto-merge 失败后 | `{ prUrl, error, message }` |

所有 timeline 事件都记录在 `timeline_events` 表中，包含：

- `task_id`：关联的任务
- `flow_run_id`：关联的流程实例
- `node_run_id`：关联的节点执行（仅 git_pushed / pr_created）
- `event_type`：事件类型
- `content`：JSON 格式的事件详情

## 涉及文件索引

### Orchestrator (Go)

| 文件 | 功能 |
|------|------|
| `packages/orchestrator/internal/agent/adapter.go` | `GitMetadata` 结构体定义（包含 `pr_number`） |
| `packages/orchestrator/internal/agent/claude_adapter.go` | 分支名生成、PR 标题设置、环境变量传递 |
| `packages/orchestrator/internal/db/queries.go` | `UpdateFlowRunPR` 数据库更新方法 |
| `packages/orchestrator/internal/engine/node_handlers.go` | `updateTaskGitInfo` 回写逻辑 |
| `packages/orchestrator/go.mod` | `go-pinyin` 依赖 |

### Docker Container

| 文件 | 功能 |
|------|------|
| `docker/agent-claude/entrypoint.sh` | Git 操作、PR 创建、metadata 写入 |

### API Server (Node.js)

| 文件 | 功能 |
|------|------|
| `packages/api/src/db/schema.ts` | `flow_runs` 表 PR 字段定义 |
| `packages/api/src/ws/gateway.ts` | `flow.completed` 事件监听、auto-merge 逻辑 |
| `packages/api/src/lib/github-provider.ts` | GitHub API 封装（merge / delete branch） |

### 数据库

| 文件 | 功能 |
|------|------|
| `packages/api/src/db/migrations/20260214121411_add-flow-run-pr-fields/` | PR 字段迁移 |

## 常见问题

### Q: 为什么 PR 创建在容器内而不是 API Server？

A: 容器内有完整的 Git 上下文（branch name、commit hash、changed files），且 PR 创建是 Git 操作的自然延续。API Server 只负责流程完成后的 auto-merge，职责更清晰。

### Q: 如果 PR 创建失败会怎样？

A: 容器会记录警告日志，但不会中断流程。`git_metadata.json` 中 `pr_url` 和 `pr_number` 为空，后续 auto-merge 会跳过（因为 `flow_runs.pr_number` 为空）。

### Q: 多个节点会创建多个 PR 吗？

A: 不会。第一个节点创建 PR 后，`task.git_branch` 被更新为 feature branch。后续节点复用同一 branch，push 后 PR 自动更新。尝试创建 PR 时 GitHub 返回 422（已存在），幂等处理。

### Q: Auto-merge 失败后会重试吗？

A: 不会自动重试。失败原因（如需要 review、有冲突）会记录到 `timeline_events` 的 `pr_merge_failed` 事件中，需要人工介入。

### Q: 如何禁用 Auto-Merge？

A: 在项目设置中将 `auto_merge_pr` 设为 `false`。PR 仍会创建，但不会自动合并。

### Q: 分支名长度为什么限制 30 字符？

A: 平衡可读性和简洁性。GitHub 分支名最长 255 字符，但过长的分支名在 UI 中显示不友好。30 字符足够表达大部分任务的核心含义。

## 相关文档

- [OpenSpec 用户指南](./openspec/openspec-user-guide.md) — OpenSpec 模式下的 `change_name` 配置
- [OpenSpec 技术指南](./openspec/openspec-technical-guide.md) — OpenSpec 与 Git 集成的技术细节
- [数据模型设计](../spec/06-data-model.md) — `flow_runs` 和 `timeline_events` 表结构
- [API 设计](../spec/08-api-design.md) — WebSocket 事件和 gRPC 接口
