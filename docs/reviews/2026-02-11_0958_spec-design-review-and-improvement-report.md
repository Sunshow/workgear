# WorkGear 规格设计审核与改进建议报告

- 审核对象：`docs/spec/`
- 审核时间：`2026-02-11 09:58`
- 审核目标：评估现有设计的完整性、可实施性与扩展性，重点回答：
  1) 是否能支持“需求描述 → PRD → User Story → 执行”的流程编排；
  2) 是否能支持多 Agent 协同完成单个环节。

---

## 1. 审核范围与方法

### 1.1 覆盖文档

- `docs/spec/README.md`
- `docs/spec/02-architecture.md`
- `docs/spec/03-flow-engine.md`
- `docs/spec/04-agent-layer.md`
- `docs/spec/05-board-flow-integration.md`
- `docs/spec/06-data-model.md`
- `docs/spec/07-roadmap.md`
- `docs/spec/08-api-design.md`
- `docs/spec/09-implementation-details.md`

### 1.2 审核维度

- 架构一致性（文档间概念与实现是否对齐）
- 流程引擎可表达性（DSL 能力是否覆盖关键场景）
- Agent 协作能力（并行、协同、仲裁、回退）
- 数据可追溯性（PRD/User Story/执行产物闭环）
- 运行可靠性（幂等、恢复、并发控制、失败处理）
- 落地路径清晰度（MVP 到生产级演进）

---

## 2. 总体结论（Executive Summary）

### 2.1 一句话结论

现有设计已经具备较强的编排骨架，**可以支撑“需求→PRD→User Story”的 PoC**；但距离稳定生产级能力尚有关键缺口，尤其在**并行语义、产物模型、多 Agent 协同协议、恢复与幂等机制**。

### 2.2 对两个核心问题的回答

#### A. 能否支持通过需求描述生成 PRD 和 User Story 的流程编排？

**可以，但建议先补齐关键约束后再规模化。**

原因：
- 已有 `human_input`、`agent_task(mode: spec)`、`output_schema`、`human_review`、`on_reject` 等核心机制。
- 可用 `foreach` 动态并行处理拆分任务。
- 看板与流程映射可提供业务可视化。

短板：
- PRD/User Story 尚未成为“一等产物实体”，目前主要依赖 `node_runs.output` JSON。
- 产物版本、审批历史、引用关系（需求→PRD→Story）缺少结构化建模。

#### B. 能否实现多 Agent 协同完成单个环节？

**可以实现“多 Agent 并行执行”，但尚不能稳定实现“单环节协同决策”。**

现状：
- 已有 `parallel_group` 与调度策略，可并行分发多个任务。

缺失：
- 同一环节缺少“协同协议”：无投票、共识、仲裁、冲突合并机制。
- 缺少跨 Agent 共享上下文协议（谁可读写哪些中间结论、版本如何管理）。

---

## 3. 关键优势（值得保留）

1. **分层架构清晰**：API / Orchestrator / Agent Runtime / Data 分层明确。
2. **流程表达能力较完整**：节点类型体系覆盖人机协作、并行、条件、外部集成。
3. **看板融合思路正确**：流程进度与任务态联动，贴合团队操作习惯。
4. **Agent 接口抽象较好**：统一 Adapter + Registry + Scheduler，具备扩展基础。
5. **演进路线可执行**：Roadmap 分阶段目标有连续性。

---

## 4. 主要问题清单（按优先级）

> 分级说明：
> - P0：阻塞关键能力上线
> - P1：高概率导致线上不稳定或数据不可治理
> - P2：可用但影响效率/可维护性

### 4.1 P0：DSL 语义与执行实现存在不一致

#### 问题描述

在示例 DSL 中，`parallel_group.children` 同时包含有顺序依赖的节点（如 `create_plan` → `review_plan`），但执行器实现把 children 并发执行。

#### 影响

- 会导致“评审先于产出”的逻辑错误。
- PRD / Story 生成链路可能出现空输入或脏数据。

#### 改进建议

- 为 `parallel_group` 增加明确执行模式：
  - `execution_mode: parallel`（纯并行）
  - `execution_mode: staged`（分阶段并行，每阶段内并发）
  - `execution_mode: serial`（串行）
