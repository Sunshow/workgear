# 4. 技术方案

## 4.1 架构

- **前端**：React 19 + TypeScript + Vite + Shadcn/ui + Tailwind CSS
- **API 服务**：Node.js + Fastify + TypeScript + Drizzle ORM
- **调度服务**：Go 1.22+ + gRPC
- **数据库**：PostgreSQL 16
- **缓存/队列**：Redis 7
- **实时通信**：WebSocket (ws)

## 4.2 技术约束

- **Agent 类型限制**：WorkGear 只支持 CLI Agent（通过子进程方式调用）
  - MVP 阶段仅支持 ClaudeCode
  - 未来可扩展支持其他 CLI Agent（如 Droid）
  - 不支持非 CLI Agent（如 Kiro 等基于 API 的 Agent）
- **账号模型限制**：MVP 仅支持单账号（Owner）登录，不支持多用户协作权限

## 4.3 核心流程

### 4.3.1 Task 启动流程

```
用户创建 Task → 点击"启动任务" → 选择流程模板
  ↓
API Server 创建 FlowRun 实例
  ↓
通过 gRPC 调用 Orchestrator.StartFlow
  ↓
Orchestrator 解析 DSL，开始执行第一个节点
  ↓
通过 WebSocket 推送状态到前端
```

### 4.3.2 节点执行流程

```
引擎从队列取出待执行节点
  ↓
根据节点类型选择执行器
  ↓
agent_task → 调用 ClaudeCode Adapter
human_review → 落库等待，推送通知到前端
  ↓
执行完成，更新 node_runs 表
  ↓
触发下一节点执行
  ↓
通过 WebSocket 推送状态
```

### 4.3.3 打回流程

```
用户在 human_review 节点点击 Reject
  ↓
API Server 调用 Orchestrator.RejectNode
  ↓
当前节点标记为 REJECTED，归档到 node_run_history
  ↓
根据 on_reject.goto 找到目标节点
  ↓
注入反馈上下文，从目标节点重新执行
  ↓
attempt 递增，检查是否超过 max_loops
```

### 4.3.4 人工编辑流程（human_review.edit）

```
用户在 human_review 节点点击 Edit 并修改内容
  ↓
API Server 写入 artifact_versions 新版本（保留修改说明）
  ↓
更新被审核节点的 node_runs.output 为编辑后内容
（如 review_prd 编辑后，更新 analyze_requirement 的 output）
  ↓
下游节点引用 {{nodes.analyze_requirement.outputs}} 自动获取编辑后版本
  ↓
当前节点标记为 COMPLETED（action=edit）
  ↓
更新 timeline_events，记录 edit 操作
  ↓
继续执行下一节点
```

## 4.4 数据模型（核心表）

- `projects`：项目
- `boards`：看板
- `board_columns`：看板列
- `tasks`：任务
- `workflow_templates`：流程模板（内置模板）
- `workflows`：项目流程（用户基于模板创建的流程定义）
- `flow_runs`：流程实例
- `node_runs`：节点执行实例
- `node_run_history`：节点执行历史
- `artifacts`：产物
- `artifact_versions`：产物版本
- `artifact_links`：产物引用关系
- `timeline_events`：消息时间线
- `agent_configs`：Agent 配置
- `agent_roles`：Agent 角色模板

### 4.4.1 流程模板表结构

```sql
-- 流程模板表（内置模板）
CREATE TABLE workflow_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        VARCHAR(100) UNIQUE NOT NULL,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    category    VARCHAR(50),
    difficulty  VARCHAR(20),
    estimated_time VARCHAR(50),
    parameters  JSONB DEFAULT '[]',  -- 参数定义
    template    TEXT NOT NULL,       -- Handlebars 模板
    is_builtin  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- workflows 表补充字段
ALTER TABLE workflows ADD COLUMN template_id UUID REFERENCES workflow_templates(id);
ALTER TABLE workflows ADD COLUMN template_params JSONB;  -- 用户填写的参数值
```

