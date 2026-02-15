# Agent 配置系统架构文档

> **日期**: 2026-02-15
> **状态**: 已实施
> **前置条件**: Phase 4（Docker Agent 调用）已完成

---

## 1. 概述

Agent 配置系统将原先硬编码在环境变量中的 Agent 凭证和模型配置，迁移到数据库存储 + 前端界面管理，支持多 Agent 类型、多 Provider、多 Model 的灵活组合。

### 1.1 核心架构

```
Agent 类型（系统固化，代码硬编码）
  └─ Provider（用户自定义，每个 Agent 类型独立配置）
       └─ Model（用户手动输入，支持设置默认）

Role 映射：role → agent_type + provider + model
```

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| Agent 类型系统固化 | claude-code / codex / droid 在代码中硬编码，不可动态添加 |
| Provider 用户自定义 | 每个 Agent 类型下可添加多个 Provider（不同 API 端点、不同凭证） |
| Provider 按类型隔离 | 同一厂商的 API Key 在不同 Agent 类型下需分别配置 |
| Model 用户手动输入 | 不预设 Model 列表，由用户自行填写 |
| Role 映射链自动解析 | Workflow 节点只指定 role，系统自动解析到具体的 Provider + Model |

---

## 2. Agent 类型定义

系统固化在代码中，定义每种 Agent 类型的 Provider 配置表单字段：

```typescript
// packages/api/src/agent-types.ts

export const AGENT_TYPES = {
  'claude-code': {
    name: 'ClaudeCode',
    description: 'Anthropic Claude Code CLI 工具',
    providerFields: [
      { key: 'base_url', label: 'Base URL', type: 'string', required: true },
      { key: 'auth_token', label: 'Auth Token', type: 'secret', required: true },
    ],
  },
  'codex': {
    name: 'Codex',
    description: 'OpenAI Codex CLI 工具',
    providerFields: [
      { key: 'base_url', label: 'Base URL', type: 'string', required: true },
      { key: 'api_key', label: 'API Key', type: 'secret', required: true },
    ],
  },
  'droid': {
    name: 'Droid',
    description: 'Droid Agent',
    providerFields: [
      { key: 'provider_type', label: 'LLM Provider', type: 'select', required: true, options: ['anthropic', 'openai'] },
      { key: 'base_url', label: 'Base URL', type: 'string', required: true },
      { key: 'api_key', label: 'API Key', type: 'secret', required: true },
    ],
  },
}
```

不同 Agent 类型的 Provider 配置字段不同：

| Agent 类型 | Provider 配置字段 | 说明 |
|-----------|------------------|------|
| claude-code | base_url + auth_token | ClaudeCode CLI 只需 API 端点和认证 Token |
| codex | base_url + api_key | Codex CLI 使用 OpenAI 风格的 API Key |
| droid | provider_type + base_url + api_key | Droid 需要额外指定底层 LLM 类型（anthropic/openai） |

---

## 3. 数据库设计

### 3.1 表结构

```
agent_providers          agent_models              agent_roles
┌──────────────┐        ┌──────────────┐          ┌──────────────┐
│ id           │◄──┐    │ id           │◄────┐    │ id           │
│ agent_type   │   │    │ provider_id  │──┐  │    │ slug         │
│ name         │   │    │ model_name   │  │  │    │ agent_type   │
│ config (jsonb)│   │    │ display_name │  │  │    │ provider_id  │──→ agent_providers
│ is_default   │   │    │ is_default   │  │  │    │ model_id     │──→ agent_models
│ created_at   │   │    │ created_at   │  │  │    │ system_prompt│
│ updated_at   │   │    └──────────────┘  │  │    │ is_builtin   │
└──────────────┘   └──────────────────────┘  │    └──────────────┘
                                             │
                                             └─── ON DELETE cascade
```

### 3.2 agent_providers

存储用户配置的 Provider 实例。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| agent_type | varchar(50) | Agent 类型：claude-code / codex / droid |
| name | varchar(100) | 用户自定义名称，如"Anthropic 官方"、"代理 A" |
| config | jsonb | 配置内容，字段由 Agent 类型的 providerFields 决定 |
| is_default | boolean | 是否为该 agent_type 的默认 Provider |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

唯一约束：`(agent_type, name)`

config 示例：

```json
// claude-code
{ "base_url": "https://api.anthropic.com", "auth_token": "sk-ant-xxx" }

// droid
{ "provider_type": "anthropic", "base_url": "https://api.anthropic.com", "api_key": "sk-ant-xxx" }
```

### 3.3 agent_models

存储每个 Provider 下的可用 Model。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| provider_id | uuid | 所属 Provider（级联删除） |
| model_name | varchar(100) | 模型标识，如 claude-sonnet-4 |
| display_name | varchar(200) | 可选的显示名称 |
| is_default | boolean | 是否为该 Provider 的默认 Model |
| created_at | timestamptz | 创建时间 |

