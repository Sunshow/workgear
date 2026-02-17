# Agent Orchestration — Delta Spec (MODIFIED)

> Change: task-timeout-config-not-applied
> Date: 2026-02-17
> Type: MODIFIED — 修改 Agent 适配器层的超时处理行为

---

## Scenario: AgentRequest 携带 timeout 配置传递到适配器

### Given
- AgentRequest 结构体包含 `Timeout time.Duration` 字段
- node_handlers.go 从 DSL NodeDef 解析 timeout 并设置到 AgentRequest.Timeout
- 超时优先级：NodeDef.Timeout > NodeConfigDef.Timeout > 默认值 (10m)

### When
- TypeAdapter.BuildRequest() 构建 ExecutorRequest

### Then
- 如果 req.Timeout > 0，使用 req.Timeout 作为 ExecutorRequest.Timeout
- 如果 req.Timeout == 0（未配置），回退到 10 * time.Minute 默认值
- ClaudeCodeAdapter、DroidAdapter、CodexAdapter 行为一致

---

## Scenario: DSL 配置 timeout 后 Agent 执行使用自定义超时

### Given
- Workflow DSL 节点配置 `timeout: "30m"`
- Agent 适配器已注册并可用
- Docker daemon 可用

### When
- Worker 执行该节点的 agent_task

### Then
- node_handlers.go 解析 `"30m"` 为 `30 * time.Minute`
- AgentRequest.Timeout 设置为 30 分钟
- 适配器 BuildRequest() 将 30 分钟传递到 ExecutorRequest.Timeout
- DockerExecutor 使用 30 分钟作为容器执行超时
- 容器超过 30 分钟后被强制终止，返回超时错误

---

## Scenario: DSL 未配置 timeout 时使用默认值

### Given
- Workflow DSL 节点未配置 `timeout` 字段
- 或 `timeout` 字段为空字符串

### When
- Worker 执行该节点的 agent_task

### Then
- node_handlers.go 解析结果为零值 (0)
- AgentRequest.Timeout 为 0
- 适配器 BuildRequest() 检测到 Timeout == 0，回退到 10 * time.Minute
- 行为与修改前完全一致，保持向后兼容

---

## Scenario: DSL 配置无效 timeout 字符串时回退到默认值

### Given
- Workflow DSL 节点配置 `timeout: "invalid"` 或 `timeout: "abc"`
- time.ParseDuration() 无法解析该字符串

### When
- Worker 执行该节点的 agent_task

### Then
- node_handlers.go 解析失败，记录 warn 级别日志
- AgentRequest.Timeout 保持为 0（零值）
- 适配器回退到 10 * time.Minute 默认值
- 节点正常执行，不因配置错误而阻塞流程