- 或者强约束：`parallel_group.children` 必须是无依赖节点，依赖通过子 DAG 显式表达。

---

### 4.2 P0：foreach 作用域与回退目标缺乏形式化定义

#### 问题描述

`on_reject.goto: execute_task` 在 foreach 并行上下文中未定义实例级定位规则（回到哪个 task 实例）。

#### 影响

- 打回后可能回错分支或回退到模板节点而非实例节点。
- 出现“部分分支重跑、部分分支污染”的一致性问题。

#### 改进建议

- 定义 NodeRun 实例标识规范：`node_id + scope_key + iteration_key`。
- `goto` 增强为：
  - `goto.node_id`
  - `goto.scope: current_iteration | parent_scope | global`
  - `goto.selector`（可选表达式筛选目标实例）

---

### 4.3 P0：多 Agent 协同缺少“单环节协同协议”

#### 问题描述

当前是“选一个 Agent 执行一个节点”，即使并行也主要是任务拆分并发，而不是同环节协同决策。

#### 影响

- 无法稳定实现“多 Agent 共同产出同一个 PRD/Story”的高质量流程。
- 难以做质量兜底（例如交叉评审、冲突仲裁）。

#### 改进建议

新增协同节点与协议：
- `collab_task`：同输入分发给多个 agent。
- `aggregate`：收敛多个输出。
- `adjudicate`：按规则仲裁（打分、投票、优先级、人工终审）。
- `consensus_policy`：`majority | weighted_vote | reviewer_decides | rubric_score`。

---

### 4.4 P1：产物模型缺失（PRD/User Story 不是一等实体）

#### 问题描述

PRD、Story、Acceptance Criteria、NFR 等关键产物没有独立表与版本链路。

#### 影响

- 难做版本对比、审计、回溯。
- 难和 Git/PR/测试报告形成可查询闭环。

#### 改进建议

增加以下模型：
- `artifacts`（产物主表）
- `artifact_versions`（版本表）
- `artifact_links`（引用图，如 requirement→PRD→Story→Task）
- `artifact_reviews`（审批记录）

---

### 4.5 P1：恢复机制偏进程内语义，故障恢复风险高

#### 问题描述

- 人工节点使用内存 channel 阻塞等待。
- 打回重跑示例中出现 `context.Background()`，可能脱离 FlowRun 生命周期控制。

#### 影响

- 服务重启后待审节点丢失上下文。
- 无法保证取消/暂停信号一致传播。

#### 改进建议

- 引擎改为“持久化驱动状态机”而非“内存阻塞驱动”。
- 人工节点等待态完全落库，恢复后可继续。
- 严禁在执行路径中使用游离上下文；统一继承 FlowRun 根 `ctx`。

---

### 4.6 P1：幂等性与外部副作用控制不充分

#### 问题描述

Git 分支、提交、PR、Webhook 回传等外部副作用尚未定义幂等键与去重策略。

#### 影响

- 重试可能产生重复分支/重复 PR。
- Webhook 重放可能重复推进状态。

#### 改进建议

- 全链路引入 `idempotency_key`：Flow、Node、Integration action 三级。
- 外部事件入站实现“去重窗口 + 幂等存储”。

---

### 4.7 P2：数据约束与一致性规则需补全

#### 问题描述

- `tasks.flow_run_id` 与 `flow_runs.task_id` 双向关联但业务语义不清。
- 缺少关键唯一约束与状态约束。

#### 影响

- 后续可能出现一 task 多活跃 flow、孤儿 node_run、状态穿透。

#### 改进建议

- 明确定义关系：`Task 1:N FlowRun`（推荐）或 `1:1`。
- 添加数据库约束：
  - “同一 task 仅一个 active flow_run”部分唯一索引；
  - `node_runs(flow_run_id, node_id, attempt, scope_key)` 唯一约束；
  - 状态枚举用 `CHECK` 或 enum。

---

## 5. 面向 PRD / User Story 的目标能力蓝图

### 5.1 建议的最小可用流程（MVP+）