唯一约束：`(provider_id, model_name)`

### 3.4 agent_roles（扩展）

在原有基础上移除 `default_model` 列，新增 `provider_id` 和 `model_id` 外键。

| 字段 | 类型 | 说明 |
|------|------|------|
| provider_id | uuid (nullable) | 指定 Provider，null 表示使用该 agent_type 的默认 Provider |
| model_id | uuid (nullable) | 指定 Model，null 表示使用该 Provider 的默认 Model |

---

## 4. 配置解析链路

Workflow 节点执行时，按以下链路解析到具体的 Provider 和 Model：

```
Workflow DSL 节点
  │ role: "general-developer"
  ▼
agent_roles 表查询
  │ agent_type: "claude-code"
  │ provider_id: "uuid-1" (或 null)
  │ model_id: "uuid-3" (或 null)
  ▼
解析 Provider
  ├─ provider_id 非空 → 直接使用
  └─ provider_id 为空 → 查询该 agent_type 的默认 Provider
  ▼
解析 Model
  ├─ model_id 非空 → 直接使用
  └─ model_id 为空 → 查询该 Provider 的默认 Model
  ▼
Orchestrator 构建 AgentRequest
  │ 注入 base_url + auth_token + model 到 Docker 容器环境变量
  ▼
Docker 容器执行 Agent
```

优先级总结：

| 层级 | Model 优先级 |
|------|-------------|
| 1 (最高) | DSL 节点显式指定 `agent.model` |
| 2 | Role 映射的 model_id |
| 3 | Provider 的默认 Model |
| 4 (最低) | Adapter 实例的默认 Model |

---

## 5. API 接口

### 5.1 Agent 类型（只读）

```
GET /api/agent-types
```

返回系统固化的 Agent 类型定义，含 providerFields schema。

### 5.2 Provider CRUD

```
GET    /api/agent-providers?agent_type=claude-code   # 列表（按类型过滤）
POST   /api/agent-providers                          # 创建
PUT    /api/agent-providers/:id                      # 更新
DELETE /api/agent-providers/:id                      # 删除（级联删除 Models）
PUT    /api/agent-providers/:id/default              # 设为默认
```

安全特性：
- GET 返回时对 `type: 'secret'` 字段自动脱敏（`sk-ant-***xxx`）
- PUT 更新时，如果 secret 字段值包含 `***`，保留数据库中的旧值

### 5.3 Model CRUD

```
GET    /api/agent-providers/:providerId/models       # 列表
POST   /api/agent-providers/:providerId/models       # 添加
DELETE /api/agent-models/:id                         # 删除
PUT    /api/agent-models/:id/default                 # 设为默认
```

### 5.4 Role 配置

```
GET /api/agent-roles                                 # 列表（含 providerName, modelName）
PUT /api/agent-roles/:id                             # 更新（含 providerId, modelId）
```

---

## 6. 前端界面

### 6.1 Agent 配置页面 `/settings/agents`

```
┌─────────────────────────────────────────────────────┐
│  Agent 配置                                          │
│                                                     │
│  [ClaudeCode] [Codex] [Droid]  ← Tab 切换           │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  Provider 列表                    [+ 添加 Provider]  │
│  ┌─────────────────────────────────────────────┐    │
│  │ ★ Anthropic 官方                [编辑][删除] │    │
│  │   Base URL: https://api.anthropic.com       │    │
│  │   Auth Token: sk-ant-***xxx                 │    │
│  │                                             │    │
│  │   Models:                    [+ 添加 Model] │    │
│  │   ● claude-sonnet-4 (默认)                  │    │
│  │   ○ claude-opus-4                           │    │
│  │   ○ claude-haiku-4                          │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │   代理 A                  [设为默认][编辑][删除]│    │
│  │   Base URL: https://proxy-a.example.com     │    │
│  │   Auth Token: tok-***yyy                    │    │
│  │                                             │    │
│  │   Models:                    [+ 添加 Model] │    │
│  │   ● claude-sonnet-4 (默认)                  │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

- 添加 Provider 时，表单根据 Agent 类型的 `providerFields` 动态生成
- Secret 字段使用 password input，显示时脱敏
- Model 由用户手动输入 model name

### 6.2 Agent 角色页面 `/settings/agent-roles`

每个 Role 支持三级联动选择：Agent 类型 → Provider → Model

- 切换 Agent 类型时自动重置 Provider 和 Model
- 切换 Provider 时自动重置 Model
- 选择"使用默认"表示使用该层级的默认配置

---

## 7. Orchestrator 加载逻辑

### 7.1 启动流程

```go
// 1. 从数据库加载所有 Provider
providers := dbClient.GetAllAgentProviders(ctx)

