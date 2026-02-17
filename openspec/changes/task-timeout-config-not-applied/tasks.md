# Tasks: DSL Task Timeout 配置生效

## 模块：Agent 领域模型 (packages/orchestrator/internal/agent)

### AgentRequest 扩展

- [ ] 在 `adapter.go` 的 `AgentRequest` 结构体中新增 `Timeout time.Duration` 字段 **[S]**

## 模块：流程引擎 (packages/orchestrator/internal/engine)

### Timeout 解析与传递

- [ ] 在 `node_handlers.go` 的 `executeAgentTask()` 中，构建 `agentReq` 之前新增 timeout 解析逻辑 **[S]**
- [ ] 实现优先级：`nodeDef.Timeout` > `nodeDef.Config.Timeout` > 零值（由适配器决定默认值） **[S]**
- [ ] 使用 `time.ParseDuration()` 解析字符串，解析失败时记录 warn 日志并回退零值 **[S]**
- [ ] 将解析结果设置到 `agentReq.Timeout` 字段 **[S]**

## 模块：Agent 适配器 (packages/orchestrator/internal/agent)

### ClaudeCodeAdapter

- [ ] 修改 `claude_adapter.go` 的 `BuildRequest()` 方法，优先使用 `req.Timeout` **[S]**
- [ ] 当 `req.Timeout == 0` 时回退到 `10 * time.Minute` 默认值 **[S]**

### DroidAdapter

- [ ] 修改 `droid_adapter.go` 的 `BuildRequest()` 方法，优先使用 `req.Timeout` **[S]**
- [ ] 当 `req.Timeout == 0` 时回退到 `10 * time.Minute` 默认值 **[S]**

### CodexAdapter

- [ ] 修改 `codex_adapter.go` 的 `BuildRequest()` 方法，优先使用 `req.Timeout` **[S]**
- [ ] 当 `req.Timeout == 0` 时回退到 `10 * time.Minute` 默认值 **[S]**

## 测试验证

### 端到端验证

- [ ] DSL 配置 `timeout: "30m"` → 确认容器创建日志显示 timeout=30m **[S]**
- [ ] DSL 不配置 timeout → 确认仍使用 10 分钟默认值 **[S]**
- [ ] DSL 配置 `timeout: "invalid"` → 确认 warn 日志输出 + 回退 10 分钟 **[S]**
- [ ] DSL 同时配置 NodeDef.Timeout="30m" 和 Config.Timeout="15m" → 确认使用 30m **[S]**
- [ ] DSL 仅配置 Config.Timeout="45m" → 确认使用 45m **[S]**

## 模块：OpenSpec 文档

- [ ] 归档完成后更新 `openspec/specs/agent/2026-02-14-agent-orchestration.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/flow-engine/2026-02-14-flow-execution.md` **[S]**
