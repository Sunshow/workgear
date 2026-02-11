# 6. 数据模型

## 6.1 ER 关系概览

```
User ──┬──< ProjectMember >──┬── Project ──┬──< Board
       │                     │             ├──< Workflow (流程模板)
       │                     │             ├──< AgentConfig
       │                     │             └──< GitRepo
       │                     │
       │                     └── Task ──┬──1:N── FlowRun ──< NodeRun
       │                                │                     └──< NodeRunHistory
       │                                ├──< TimelineEvent     └──< NodeRunAttribution
       │                                ├──< Artifact ──< ArtifactVersion
       │                                │               └──< ArtifactLink
       │                                │               └──< ArtifactReview
       │                                └──< GitBranch / PR
       │
       └──< Notification
```

> 注：Task:FlowRun 为 1:N 关系，但同一时刻只允许一个 active FlowRun（通过部分唯一索引约束）。

## 6.2 核心表结构

### 用户与项目

```sql
-- 用户
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) UNIQUE NOT NULL,
    name        VARCHAR(100) NOT NULL,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 项目
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    git_repo_url    TEXT,              -- Git仓库地址
    git_provider    VARCHAR(20),       -- github / gitlab / gitea
    git_default_branch VARCHAR(100) DEFAULT 'main',
    settings    JSONB DEFAULT '{}',    -- 项目级配置
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 项目成员
CREATE TABLE project_members (
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL DEFAULT 'member', -- owner / admin / member
    PRIMARY KEY (project_id, user_id)
);
```

### 流程模板

```sql
-- 流程模板（DSL存储）
CREATE TABLE workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,
    slug        VARCHAR(100) NOT NULL,
    description TEXT,
    dsl         JSONB NOT NULL,        -- 流程DSL（从YAML解析后存为JSON）
    version     INTEGER DEFAULT 1,
    is_active   BOOLEAN DEFAULT true,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, slug, version)
);

-- 流程实例（每次执行创建一个）
CREATE TABLE flow_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID REFERENCES workflows(id),
    project_id  UUID REFERENCES projects(id),
    task_id     UUID REFERENCES tasks(id),  -- 关联的Task（可选，1:N）
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
    variables   JSONB DEFAULT '{}',    -- 运行时变量
    trigger_type VARCHAR(20),          -- manual / board_event / webhook / desktop
    trigger_data JSONB,
    
    -- 运行域（R4 新增）
    execution_domain VARCHAR(20) NOT NULL DEFAULT 'cloud',  -- cloud | local
    -- Web/API 触发默认 cloud，桌面端触发默认 local，可显式指定覆盖
    
    -- 恢复机制（P1-2 新增）
    resume_token        VARCHAR(200),  -- 恢复令牌，服务重启后用于恢复执行
    recovery_checkpoint JSONB,         -- 检查点数据（当前执行位置快照）
    
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 同一 Task 只允许一个 active FlowRun（P2 改进）
CREATE UNIQUE INDEX idx_task_active_flow
  ON flow_runs(task_id)
  WHERE status IN ('pending', 'running', 'paused');

-- 节点执行实例
CREATE TABLE node_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_run_id UUID REFERENCES flow_runs(id) ON DELETE CASCADE,
    node_id     VARCHAR(100) NOT NULL, -- DSL中的node id
    node_name   VARCHAR(200),
    node_type   VARCHAR(50) NOT NULL
                CHECK (node_type IN (
                    'agent_task','human_input','human_review','parallel_group',
                    'collab_task','aggregate','adjudicate',
                    'conditional','loop','integration','transform','sub_workflow'
                )),
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN (
                    'pending','queued','running','completed','failed',
                    'rejected','waiting_human','skipped'
                )),
    
    -- 作用域标识（P0-2 新增）
    scope_key       VARCHAR(200) DEFAULT '',   -- 所属 parallel_group 的 node_id（嵌套用 . 分隔）
    iteration_key   VARCHAR(200) DEFAULT '',   -- 迭代标识（从 foreach item 派生）
    idempotency_key VARCHAR(200),              -- 幂等键（P1-3 新增）
    
    -- 执行上下文
    input       JSONB,                 -- 输入数据
    output      JSONB,                 -- 输出数据
    config      JSONB,                 -- 节点配置快照
    
    -- Agent信息
    agent_type  VARCHAR(50),           -- claude-code / kiro-droid / human
    agent_role  VARCHAR(100),
    agent_instance_id VARCHAR(100),
    
    -- 执行指标
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    token_input INTEGER,
    token_output INTEGER,
    
    -- 打回相关
    attempt     INTEGER DEFAULT 1,     -- 第几次执行（打回后递增）
    rejected_by VARCHAR(100),          -- 被谁打回
    reject_reason TEXT,
    
    -- 人工Review相关
    review_action VARCHAR(20),         -- approve / reject / edit_and_approve
    review_comment TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    
    -- 租约（P1-2 新增，防重复执行）
    locked_by   VARCHAR(100),          -- Worker ID
    locked_at   TIMESTAMPTZ,
    lock_expires_at TIMESTAMPTZ,
    
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 唯一约束：同一流程实例中，同一作用域同一迭代同一次尝试只有一个 NodeRun（P0-2 新增）
CREATE UNIQUE INDEX idx_node_runs_identity
  ON node_runs(flow_run_id, node_id, scope_key, iteration_key, attempt);

-- 节点执行历史（打回时保留历史记录）
CREATE TABLE node_run_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_run_id UUID REFERENCES node_runs(id) ON DELETE CASCADE,
    attempt     INTEGER NOT NULL,
    status      VARCHAR(20) NOT NULL,
    input       JSONB,
    output      JSONB,
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### 看板与任务

```sql
-- 看板
CREATE TABLE boards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,
    config      JSONB DEFAULT '{}',    -- 列配置、流程映射等
    is_default  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 看板列