```yaml
name: requirement-to-prd-story
nodes:
  - id: collect_requirement
    type: human_input

  - id: normalize_requirement
    type: transform

  - id: draft_prd
    type: collab_task
    config:
      agents:
        - role: requirement-analyst
        - role: product-designer
      output_schema_ref: prd.schema.v1

  - id: adjudicate_prd
    type: adjudicate
    config:
      policy: rubric_score
      rubric: prd_quality.v1
      min_score: 80

  - id: review_prd
    type: human_review
    on_reject:
      goto:
        node_id: draft_prd
        scope: current

  - id: decompose_story
    type: agent_task
    config:
      output_schema_ref: user_story.schema.v1

  - id: validate_story
    type: agent_task
    config:
      role: story-quality-gate

  - id: approve_story_pack
    type: human_review

  - id: create_execution_tasks
    type: integration
```

### 5.2 关键质量门禁（必须结构化）

- PRD 必填字段：背景、目标、范围、非目标、约束、验收标准、风险。
- User Story 必填字段：`As a / I want / So that`、AC、优先级、依赖、估算。
- 每个门禁输出评分与理由（可审计、可回放）。

---

## 6. 多 Agent 协同设计建议（单环节）

### 6.1 协同模式

1. **并行草拟 + 仲裁**（推荐默认）
   - 多个 Agent 基于同输入独立产出。
   - 仲裁节点按 Rubric 评分选择主版本。

2. **主执笔 + 审稿人**
   - 主 Agent 生成，审稿 Agent 给改进意见。
   - 可循环 1~2 轮后进入人工审批。

3. **辩论式协作**（高成本）
   - Agent A/B 提案互评，第三方裁判。
   - 适合高风险需求，不适合默认链路。

### 6.2 协作协议（建议新增）

- `shared_context_policy`：定义可见/可写字段。
- `conflict_resolution_policy`：定义冲突处理。
- `attribution`：记录每段产出来源 Agent，支持追责与回放。

---

## 7. 数据模型改进建议

### 7.1 新增表（建议）

