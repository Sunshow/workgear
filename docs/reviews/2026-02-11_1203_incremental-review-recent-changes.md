# WorkGear 增量复审报告（最近变更）

- 复审时间：`2026-02-11 12:03`
- 复审范围：最近更新的 `docs/spec/03,04,06,08,09,10,11`
- 复审目标：确认二次复审后的最新调整是否完整收口，并识别新增不一致点

---

## 1. 结论摘要

本轮变更整体质量较高，关键方向与边界已经稳定：

- `goto` 推导与校验规则一致性显著提升；
- WebSocket 频道命名趋于统一；
- 数据模型补上 `artifacts.current_version_id` 外键；
- webhook 从“TTL 索引”改为“定时清理策略”描述；
- 新增“运行域隔离”并明确：**不支持 Web/SaaS 直调用户本地 Agent**。

但仍存在 6 个建议在进入实现前收口的问题（见第 3 节）。

---

## 2. 已确认收口项

## 2.1 `goto` 规则收口

- 字符串 `goto` 的上下文感知推导已明确：
  - foreach 内推导为 `current_iteration`
  - foreach 外推导为 `global`
- 规则与校验一致：
  - `docs/spec/03-flow-engine.md:378`
  - `docs/spec/03-flow-engine.md:735`

---

## 2.2 跨作用域回退显式化

- 示例中需要显式 scope 的场景已改为对象形式：
  - `docs/spec/03-flow-engine.md:212`
  - `docs/spec/03-flow-engine.md:456`

---

## 2.3 WebSocket 频道命名对齐

- API 与实现都采用 `flow-run:{id}`：
  - `docs/spec/08-api-design.md:116`
  - `docs/spec/09-implementation-details.md:835`

---

## 2.4 数据层细节修正

- 已补延迟外键：
  - `docs/spec/06-data-model.md:437`
- 已改为定时清理说明：
  - `docs/spec/06-data-model.md:505`

---

## 2.5 运行域隔离边界落地

- API 层约束：云端禁止 `runtime=local`：
  - `docs/spec/08-api-design.md:83`
- 安全文档明确边界：
  - `docs/spec/11-security.md:344`

---

## 3. 待收口问题（新增/遗留）

> 优先级说明：
> - P0：不修会导致实现直接冲突
> - P1：不修会导致实现偏差或运行风险
> - P2：维护成本或理解成本问题

## 3.1 P0：`FlowExecutor` 结构体字段重复

### 现象

- `registry` 字段重复声明两次：
  - `docs/spec/09-implementation-details.md:18`
  - `docs/spec/09-implementation-details.md:19`

### 风险

- 实现代码直接编译冲突。

### 建议

- 删除重复字段，保留单个 `registry   *AgentRegistry`。

---

## 3.2 P0：`TaskRequest` 缺字段但调度逻辑在使用

### 现象

- `TaskRequest` 当前无 `AgentRole` 字段：
  - `docs/spec/04-agent-layer.md:33`
- 运行域过滤示例使用了 `req.AgentRole`：
  - `docs/spec/09-implementation-details.md:939`

### 风险

- 接口契约不一致，落地时会出现编译或行为偏差。

### 建议

- 在 `TaskRequest` 增加 `AgentRole string`，并在构建请求时传入解析后的角色值。

---

## 3.3 P1：`executeAgentTask` 角色解析结果未传入选择器

### 现象

- 代码先解析 `role`：
  - `docs/spec/09-implementation-details.md:131`
- 但调用 `SelectAgent` 时未把 `role` 写入请求：
  - `docs/spec/09-implementation-details.md:134`

### 风险

- 调度可能忽略节点目标角色，选错 Agent。

### 建议

- `SelectAgent` 调用改为传入完整请求：`TaskRequest{Mode, AgentRole, FlowRunID, ...}`。

---

## 3.4 P1：运行域过滤依赖字段未在 FlowRun 契约中定义

### 现象

- 调度逻辑依赖 `flowRun.ExecutionDomain`：
  - `docs/spec/09-implementation-details.md:943`
- 但 `flow_runs` 表与 `StartFlowRequest` 未见对应字段：
  - `docs/spec/06-data-model.md:83`
  - `docs/spec/08-api-design.md:171`

### 风险

- 运行域过滤无法真正落地，边界约束变成“文档声明但无数据支撑”。

### 建议

- 补充 `flow_runs.execution_domain`（建议 `cloud|local`）
- 在 `StartFlowRequest` 加 `execution_domain`
- 写明默认推导规则（Web 触发默认 `cloud`，桌面端默认 `local`）

---

## 3.5 P1：`agent_configs` 默认值组合存在语义冲突风险

### 现象

- 默认 `runtime=local`：`docs/spec/06-data-model.md:270`
- 默认 `execution_domain=cloud`：`docs/spec/06-data-model.md:271`

### 风险

- 新建配置若未显式赋值，默认组合可能违反“云端禁止 local runtime”约束。

### 建议

- 统一默认：
  - 若系统偏云端，建议默认 `runtime=remote` + `execution_domain=cloud`
  - 或将 `runtime` 设为必填，避免冲突默认值
- 增加校验规则：`execution_domain=cloud` 时 `runtime!=local`

---

## 3.6 P2：Codex HTTP endpoint 组装可能重复 `/execute`

### 现象

- 组装逻辑：`endpoint + "/execute"`
  - `docs/spec/04-agent-layer.md:394`
- 配置示例 endpoint 已写 `/execute`
  - `docs/spec/04-agent-layer.md:425`

### 风险

- 最终 URL 可能变为 `/execute/execute`。

### 建议

- 二选一并固化规范：
  1. `endpoint` 只配基址，代码追加 `/execute`；
  2. `endpoint` 配完整路径，代码不再追加。

---

## 4. 针对“多类型 Agent + 不支持 Web/SaaS 调本地 Agent”的复核结论

### 4.1 支持性结论

当前规格已能支持：

- 多类型 Agent（如 ClaudeCode/Codex）
- 多执行器（CLI/HTTP/gRPC）
- 统一调度与能力抽象

关键依据：

- `docs/spec/04-agent-layer.md:11`
- `docs/spec/04-agent-layer.md:360`
- `docs/spec/09-implementation-details.md:933`

### 4.2 边界结论

“不支持 Web/SaaS 直调用户本地 Agent”已在 API 与安全层明确，方向正确。

关键依据：

- `docs/spec/08-api-design.md:83`
- `docs/spec/11-security.md:344`

但要真正落地该边界，仍需补上第 3.4 的 `flow_runs.execution_domain` 数据契约。

---

## 5. 建议的收口顺序（执行级）

1. **先修 P0**：3.1 / 3.2
2. **再修 P1**：3.3 / 3.4 / 3.5
3. **最后修 P2**：3.6

完成后可进入“实现冻结评审”。

---

## 6. 本轮结论

本轮最近变更整体通过，架构方向与安全边界基本稳定；建议按本报告 6 项问题做最后收口，再进入开发阶段。