CREATE TABLE board_columns (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id    UUID REFERENCES boards(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(50) NOT NULL,
    color       VARCHAR(7),
    position    INTEGER NOT NULL,
    flow_stage  VARCHAR(50),           -- 映射的流程阶段
    wip_limit   INTEGER,               -- WIP限制
    UNIQUE(board_id, slug)
);

-- 任务
CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    board_id    UUID REFERENCES boards(id),
    column_id   UUID REFERENCES board_columns(id),
    
    -- 基本信息
    title       VARCHAR(500) NOT NULL,
    description TEXT,
    task_number INTEGER NOT NULL,      -- 项目内自增编号
    priority    VARCHAR(5) DEFAULT 'P2',
    labels      TEXT[] DEFAULT '{}',
    
    -- 流程关联（P2 改进：移除 flow_run_id，改为通过 flow_runs.task_id 单向查询）
    workflow_id UUID REFERENCES workflows(id), -- 使用的流程模板
    current_node VARCHAR(100),         -- 当前执行到的节点（由引擎同步更新）
    flow_progress DECIMAL(5,2),        -- 流程进度百分比（由引擎同步更新）
    
    -- Git关联
    git_branch  VARCHAR(200),
    git_pr_number INTEGER,
    git_pr_url  TEXT,
    
    -- 分配
    assignee_id UUID REFERENCES users(id),
    agent_role  VARCHAR(100),          -- 负责的Agent角色
    
    -- 父子关系
    parent_task_id UUID REFERENCES tasks(id),
    
    position    INTEGER,               -- 列内排序
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(project_id, task_number)
);
```

### Agent配置

```sql
-- 项目级Agent配置
CREATE TABLE agent_configs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    name        VARCHAR(100) NOT NULL,
    agent_type  VARCHAR(50) NOT NULL,  -- claude-code / kiro-droid / custom-http
    
    -- 连接配置
    config      JSONB NOT NULL,        -- binary_path, endpoint, auth等
    
    -- 角色配置
    roles       JSONB DEFAULT '[]',    -- 该Agent可承担的角色列表
    
    -- 运行环境
    runtime     VARCHAR(20) NOT NULL,  -- local / remote / docker（必填，无默认值）
    execution_domain VARCHAR(20) DEFAULT 'cloud'
                CHECK (execution_domain IN ('local', 'cloud', 'hybrid')),
    visibility_scope VARCHAR(20) DEFAULT 'project'
                CHECK (visibility_scope IN ('desktop_only', 'project', 'org')),
    
    -- 校验：cloud 域不允许 local runtime
    CONSTRAINT chk_cloud_no_local CHECK (NOT (execution_domain = 'cloud' AND runtime = 'local')),
    
    -- 资源限制
    max_concurrent INTEGER DEFAULT 1,
    timeout_seconds INTEGER DEFAULT 600,
    
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Agent角色模板
CREATE TABLE agent_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    role_key    VARCHAR(100) NOT NULL,  -- requirement-analyst, code-reviewer...
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    system_prompt TEXT,
    default_agent_config_id UUID REFERENCES agent_configs(id),
    capabilities TEXT[] DEFAULT '{}',
    
    UNIQUE(project_id, role_key)
);
```

### 消息时间线

```sql
-- 时间线事件
CREATE TABLE timeline_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE,
    flow_run_id UUID REFERENCES flow_runs(id),
    node_run_id UUID REFERENCES node_runs(id),
    
    event_type  VARCHAR(30) NOT NULL,
    -- agent_message / human_message / status_change / review_action / git_event / system_event
    
    from_type   VARCHAR(10),           -- agent / human / system
    from_id     VARCHAR(100),
    from_name   VARCHAR(200),
    from_role   VARCHAR(100),
    
    to_type     VARCHAR(10),
    to_id       VARCHAR(100),
    to_name     VARCHAR(200),
    
    content     TEXT,
    content_type VARCHAR(20) DEFAULT 'markdown',
    metadata    JSONB DEFAULT '{}',
    
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_timeline_task ON timeline_events(task_id, created_at);
CREATE INDEX idx_timeline_flow ON timeline_events(flow_run_id, created_at);
CREATE INDEX idx_node_runs_flow ON node_runs(flow_run_id, node_id);
CREATE INDEX idx_tasks_project ON tasks(project_id, column_id, position);
CREATE INDEX idx_flow_runs_task ON flow_runs(task_id);
```

### 产物模型（P1-1 新增）

```sql
-- 产物主表
CREATE TABLE artifacts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id         UUID REFERENCES tasks(id),
    flow_run_id     UUID REFERENCES flow_runs(id),
    source_node_run_id UUID REFERENCES node_runs(id),
    
    artifact_type   VARCHAR(30) NOT NULL,
    -- requirement / prd / user_story / tech_spec / test_plan / review_report / acceptance_report
    
    title           VARCHAR(500) NOT NULL,
    current_version_id UUID,           -- 指向最新版本（延迟外键，建表后 ALTER 添加）
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','reviewing','approved','rejected','archived')),
    
    -- 产出归属
    created_by_type VARCHAR(10) NOT NULL,  -- human / agent
    created_by_id   VARCHAR(100) NOT NULL,
    created_by_role VARCHAR(100),
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 产物版本表
CREATE TABLE artifact_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_id     UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version_no      INTEGER NOT NULL,
    
    content         JSONB NOT NULL,        -- 结构化内容（按 schema 存储）
    content_text    TEXT,                   -- 纯文本/Markdown 渲染版本
    schema_ref      VARCHAR(100),          -- 对应的 JSON Schema 引用
    
    -- 质量评估
    quality_score   INTEGER,               -- 0-100
    quality_report  JSONB,                 -- Rubric 评分详情
    
    -- 来源追溯
    source_node_run_id UUID REFERENCES node_runs(id),
    source_agent_role  VARCHAR(100),
    source_agent_id    VARCHAR(100),
    
    -- 变更说明
    change_summary  TEXT,
    
    created_by_type VARCHAR(10) NOT NULL,
    created_by_id   VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(artifact_id, version_no)
);

