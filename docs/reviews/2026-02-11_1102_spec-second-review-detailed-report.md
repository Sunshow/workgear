# WorkGear 规格设计二次复审报告（详细版）

- 复审对象：`docs/spec/`
- 复审时间：`2026-02-11 11:02`
- 复审轮次：第 2 轮（基于首轮报告整改后）
- 复审目标：
  1. 验证首轮 P0/P1 问题是否被有效收敛；
  2. 识别整改后仍存在的设计冲突与实现风险；
  3. 给出可直接执行的收口建议。

---

## 1. 结论摘要

### 1.1 总体结论

本轮整改质量高，核心能力从“可演示”明显提升到“接近可实现落地”：

- “需求描述 → PRD → User Story”流程编排：**可行性已成立**。
- 多 Agent 协同单环节：已从“并发执行”升级为“协同 + 仲裁”模型，**能力闭环基本建立**。

但仍有若干跨文档一致性和推进算法层面的关键缺口，建议在进入工程实现前继续做一次“规范收口”。

### 1.2 评分（本轮主观评估）

- 架构完整性：`8.5/10`
- DSL 可表达性：`8.8/10`
- 多 Agent 协同设计：`8.4/10`
- 数据可追溯性：`8.6/10`
- 可实施一致性（文档→实现）：`7.4/10`

关键短板集中在“语义一致性 + 推进细则 + 接口对齐”。

---

## 2. 本轮已确认修复项（对首轮问题回归）

## 2.1 P0-1 并行语义冲突：已显著修复

### 证据

- `parallel_group` 增加 `execution_mode`：
  - `parallel | pipeline | serial`
  - 参考：`docs/spec/03-flow-engine.md:116`, `docs/spec/03-flow-engine.md:293`
- 增加 DSL 约束，明确 children 依赖与模式兼容关系：
  - 参考：`docs/spec/03-flow-engine.md:630`
- 实现细节新增对应执行逻辑：
  - 参考：`docs/spec/09-implementation-details.md:292`

### 评估

“说明层”和“执行层”已基本对齐，首轮最核心冲突得到处理。

---

## 2.2 P0-2 foreach 作用域与回退：已显著修复

### 证据

- `on_reject.goto` 增强为对象并支持 `scope`：
  - 参考：`docs/spec/03-flow-engine.md:352`, `docs/spec/03-flow-engine.md:355`
- NodeRun 标识模型新增 `scope_key/iteration_key/attempt`：
  - 参考：`docs/spec/03-flow-engine.md:381`
- 数据模型新增作用域字段与唯一约束：
  - 参考：`docs/spec/06-data-model.md:127`, `docs/spec/06-data-model.md:169`
- 执行器新增作用域感知回退实现：
  - 参考：`docs/spec/09-implementation-details.md:238`

### 评估

作用域语义已进入“可执行定义”阶段，属于高价值修复。

---

## 2.3 P0-3 多 Agent 协同协议：已建立框架闭环

### 证据

- 新增节点类型：`collab_task` / `adjudicate` / `aggregate`
  - 参考：`docs/spec/03-flow-engine.md:296`, `docs/spec/03-flow-engine.md:304`
- 新增协同协议：共享上下文、归属、冲突策略
  - 参考：`docs/spec/04-agent-layer.md:187`
- 新增协同执行细节（含 Rubric 仲裁）
  - 参考：`docs/spec/09-implementation-details.md:350`, `docs/spec/09-implementation-details.md:413`

### 评估

从“并行执行”升级为“协同决策”模型，满足你提出的“多 agent 协同单环节”方向。

---

## 2.4 P1-1 产物模型：已补齐核心结构

### 证据

- 新增 `artifacts / artifact_versions / artifact_links / artifact_reviews`
  - 参考：`docs/spec/06-data-model.md:333`
- 新增产物 API 与追溯链路 API
  - 参考：`docs/spec/08-api-design.md:82`
- 看板/任务视图加入产物展示与版本对比
  - 参考：`docs/spec/05-board-flow-integration.md:105`, `docs/spec/05-board-flow-integration.md:188`

### 评估

“需求→PRD→Story→Task”的数据可追溯闭环已成形。

---

## 2.5 P1-2 / P1-3 稳定性增强：方向正确

### 证据

- 持久化驱动状态机（无状态 Worker）
  - 参考：`docs/spec/09-implementation-details.md:5`, `docs/spec/09-implementation-details.md:22`