```sql
CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL,
  task_id UUID,
  flow_run_id UUID,
  artifact_type VARCHAR(30) NOT NULL, -- requirement/prd/user_story/test_plan
  current_version_id UUID,
  status VARCHAR(20) NOT NULL,         -- draft/reviewing/approved/rejected/archived
  created_by VARCHAR(100) NOT NULL,    -- user:{id} / agent:{id}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE artifact_versions (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  content JSONB NOT NULL,
  schema_version VARCHAR(50) NOT NULL,
  quality_score INTEGER,
  quality_report JSONB,
  source_node_run_id UUID,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(artifact_id, version_no)
);

CREATE TABLE artifact_links (
  id UUID PRIMARY KEY,
  from_artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  to_artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  link_type VARCHAR(30) NOT NULL,      -- derives_from/splits_to/implements/verifies
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE artifact_reviews (
  id UUID PRIMARY KEY,
  artifact_version_id UUID NOT NULL REFERENCES artifact_versions(id) ON DELETE CASCADE,
  reviewer_type VARCHAR(10) NOT NULL,  -- human/agent
  reviewer_id VARCHAR(100) NOT NULL,
  action VARCHAR(20) NOT NULL,         -- approve/reject/request_changes
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.2 现有表补充字段

- `node_runs`：补 `scope_key`、`iteration_key`、`idempotency_key`。
- `flow_runs`：补 `resume_token`、`recovery_checkpoint`。
- `timeline_events`：补 `event_idempotency_key`。

---

## 8. API 与事件模型改进建议

### 8.1 REST API 建议新增

- `POST /api/tasks/:id/generate-prd`
- `POST /api/tasks/:id/generate-user-stories`
- `GET /api/tasks/:id/artifacts`
- `GET /api/artifacts/:id`
- `POST /api/artifacts/:id/review`
- `POST /api/flow-runs/:id/replay`（从检查点重放）

### 8.2 WebSocket 事件建议新增

- `artifact.created`
- `artifact.versioned`
- `artifact.reviewed`
- `node.retried`
- `flow.checkpointed`

### 8.3 gRPC 建议新增

- `ValidateNodeOutput(schema_ref, payload)`
- `ResumeFromCheckpoint(flow_run_id, checkpoint_id)`
- `AdjudicateOutputs(node_run_ids, policy)`

---

## 9. 执行器与调度器改进建议

### 9.1 执行器

- 引入“持久化 Job Loop”模型：
  - DB 中 `queued/running/waiting` 驱动调度；
  - Worker 无状态可重启；
  - 人工等待节点不占用执行协程。

### 9.2 调度器

- 除 `RoundRobin/LeastBusy` 外增加：
  - `CostAware`（成本预算）
  - `LatencyAware`（时延 SLA）
  - `QualityAware`（按历史质量分配）

### 9.3 稳定性

- 并发节点加租约与心跳（防重复执行）。
- Integration 节点使用 Outbox 模式发送外部副作用。
- 所有重试策略按节点类型可配置（指数退避 + 抖动）。

---

## 10. 安全与治理补充建议

- Agent 运行沙箱权限最小化（目录白名单、命令白名单、网络策略）。
- 敏感数据分级：密钥、需求附件、产物内容分层加密与审计访问。
- 审计日志标准化：谁在何时批准了哪个版本的 PRD/Story。
- Prompt 注入防护：外部输入先规范化再拼接模板。

---

## 11. 分阶段落地建议（可执行）

### Phase A（1~2 周，P0 收敛）

- 统一 `parallel_group` 执行语义与 DSL 校验规则。
- 完成 foreach 作用域、`goto` 定位规则。
- 修正执行上下文传递与恢复逻辑（去除游离上下文）。

### Phase B（2~3 周，PRD/Story 核心闭环）

- 增加 `artifacts*` 四张核心表与基础 API。
- 引入 PRD/Story schema 与质量门禁节点。
- 打通需求→PRD→Story→Task 的可追溯链路。

### Phase C（2~4 周，多 Agent 协同）

- 增加 `collab_task/aggregate/adjudicate` 节点。
- 实现默认协同策略（并行草拟 + Rubric 仲裁 + 人审）。
- 增加协同过程可视化（来源、冲突、最终裁决）。

### Phase D（持续，生产稳定性）

- 幂等、Outbox、回放、检查点恢复。
- 预算/成本/质量可观测报表。

---

## 12. 验收标准（建议）

### 12.1 PRD / Story 编排验收

- 输入 1 条需求，系统可自动输出：
  - 1 份结构化 PRD（含质量评分）
  - N 条结构化 User Story（含 AC、依赖）
- 任意评审拒绝后可定向回退并保留版本历史。
- 全链路可追溯：需求文本 → PRD vX → Story vY → Task/PR。

### 12.2 多 Agent 协同验收

- 单环节至少 2 个 Agent 协同产出并可仲裁。
- 仲裁结果可解释（评分与理由可查）。
- Agent 任意失败时可降级到备用策略或人工接管。

### 12.3 稳定性验收

- 服务重启后，`waiting_human` 节点可恢复。
- Integration 重试不产生重复 PR。
- 同一 Task 不会出现多个活跃主流程（按业务定义）。

---

## 13. 风险与未决问题

### 13.1 主要风险

- 协同策略过重导致成本和延迟失控。
- 过度依赖自由文本输出，结构化质量不稳。
- 外部 Git 平台限流与 Webhook 乱序带来一致性挑战。

### 13.2 需尽快拍板的问题

1. Task 与 FlowRun 的关系是 `1:1` 还是 `1:N`？
2. PRD/Story 的“最终真相源”在数据库还是 Git 仓库？
3. 多 Agent 协同默认策略是“并行草拟 + 仲裁”还是“主写 + 审稿”？
4. 质量门禁阈值（如 PRD 最低评分）如何按项目配置？

---

## 14. 本次审核结论

当前方案方向正确，架构基础扎实，具备较强扩展潜力。建议按本报告优先处理 P0/P1 项后，再推进 PRD/User Story 的规模化自动化生产。若按建议实施，系统可从“可演示”提升到“可稳定运营”的多 Agent 编排平台。