-- 产物引用关系（DAG）
CREATE TABLE artifact_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    to_artifact_id  UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    
    link_type       VARCHAR(30) NOT NULL,
    -- derives_from:  PRD derives_from Requirement
    -- splits_to:     PRD splits_to UserStory
    -- implements:    Task implements UserStory
    -- verifies:      TestPlan verifies UserStory
    -- supersedes:    新版本 supersedes 旧版本
    
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(from_artifact_id, to_artifact_id, link_type)
);

-- 产物审批记录
CREATE TABLE artifact_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
    
    reviewer_type   VARCHAR(10) NOT NULL,  -- human / agent
    reviewer_id     VARCHAR(100) NOT NULL,
    reviewer_role   VARCHAR(100),
    
    action          VARCHAR(20) NOT NULL,  -- approve / reject / request_changes
    comment         TEXT,
    score           INTEGER,               -- 可选评分
    
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 产物索引
CREATE INDEX idx_artifacts_project ON artifacts(project_id, artifact_type);
CREATE INDEX idx_artifacts_task ON artifacts(task_id);
CREATE INDEX idx_artifact_versions_artifact ON artifact_versions(artifact_id, version_no);
CREATE INDEX idx_artifact_links_from ON artifact_links(from_artifact_id);
CREATE INDEX idx_artifact_links_to ON artifact_links(to_artifact_id);