- 人工节点改为落库等待，不再内存阻塞
  - 参考：`docs/spec/09-implementation-details.md:184`
- Outbox + webhook 去重模型
  - 参考：`docs/spec/06-data-model.md:456`

### 评估

稳定性设计从“概念级”进入“工程可落地级”。

---

## 3. 仍需收口的问题（本轮发现）

> 分级说明：
> - P0：若不收口，容易出现错误执行或错误回退
> - P1：会降低实现一致性或带来不可预期行为
> - P2：主要影响维护成本与协作效率

## 3.1 P0：`goto` 兼容规则与校验规则存在冲突

### 现象

- 文档声明字符串 `goto: "node"` 等价于 `{node_id: node, scope: current_iteration}`。
  - 参考：`docs/spec/03-flow-engine.md:374`
- 同时校验规则声明“foreach 上下文外 `scope` 只能是 `global`”。
  - 参考：`docs/spec/03-flow-engine.md:650`

### 风险

- 同一 DSL 在“解析阶段”与“校验阶段”可能得出不同合法性结论。
- 容易导致历史流程模板升级后不可用。

### 建议动作

1. 统一语义：
   - 建议改为：
     - `foreach` 内默认 `current_iteration`；
     - `foreach` 外默认 `global`。
2. 将该默认推导写入 DSL 解析规范与校验规范同一节。
3. 增加 3 个示例（foreach 内/外、父作用域）防歧义。

---

## 3.2 P0：示例流程中仍存在跨作用域回退歧义

### 现象

- `testing` 节点的失败回退示例：`goto: execute_task`。
  - 参考：`docs/spec/03-flow-engine.md:231`

### 风险

- 当 `testing` 位于全局节点而 `execute_task` 位于 foreach 子作用域时，回退目标不唯一。
- 易导致“回到哪一个迭代”的行为不确定。

### 建议动作

1. 将所有示例中跨作用域回退改为对象形式：
   - `goto: { node_id: execute_task, scope: current_iteration }`（或明确 `global`/`parent_scope`）。
2. 在文档中增加“跨作用域回退必须显式 scope”的强约束。

---

## 3.3 P1：DAG 推进逻辑未完整体现作用域粒度

### 现象

- `advanceDAG` 中依赖判断表现为按 `node_id` 集合判断。
  - 参考：`docs/spec/09-implementation-details.md:569`, `docs/spec/09-implementation-details.md:575`
- 未显式体现 `(node_id, scope_key, iteration_key, attempt)` 粒度下的依赖完成判定。

### 风险

- foreach 场景会出现“某迭代完成误触发其它迭代推进”。
- pipeline/serial 下更容易出现状态穿透。

### 建议动作

1. 把推进判定改为“实例级依赖图”而非“模板节点级依赖图”。
2. 明确 `GetDependencies` 的返回对象是 NodeRun 实例标识，而不是纯 `node_id`。
3. 在实现文档补充一个“3 个迭代 + pipeline”状态推进时序示意。

---

## 3.4 P1：`pipeline/serial` 推进触发条件未给出闭环算法

### 现象

- 文档描述了初始排队策略（哪些 child 先 `QUEUED`），但未明确“子节点完成后谁负责把后继 child 置为 `QUEUED`”。
  - 参考：`docs/spec/09-implementation-details.md:307`

### 风险

- 可能出现 child1 完成后 child2 一直 `PENDING`。
- 或由通用 `advanceDAG` 误判提前推进。

### 建议动作

新增“组内推进器”规范：
1. pipeline：同 iteration 下 child[i] 完成时激活 child[i+1]。
2. serial：当 iteration 全部 children 完成后激活下一 iteration 的 child[0]。
3. 将该逻辑写为独立函数，避免与全局 DAG 推进耦合。

---

## 3.5 P1：接口定义与实现示例存在不一致

### 现象

- `TaskRequest` 定义中无 `IdempotencyKey`，实现示例使用了该字段。
  - 参考：`docs/spec/04-agent-layer.md:33`, `docs/spec/09-implementation-details.md:148`
- 调度器接口 `Select(...)` 与实现调用 `SelectAgent(...)` 命名不一致。
  - 参考：`docs/spec/04-agent-layer.md:172`, `docs/spec/09-implementation-details.md:133`

### 风险

- 开发按文档生成接口时会出现编译/对接偏差。

### 建议动作

1. 统一为一套接口签名（推荐以 `04-agent-layer.md` 为唯一源）。
2. 在 `09-implementation-details.md` 中标注“伪代码”或同步字段。