## 4.5 失败处理与幂等策略

| 场景 | 系统行为 | 上限/策略 |
|------|----------|-----------|
| Agent 执行超时 | 标记 node_run 为 failed，按策略自动重试 | 单节点最多 3 次，指数退避（1s/2s/4s） |
| Agent 进程异常退出 | 记录 stderr，重试并保留失败快照 | 单节点最多 3 次 |
| 用户主动取消 FlowRun | 流程标记为 cancelled，停止后续节点调度 | 取消操作幂等（重复请求返回同一结果） |
| Reject 超过 max_loops | FlowRun 标记为 `failed`，`error` 字段记录 `max_loops_exceeded` | 可由用户手动重启新 FlowRun |
| 调度服务重启恢复 | 基于 recovery_checkpoint 恢复 running 节点 | 恢复过程使用幂等键避免重复执行 |

## 4.6 MVP 流程模板示例

```yaml
name: "simple-dev-pipeline"
version: "1.0"
description: "简单开发流水线：需求输入 → Agent 分析 → 人工确认 → Agent 执行 → 人工 Review"

variables:
  project_id: ""
  requirement_text: ""

nodes:
  - id: input_requirement
    name: "输入需求"
    type: human_input
    config:
      form:
        - field: requirement_text
          type: textarea
          label: "需求描述"
          required: true

  - id: analyze_requirement
    name: "Agent 分析需求"
    type: agent_task
    agent:
      role: "requirement-analyst"
    config:
      prompt_template: |
        请分析以下需求并输出 PRD：
        {{nodes.input_requirement.outputs.requirement_text}}
      mode: spec
      artifact:
        type: prd
        title: "{{nodes.input_requirement.outputs.requirement_text | truncate(100)}} - PRD"

  - id: review_prd
    name: "Review PRD"
    type: human_review
    config:
      review_target: "{{nodes.analyze_requirement.outputs}}"
      actions: [approve, reject, edit]
    on_reject:
      goto: analyze_requirement
      max_loops: 3

  - id: execute_task
    name: "执行任务"
    type: agent_task
    agent:
      role: "general-developer"
    config:
      prompt_template: |
        请按照以下 PRD 执行任务：
        {{nodes.analyze_requirement.outputs}}
      mode: execute
      git:
        create_branch: true

  - id: review_code
    name: "Review 代码"
    type: human_review
    config:
      review_target: "{{nodes.execute_task.outputs}}"
      show_diff: true
      actions: [approve, reject, edit]
    on_reject:
      goto: execute_task
      max_loops: 2

edges:
  - from: input_requirement
    to: analyze_requirement
  - from: analyze_requirement
    to: review_prd
  - from: review_prd
    to: execute_task
  - from: execute_task
    to: review_code
```

## 4.7 安全边界（MVP 最小实现）

- ClaudeCode Adapter 以受限子进程执行（工作目录限定到项目目录）
- 白名单目录策略：
  - 可读写：项目 Git 仓库目录
  - 只读：系统临时目录（用于 Agent 缓存）
  - 禁止：用户 HOME 目录、系统配置目录
- 环境变量注入策略：
  - 允许：PATH、LANG、TZ
  - 禁止：所有 `*_TOKEN`、`*_KEY`、`*_SECRET` 变量，默认不透传宿主敏感变量
- 日志与时间线对 token/密钥做脱敏（如 `sk-***`）
- 关键操作留痕：启动流程、Reject/Edit、取消流程、重试

## 4.8 可观测性要求（MVP）

- 最小日志字段：`trace_id`、`project_id`、`task_id`、`flow_run_id`、`node_id`、`attempt`
- 核心指标：Flow 成功率、Node 失败率、重试率、人工打回率、平均恢复时长
- 告警阈值（初版）：
  - 5 分钟内 Node 失败率 > 20%
  - 连续 3 次恢复失败
  - WebSocket 推送延迟 p95 > 1s