-- 延迟外键：artifacts.current_version_id → artifact_versions.id
ALTER TABLE artifacts
  ADD CONSTRAINT fk_artifacts_current_version
  FOREIGN KEY (current_version_id) REFERENCES artifact_versions(id);
```

### 协同与归属（P0-3 新增）

```sql
-- 节点产出归属（记录每个 Agent 的贡献）
CREATE TABLE node_run_attributions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_run_id UUID NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
    
    agent_role  VARCHAR(100) NOT NULL,
    agent_id    VARCHAR(100) NOT NULL,
    
    output_hash VARCHAR(64) NOT NULL,  -- 输出内容 SHA256，用于去重
    output      JSONB NOT NULL,
    metrics     JSONB,                 -- token 用量、耗时等
    
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(node_run_id, agent_role, output_hash)
);

CREATE INDEX idx_attributions_node ON node_run_attributions(node_run_id);
```

### 外部副作用控制（P1-3 新增）

```sql
-- Outbox 表：外部副作用（Git 操作、Webhook 调用等）先写入此表，再由异步 Worker 执行
CREATE TABLE outbox_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_run_id     UUID NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
    
    event_type      VARCHAR(50) NOT NULL,  -- git_create_branch / git_commit / git_create_pr / webhook_call
    idempotency_key VARCHAR(200) NOT NULL UNIQUE,  -- 幂等键
    
    payload         JSONB NOT NULL,
    
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    
    last_error      TEXT,
    
    -- Worker 租约
    locked_by       VARCHAR(100),
    locked_at       TIMESTAMPTZ,
    lock_expires_at TIMESTAMPTZ,
    
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_outbox_status ON outbox_events(status, created_at);
CREATE INDEX idx_outbox_node ON outbox_events(node_run_id);

-- Webhook 去重表（入站事件去重）
CREATE TABLE webhook_dedup (
    delivery_id     VARCHAR(200) PRIMARY KEY,  -- GitHub/GitLab 的 delivery ID
    provider        VARCHAR(20) NOT NULL,      -- github / gitlab
    event_type      VARCHAR(50) NOT NULL,
    received_at     TIMESTAMPTZ DEFAULT NOW(),
    processed       BOOLEAN DEFAULT FALSE
);

-- 辅助索引（加速定时清理查询）
-- 注：PostgreSQL 不支持自动 TTL 删除，需由后台定时任务（cron）执行：
-- DELETE FROM webhook_dedup WHERE received_at < NOW() - INTERVAL '7 days';
CREATE INDEX idx_webhook_dedup_cleanup ON webhook_dedup(received_at);
```