---

## 3.6 P1：WebSocket 频道命名前后不一致

### 现象

- API 文档示例使用 `flow-run:{id}`。
  - 参考：`docs/spec/08-api-design.md:110`
- 实现示例使用 `flow:{id}`。
  - 参考：`docs/spec/09-implementation-details.md:683`

### 风险

- 前后端订阅无法匹配，导致“有事件但 UI 无更新”。

### 建议动作

1. 统一频道规范（推荐统一为 `flow-run:{id}`）。
2. 增加兼容层（过渡期同时支持旧频道）。

---

## 3.7 P2：数据层仍有细节空洞

### 现象与风险

1. `artifacts.current_version_id` 未建立外键约束。
   - 参考：`docs/spec/06-data-model.md:348`
   - 风险：可能指向不存在版本。

2. `webhook_dedup` 使用“TTL 索引”表述不准确（PostgreSQL 不会自动按索引删除数据）。
   - 参考：`docs/spec/06-data-model.md:497`
   - 风险：积压导致表膨胀。

### 建议动作

1. 补充 `FOREIGN KEY (current_version_id) REFERENCES artifact_versions(id)`。
2. 将“TTL 索引”改为“清理任务 + 辅助索引”的表述。

---

## 4. 对核心业务目标的复核结论

## 4.1 需求描述→PRD→User Story 编排能力

### 结论

**可以支持，且已接近可落地。**

### 依据

- Schema + Rubric + artifact 版本链路已具备。
  - `docs/spec/schemas/prd.v1.json:1`
  - `docs/spec/schemas/user-story.v1.json:1`
  - `docs/spec/rubrics/prd-quality.v1.yaml:1`
  - `docs/spec/06-data-model.md:333`

### 前置条件

需先收口本报告第 3 节中的 P0/P1 项，特别是 `goto` 规则一致性与 DAG 推进粒度。

---

## 4.2 多 Agent 协同完成单环节能力

### 结论

**已具备设计层可行性。**

### 依据

- 协同模式（parallel_draft/lead_review/debate）明确。
  - `docs/spec/03-flow-engine.md:297`
- 仲裁策略与 fallback 机制明确。
  - `docs/spec/03-flow-engine.md:512`
- 归属追踪表已定义。
  - `docs/spec/06-data-model.md:433`

### 风险点

当前主要风险在“推进算法一致性”，而非协同能力本身。

---

## 5. 建议的最终收口清单（进入实现前）

### 5.1 必做（Gate）

1. 统一 `goto` 默认 scope 规则（解析/校验一致）。
2. 修正示例中的跨作用域回退写法为显式对象。
3. 明确 NodeRun 实例级 DAG 推进算法。
4. 补齐 pipeline/serial 组内激活规则。
5. 统一 `TaskRequest`、Scheduler、WS 频道命名。

### 5.2 应做（Hardening）

1. 补 `current_version_id` 外键。
2. 将 webhook “TTL”改为“定时清理策略”。
3. 在 `10-improvements.md` 增加“已收口/待收口”状态列。

---

## 6. 建议新增的文档修订（精确到文件）

1. `docs/spec/03-flow-engine.md`
   - 收口 `goto` 默认语义；
   - 修正跨作用域 `goto` 示例；
   - 在 3.7 增加“字符串 goto 在不同上下文的推导规则表”。

2. `docs/spec/09-implementation-details.md`
   - 在 `advanceDAG` 补充实例级依赖判定伪代码；
   - 增加 pipeline/serial 推进时序图；
   - 统一与 `04-agent-layer` 的接口字段命名。

3. `docs/spec/04-agent-layer.md`
   - 与实现示例字段对齐（`IdempotencyKey` 等）；
   - 明确 `Select` vs `SelectAgent` 统一名。

4. `docs/spec/08-api-design.md` + `docs/spec/09-implementation-details.md`
   - 统一 WS 频道命名；
   - 标注兼容策略与废弃时间线。

5. `docs/spec/06-data-model.md`
   - 补 `artifacts.current_version_id` 外键；
   - 调整 webhook 清理机制描述。

---

## 7. 最终复审意见

本次整改已经把方案从“架构概念正确”推进到“工程方案基本可落地”。建议按本报告第 5 节完成最后一轮收口后，再进入实现阶段（或 PoC 编码阶段）。

在收口完成前，不建议直接按当前文档启动多迭代 foreach + 打回的复杂流程开发，以避免后续返工。

