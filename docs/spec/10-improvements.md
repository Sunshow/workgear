# 10. 改进方案汇总

本文档汇总了基于 [设计评审报告](../reviews/2026-02-11_0958_spec-design-review-and-improvement-report.md) 的所有改进措施。

## 改进总览

| 编号 | 优先级 | 问题 | 改进措施 | 涉及文件 | 状态 |
|------|--------|------|----------|----------|------|
| P0-1 | P0 | parallel_group 执行语义不一致 | 新增 execution_mode 字段 | 03, 06, 07, 09 | ✅ 已收口 |
| P0-2 | P0 | foreach 作用域与回退定位缺失 | Scope 模型 + goto 增强 | 03, 06, 09 | ✅ 已收口 |
| P0-3 | P0 | 缺少多 Agent 协同协议 | collab_task/adjudicate/aggregate 节点 | 03, 04, 06, 08, 09 | ✅ 已收口 |
| P1-1 | P1 | 缺少产物模型 | artifacts 四表 + API + 追溯链路 | 05, 06, 08 | ✅ 已收口 |
| P1-2 | P1 | 执行器恢复依赖内存 | 持久化状态机 + 租约 + 检查点 | 06, 08, 09 | ✅ 已收口 |
| P1-3 | P1 | 外部副作用无幂等保障 | Outbox 模式 + 三级幂等键 | 06, 07, 08, 09 | ✅ 已收口 |
| P2 | P2 | 数据约束不完整 | CHECK 约束 + 唯一索引 + 枚举 | 06 | ✅ 已收口 |

### 二次复审问题（第 2 轮）

| 编号 | 优先级 | 问题 | 改进措施 | 涉及文件 | 状态 |
|------|--------|------|----------|----------|------|
| R2-1 | P0 | goto 兼容规则与校验规则冲突 | 上下文感知默认推导 + 推导规则表 + 3 个示例 | 03 | ✅ 已收口 |
| R2-2 | P0 | 示例中跨作用域回退歧义 | 改为显式对象形式 + 强约束规则 | 03 | ✅ 已收口 |
| R2-3 | P1 | DAG 推进未体现实例级粒度 | NodeRunIdentifier 实例级依赖图 + 时序示意 | 09 | ✅ 已收口 |
| R2-4 | P1 | pipeline/serial 组内激活规则缺失 | 新增 advanceWithinGroup 独立函数 | 09 | ✅ 已收口 |
| R2-5 | P1 | 接口命名不一致 | TaskRequest 补 IdempotencyKey、统一 Select 方法名 | 04, 09 | ✅ 已收口 |
| R2-6 | P1 | WebSocket 频道命名不一致 | 统一为 flow-run:{id} | 09 | ✅ 已收口 |
| R2-7 | P2 | artifacts 外键缺失 + webhook TTL 不准确 | 补外键 + 改为定时清理策略 | 06 | ✅ 已收口 |

### 第三次审核问题（第 3 轮）

| 编号 | 优先级 | 问题 | 改进措施 | 涉及文件 | 状态 |
|------|--------|------|----------|----------|------|
| R3-1 | P0 | code_review_2 的 goto 仍为字符串 | 改为显式对象形式 | 03 | ✅ 已收口 |
| R3-2 | P1 | Registry/Scheduler 命名边界不清 | 统一 SelectAgent 对外 + Select 内部 | 04, 09 | ✅ 已收口 |
| R3-3 | P1 | 10-improvements 描述滞后 | 同步 goto 推导规则和 webhook 清理策略 | 10 | ✅ 已收口 |
| R3-4 | 新增 | 多类型 Agent 执行器支持 | Executor 分层 + Codex Adapter | 04, 09 | ✅ 已收口 |
| R3-5 | 新增 | 本地 Agent 支持边界 | execution_domain + 调度域隔离 + 安全边界 | 06, 08, 09, 11 | ✅ 已收口 |

### 第四次增量复审问题（第 4 轮）

| 编号 | 优先级 | 问题 | 改进措施 | 涉及文件 | 状态 |
|------|--------|------|----------|----------|------|
| R4-1 | P0 | FlowExecutor registry 字段重复 | 删除重复声明 | 09 | ✅ 已收口 |
| R4-2 | P0 | TaskRequest 缺 AgentRole 字段 | 补充 AgentRole 字段 | 04 | ✅ 已收口 |
| R4-3 | P1 | executeAgentTask 未传 role | SelectAgent 传入完整 TaskRequest | 09 | ✅ 已收口 |
| R4-4 | P1 | flow_runs 缺 execution_domain | 补充字段 + StartFlowRequest 补参数 | 06, 08 | ✅ 已收口 |
| R4-5 | P1 | agent_configs 默认值冲突 | runtime 改必填 + CHECK 约束 | 06 | ✅ 已收口 |
| R4-6 | P2 | Codex endpoint 重复 /execute | 规范 endpoint 只配基址 | 04 | ✅ 已收口 |
| R4-7 | P1 | StartFlow 未落入 execution_domain | 赋值 + 默认推导逻辑 | 09 | ✅ 已收口 |
| R4-8 | P1 | SelectAgent 调用缺 AgentRole | Rubric 评分器 + aggregate custom 补传 | 09 | ✅ 已收口 |

---

## P0-1: parallel_group 执行语义统一

**问题**：children 之间存在数据依赖（如 create_plan → review_plan），但 parallel_group 语义暗示并发执行，存在矛盾。

**改进**：
- `parallel_group` 新增 `execution_mode` 字段：
  - `parallel`：children 全部并发（children 之间无依赖时使用）
  - `pipeline`：children 按定义顺序串行，foreach 不同迭代之间并发（默认）
  - `serial`：children 串行，foreach 不同迭代也串行
