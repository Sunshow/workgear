# WorkGear 增量复审报告（最终待收口项）

- 复审时间：`2026-02-11 12:15`
- 复审范围：`docs/spec/04-agent-layer.md`、`docs/spec/08-api-design.md`、`docs/spec/09-implementation-details.md`
- 复审目标：确认当前规格中最后未收口项，支撑进入实现冻结

---

## 1. 结论摘要

当前规格已基本稳定，前序评审项大多已闭环。仍存在 **2 个实现一致性问题**，建议在开发前修复：

1. `execution_domain` 已进入 API 契约，但在启动流程实现示例中尚未写入 `FlowRun`。
2. 调度入口 `SelectAgent` 依赖 `AgentRole`，但两个调用点未显式传入角色。

---

## 2. 待收口问题清单

## 2.1 P1：`StartFlow` 未落入 `execution_domain`

### 现象

- gRPC `StartFlowRequest` 已定义 `execution_domain`：
  - `docs/spec/08-api-design.md:177`
- 但 `StartFlow` 创建 `flowRun` 时未赋值该字段：
  - `docs/spec/09-implementation-details.md:56`

### 风险

- 运行域隔离策略（cloud/local）在启动后可能失效或退化为默认值。
- 调度层 `SelectAgent` 的运行域过滤依据不稳定。

### 建议修复

在 `StartFlow` 构造 `flowRun` 时增加：

```go
ExecutionDomain: req.ExecutionDomain,
```

并补充默认策略说明（若空值）：
- Web/API 触发默认 `cloud`
- Desktop 触发默认 `local`

---

## 2.2 P1：`SelectAgent` 调用未完整传递 `AgentRole`

### 现象

- `TaskRequest` 已有 `AgentRole`：
  - `docs/spec/04-agent-layer.md:37`
- `SelectAgent` 内使用 `req.AgentRole` 取候选：
  - `docs/spec/09-implementation-details.md:942`
- 但以下调用未传角色：
  1. Rubric 评分器选择：`docs/spec/09-implementation-details.md:437`
  2. aggregate custom 选择：`docs/spec/09-implementation-details.md:498`

### 风险

- 候选池可能为空或选错实例，导致评分节点与自定义聚合节点行为不确定。

### 建议修复

1. Rubric 评分器调用传入：

```go
AgentRole: node.Config.Rubric.ScorerRole,
```

2. aggregate custom 调用传入：

```go
AgentRole: node.Config.Custom.AgentRole,
```

3. 若 `AgentRole` 为空，建议在 `SelectAgent` 早失败并返回明确错误。

---

## 3. 验收建议（收口后）

完成上述两项后，建议最小回归验证：

1. 启动 cloud/local 两类流程，检查 `flow_runs.execution_domain` 落库与调度过滤是否一致。
2. 运行 `adjudicate.rubric_score` 与 `aggregate.custom`，确认选中的 Agent 与配置角色一致。

---

## 4. 最终建议

建议将本报告两项修复纳入 `docs/spec/10-improvements.md` 的新增条目（例如 `R4-7`、`R4-8`），完成后可进入实现冻结评审。