// 2. 为每个 Provider 创建 Adapter 实例
for _, p := range providers {
    switch p.AgentType {
    case "claude-code":
        adapter := NewClaudeCodeAdapter(promptBuilder, p.ID, baseURL, authToken, defaultModel)
        registry.RegisterProvider(p.ID, NewCombinedAdapter(adapter, dockerExec))
    }
}

// 3. 从数据库加载 Role 映射
roleConfigs := dbClient.GetAllAgentRoleConfigs(ctx)
for slug, rc := range roleConfigs {
    providerID, modelName := resolveProviderAndModel(rc)
    registry.MapRoleToProvider(slug, providerID, modelName)
}
```

### 7.2 Adapter 实例级配置

`ClaudeCodeAdapter` 不再从 `os.Getenv()` 读取凭证，改为构造时注入：

```go
type ClaudeCodeAdapter struct {
    providerID    string   // Provider ID
    baseURL       string   // 从 Provider config 加载
    authToken     string   // 从 Provider config 加载
    model         string   // 默认 Model
}
```

执行时将配置注入 Docker 容器环境变量：

```go
env["ANTHROPIC_BASE_URL"]  = a.baseURL
env["ANTHROPIC_AUTH_TOKEN"] = a.authToken
env["CLAUDE_MODEL"]         = req.Model
```

### 7.3 Registry 结构

```go
type Registry struct {
    adapters map[string]Adapter      // provider_id → adapter
    roles    map[string]*RoleMapping // role_slug → {provider_id, model_name}
}
```

查询链路：`role → RoleMapping → adapters[provider_id] → Adapter.Execute()`

### 7.4 环境变量兼容

数据库无 Provider 配置时，自动回退到环境变量：

```go
if len(providers) == 0 {
    if os.Getenv("ANTHROPIC_API_KEY") != "" {
        // 创建 env-fallback adapter
    }
}
```

---

## 8. 安全考虑

| 场景 | 处理方式 |
|------|---------|
| API Key 存储 | 明文存储在数据库 jsonb 字段中（后续可加密） |
| API Key 传输 | GET 接口自动脱敏，仅显示前 7 位 + 后 3 位 |
| API Key 更新 | PUT 时如果 secret 字段含 `***`，保留旧值不覆盖 |
| 容器注入 | 通过环境变量注入，容器销毁后消失 |
| 日志安全 | Orchestrator 日志不输出 API Key 内容 |

---

## 9. 扩展新 Agent 类型

接入新的 Agent 类型（如 Codex）只需：

1. 在 `AGENT_TYPES` 中添加类型定义（providerFields）
2. 在 Orchestrator 中实现对应的 `TypeAdapter`（如 `CodexAdapter`）
3. 在 `main.go` 的 switch 中添加 `case "codex"` 分支
4. 前端自动根据 providerFields 生成配置表单，无需额外开发

---

## 10. 文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/api/src/db/schema.ts` | 修改 | 新增 agent_providers、agent_models 表，扩展 agent_roles |
| `packages/api/src/agent-types.ts` | 新增 | Agent 类型定义 + 脱敏工具函数 |
| `packages/api/src/routes/agent-types.ts` | 新增 | Agent 类型只读接口 |
| `packages/api/src/routes/agent-providers.ts` | 新增 | Provider + Model CRUD 接口 |
| `packages/api/src/routes/agent-roles.ts` | 修改 | 支持 provider_id / model_id |
| `packages/api/src/server.ts` | 修改 | 注册新路由 |
| `packages/web/src/lib/types.ts` | 修改 | 新增 Provider / Model 类型定义 |
| `packages/web/src/pages/settings/agents.tsx` | 新增 | Agent 配置管理页面 |
| `packages/web/src/pages/settings/agent-roles.tsx` | 修改 | 三级联动选择器 |
| `packages/web/src/App.tsx` | 修改 | 新增路由 |
| `packages/web/src/components/layout/sidebar.tsx` | 修改 | 新增导航项 |
| `packages/orchestrator/internal/db/models.go` | 修改 | 新增 AgentProvider / AgentModel 模型 |
| `packages/orchestrator/internal/db/queries.go` | 修改 | 新增 Provider / Model 查询方法 |
| `packages/orchestrator/internal/agent/adapter.go` | 修改 | Registry 支持 Provider 级别注册 |
| `packages/orchestrator/internal/agent/claude_adapter.go` | 修改 | 实例级配置，不再读环境变量 |
| `packages/orchestrator/cmd/server/main.go` | 修改 | 从数据库加载配置 |
| `scripts/migrate-agent-config.sh` | 新增 | 环境变量 → 数据库迁移脚本 |