- DSL 校验器检测 children 间数据依赖与 execution_mode 的一致性

**变更文件**：`03-flow-engine.md` §3.1 DSL 示例、§3.2 节点类型、§3.7 校验规则；`09-implementation-details.md` §9.1.7

---

## P0-2: foreach 作用域与回退定位

**问题**：foreach 内部节点的 goto 回退缺乏作用域定位，无法区分"回到同一迭代"还是"回到父级"。

**改进**：
- 定义 Scope 模型：`NodeRunIdentifier = node_id + scope_key + iteration_key + attempt`
- `on_reject.goto` 增强为对象形式，支持 `scope: current_iteration | parent_scope | global`
- 上下文感知默认推导：foreach 内默认 `current_iteration`，foreach 外默认 `global`
- 跨作用域回退必须使用对象形式显式指定 scope
- `node_runs` 表补充 `scope_key`、`iteration_key`、`idempotency_key` 字段
- 新增唯一约束 `(flow_run_id, node_id, scope_key, iteration_key, attempt)`

**变更文件**：`03-flow-engine.md` §3.4 打回机制、§3.4.1 Scope 模型；`06-data-model.md` node_runs 表；`09-implementation-details.md` §9.1.6

---

## P0-3: 多 Agent 协同协议

**问题**：单步骤只能分配一个 Agent，无法支持多 Agent 协同决策（如多人起草 PRD 后仲裁选优）。

**改进**：
- 新增三种节点类型：
  - `collab_task`：多 Agent 协同任务（parallel_draft / lead_review / debate）
  - `adjudicate`：仲裁节点（rubric_score / majority_vote / weighted_vote / reviewer_decides）
  - `aggregate`：聚合节点（concat / merge_by_key / custom）
- 定义 Rubric 质量评估框架
- 新增 `node_run_attributions` 表记录产出归属
- Agent 层新增协同协议（SharedContextPolicy、Attribution、ConflictResolutionPolicy）

**变更文件**：`03-flow-engine.md` §3.2、§3.6；`04-agent-layer.md` §4.7；`06-data-model.md` node_run_attributions 表；`08-api-design.md` gRPC；`09-implementation-details.md` §9.2

---

## P1-1: 产物模型（Artifact）

**问题**：PRD、User Story 等关键产出物不是一等实体，无法版本管理和追溯。

**改进**：
- 新增四张表：`artifacts`、`artifact_versions`、`artifact_links`、`artifact_reviews`
- 支持产物类型：requirement / prd / user_story / tech_spec / test_plan / review_report / acceptance_report
- 引用关系类型：derives_from / splits_to / implements / verifies / supersedes
- 流程引擎集成：节点配置 `artifact` 后自动创建/更新 Artifact
- 前端集成：Task 详情新增"产物"标签页，追溯链路可视化

**变更文件**：`05-board-flow-integration.md` §5.4、§5.7；`06-data-model.md` 产物模型；`08-api-design.md` 产物 API

---

## P1-2: 持久化状态机

**问题**：执行器使用内存 channel 等待人工操作，服务重启后状态丢失。

**改进**：
- 引擎改为"DB 队列 + 无状态 Worker"模型
- 人工等待节点落库即返回（`StatusWaitingHuman`），不阻塞 Worker 协程
- 人工操作通过 API 触发 resume，调用 `advanceDAG` 推进
- `flow_runs` 表补充 `resume_token`、`recovery_checkpoint`
- `node_runs` 表补充租约字段 `locked_by`、`locked_at`、`lock_expires_at`
- 引擎启动时扫描未完成的 NodeRun，自动恢复执行

**变更文件**：`06-data-model.md` flow_runs/node_runs 表；`08-api-design.md` 恢复 API + gRPC；`09-implementation-details.md` §9.1 全部重写

---

## P1-3: 外部副作用幂等性

**问题**：Git 操作、Webhook 调用等外部副作用无幂等保障，重试可能导致重复操作。

**改进**：
- 引入 Outbox 模式：外部副作用先写入 `outbox_events` 表，再由异步 Worker 执行
- 三级幂等键：FlowRun 级 / NodeRun 级 / Integration 级
- Webhook 入站去重：`webhook_dedup` 表（delivery_id + 定时清理策略）
- 所有重试策略按节点类型可配置（指数退避 + 抖动）

**变更文件**：`06-data-model.md` outbox_events/webhook_dedup 表；`07-roadmap.md` Phase 2/3；`09-implementation-details.md` §9.3

---

## P2: 数据约束完善

**问题**：表定义缺少 CHECK 约束、状态枚举、唯一索引。

**改进**：
- `flow_runs.status` 添加 CHECK 约束（6 种状态）
- `node_runs.status` 添加 CHECK 约束（8 种状态）
- `node_runs.node_type` 添加 CHECK 约束（12 种类型）
- 新增部分唯一索引 `idx_task_active_flow`（同一 Task 只允许一个 active FlowRun）
- 新增唯一索引 `idx_node_runs_identity`（防止重复 NodeRun）
- `tasks` 表移除 `flow_run_id`（改为通过 `flow_runs.task_id` 单向查询）

**变更文件**：`06-data-model.md` 全部表定义

---

## 路线图调整

在原有 Phase 1-4 之前插入三个前置阶段：

- **Phase A**（1-2 周）：P0 收敛 — 执行语义、作用域、上下文修正
- **Phase B**（2-3 周）：产物模型闭环 — 四表、Schema、质量门禁、前端集成
- **Phase C**（2-4 周）：多 Agent 协同 — collab_task、adjudicate、Rubric

详见 `07-roadmap.md`。
