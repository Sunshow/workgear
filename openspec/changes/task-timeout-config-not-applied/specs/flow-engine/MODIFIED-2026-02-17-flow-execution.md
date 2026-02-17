# Workflow DSL Timeout Parsing — Delta Spec (MODIFIED)

> Change: task-timeout-config-not-applied
> Date: 2026-02-17
> Type: MODIFIED — 修改流程引擎对 DSL timeout 字段的解析和传递行为

---

## Scenario: node_handlers 解析 NodeDef.Timeout 并传递到 AgentRequest

### Given
- DSL 节点定义包含 `timeout` 字段（NodeDef 级别）
- 示例 DSL：
  ```yaml
  nodes:
    - id: complex-task
      type: agent_task
      timeout: "30m"
      agent:
        role: developer
  ```

### When
- executeAgentTask() 从 DAG 获取 nodeDef
- nodeDef.Timeout 值为 `"30m"`

### Then
- 使用 `time.ParseDuration("30m")` 解析为 `30 * time.Minute`
- 设置 `agentReq.Timeout = 30 * time.Minute`
- 日志记录解析结果：`"Parsed task timeout from DSL", "timeout", "30m"`

---

## Scenario: NodeDef.Timeout 优先于 NodeConfigDef.Timeout

### Given
- DSL 节点同时在两个层级配置了 timeout：
  ```yaml
  nodes:
    - id: task-1
      type: agent_task
      timeout: "30m"
      config:
        timeout: "15m"
  ```

### When
- executeAgentTask() 解析 timeout

### Then
- 优先使用 NodeDef.Timeout（`"30m"`）
- NodeConfigDef.Timeout（`"15m"`）被忽略
- AgentRequest.Timeout 设置为 30 分钟

---

## Scenario: 仅配置 NodeConfigDef.Timeout 时正确解析

### Given
- DSL 节点仅在 config 层级配置 timeout：
  ```yaml
  nodes:
    - id: task-2
      type: agent_task
      config:
        timeout: "45m"
        mode: execute
  ```

### When
- executeAgentTask() 解析 timeout
- nodeDef.Timeout 为空字符串

### Then
- 回退到 nodeDef.Config.Timeout（`"45m"`）
- 使用 `time.ParseDuration("45m")` 解析
- AgentRequest.Timeout 设置为 45 分钟

---

## Scenario: 支持 Go 标准 duration 格式

### Given
- DSL timeout 字段支持以下格式：
  - `"10m"` — 10 分钟
  - `"1h"` — 1 小时
  - `"1h30m"` — 1 小时 30 分钟
  - `"90s"` — 90 秒
  - `"2h45m30s"` — 2 小时 45 分 30 秒

### When
- executeAgentTask() 使用 `time.ParseDuration()` 解析

### Then
- 所有 Go 标准 duration 格式均可正确解析
- 解析结果作为 `time.Duration` 传递到 AgentRequest.Timeout
