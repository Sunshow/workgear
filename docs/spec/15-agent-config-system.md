# Agent 配置系统架构文档

> **文档版本**: v2.0  
> **最后更新**: 2026-02-16  
> **状态**: 已实施并运行  
> **前置条件**: Phase 4（Docker Agent 调用）已完成

---

## 1. 概述

Agent 配置系统是 WorkGear 的核心基础设施，负责管理 AI Agent 的类型定义、Provider 配置、Model 选择和 Role 映射。系统将原先硬编码在环境变量中的 Agent 凭证和模型配置，迁移到数据库存储 + 前端界面管理，支持多 Agent 类型、多 Provider、多 Model 的灵活组合。

### 1.1 核心架构

```
Agent 类型（系统固化，代码硬编码）
  └─ Provider（用户自定义，每个 Agent 类型独立配置）
       └─ Model（用户手动输入，支持设置默认）
            └─ Role（映射到具体的 Agent 类型 + Provider + Model）

执行链路：Workflow DSL → Role → Provider + Model → Adapter → Executor → Docker Container
```

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| Agent 类型系统固化 | claude-code / codex / droid 在代码中硬编码，不可动态添加 |
| Provider 用户自定义 | 每个 Agent 类型下可添加多个 Provider（不同 API 端点、不同凭证） |
| Provider 按类型隔离 | 同一厂商的 API Key 在不同 Agent 类型下需分别配置 |
| Model 用户手动输入 | 不预设 Model 列表，由用户自行填写 |
| Role 映射链自动解析 | Workflow 节点只指定 role，系统自动解析到具体的 Provider + Model |
| 分层架构 | TypeAdapter（语义层）+ Executor（运行层）分离，支持灵活组合 |

---

## 2. Agent 类型定义

Agent 类型是系统固化的概念，定义在代码中，不可通过界面动态添加。每个 Agent 类型定义了其 Provider 配置表单的字段 schema。

### 2.1 类型定义（TypeScript）

```typescript
// packages/api/src/agent-types.ts

export interface ProviderField {
  key: string
  label: string
  type: 'string' | 'secret' | 'select'
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface AgentTypeDefinition {
  name: string
  description: string
  providerFields: ProviderField[]
}

export const AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  'claude-code': {
    name: 'ClaudeCode',
    description: 'Anthropic Claude Code CLI 工具',
    providerFields: [
      { key: 'base_url', label: 'Base URL', type: 'string', required: true, placeholder: 'https://api.anthropic.com' },
      { key: 'auth_token', label: 'Auth Token', type: 'secret', required: true },
    ],
  },
  'codex': {
    name: 'Codex',
    description: 'OpenAI Codex CLI 工具',
    providerFields: [
      { key: 'base_url', label: 'Base URL', type: 'string', required: true, placeholder: 'https://api.openai.com' },
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

### 2.2 Agent 类型对比

| Agent 类型 | Provider 配置字段 | 说明 | Docker 镜像 |
|-----------|------------------|------|------------|
| claude-code | base_url + auth_token | ClaudeCode CLI 只需 API 端点和认证 Token | workgear/agent-claude:latest |
| codex | base_url + api_key | Codex CLI 使用 OpenAI 风格的 API Key | workgear/agent-codex:latest |
| droid | provider_type + base_url + api_key | Droid 需要额外指定底层 LLM 类型（anthropic/openai） | workgear/agent-droid:latest |

### 2.3 扩展新 Agent 类型

接入新的 Agent 类型需要以下步骤：

1. **定义类型**：在 `packages/api/src/agent-types.ts` 中添加类型定义
2. **实现 TypeAdapter**：在 `packages/orchestrator/internal/agent/` 中实现对应的 Adapter（如 `NewAgentAdapter`）
3. **实现 Factory**：创建 `NewAgentFactory` 实现 `AgentFactory` 接口
4. **注册 Factory**：在 `packages/orchestrator/cmd/server/main.go` 中注册到 `factoryRegistry`
5. **构建 Docker 镜像**：创建对应的 Docker 镜像（如 `workgear/agent-newagent:latest`）

前端会自动根据 `providerFields` 生成配置表单，无需额外开发。

---

## 3. 数据库设计

### 3.1 ER 关系图

```
agent_providers              agent_models                agent_roles
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│ id (PK)          │◄──┐    │ id (PK)          │◄──┐    │ id (PK)          │
│ agent_type       │   │    │ provider_id (FK)  │─┐ │    │ slug (UNIQUE)    │
│ name             │   │    │ model_name        │ │ │    │ name             │
│ config (jsonb)   │   │    │ display_name      │ │ │    │ description      │
│ is_default       │   │    │ is_default        │ │ │    │ agent_type       │
│ created_at       │   │    │ created_at        │ │ │    │ provider_id (FK) │──→ agent_providers (SET NULL)
│ updated_at       │   │    └──────────────────┘ │ │    │ model_id (FK)    │──→ agent_models (SET NULL)
└──────────────────┘   │                         │ │    │ system_prompt    │
  UNIQUE(agent_type,   └─────────────────────────┘ │    │ is_builtin       │
         name)           CASCADE DELETE            │    │ created_at       │
  INDEX(agent_type)      UNIQUE(provider_id,       │    │ updated_at       │
                                model_name)        │    └──────────────────┘
                         INDEX(provider_id)        │
                                                   └─── ON DELETE SET NULL
```

### 3.2 agent_providers

存储用户配置的 Provider 实例。每个 Agent 类型可以有多个 Provider（不同 API 端点、不同凭证）。

```sql
CREATE TABLE agent_providers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type    VARCHAR(50) NOT NULL,          -- 'claude-code' / 'codex' / 'droid'
  name          VARCHAR(100) NOT NULL,         -- 用户自定义名称
  config        JSONB NOT NULL,                -- 配置内容（字段由 providerFields 决定）
  is_default    BOOLEAN NOT NULL DEFAULT false, -- 是否为该 agent_type 的默认
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_type, name)
);
CREATE INDEX idx_agent_providers_type ON agent_providers(agent_type);
```

config 示例：

```json
// claude-code
{ "base_url": "https://api.anthropic.com", "auth_token": "sk-ant-xxx" }

// codex
{ "base_url": "https://api.openai.com", "api_key": "sk-xxx" }

// droid
{ "provider_type": "anthropic", "base_url": "https://api.anthropic.com", "api_key": "sk-ant-xxx" }
```

### 3.3 agent_models

存储每个 Provider 下的可用 Model。Model 名称由用户手动输入，不预设列表。

```sql
CREATE TABLE agent_models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   UUID NOT NULL REFERENCES agent_providers(id) ON DELETE CASCADE,
  model_name    VARCHAR(100) NOT NULL,         -- 模型标识，如 claude-sonnet-4
  display_name  VARCHAR(200),                  -- 可选的显示名称
  is_default    BOOLEAN NOT NULL DEFAULT false, -- 是否为该 Provider 的默认
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, model_name)
);
CREATE INDEX idx_agent_models_provider ON agent_models(provider_id);
```

### 3.4 agent_roles

Agent 角色模板表，定义每个角色使用的 Agent 类型、Provider、Model 和 System Prompt。

```sql
CREATE TABLE agent_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(100) UNIQUE NOT NULL,   -- 唯一标识，如 'general-developer'
  name          VARCHAR(200) NOT NULL,          -- 显示名称
  description   TEXT,                           -- 角色描述
  agent_type    VARCHAR(50) NOT NULL DEFAULT 'claude-code',
  provider_id   UUID REFERENCES agent_providers(id) ON DELETE SET NULL,  -- null = 使用默认
  model_id      UUID REFERENCES agent_models(id) ON DELETE SET NULL,     -- null = 使用默认
  system_prompt TEXT NOT NULL,                  -- 角色 System Prompt
  is_builtin    BOOLEAN DEFAULT false,          -- 内置角色不可删除
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.5 Go 侧数据模型

```go
// packages/orchestrator/internal/db/models.go

type AgentProvider struct {
    ID        string
    AgentType string
    Name      string
    Config    map[string]interface{} // JSON config
    IsDefault bool
}

type AgentModel struct {
    ID          string
    ProviderID  string
    ModelName   string
    DisplayName *string
    IsDefault   bool
}

type AgentRoleConfig struct {
    Slug         string
    AgentType    string
    ProviderID   *string // nil = use default provider for agent_type
    ModelID      *string // nil = use default model for provider
    SystemPrompt string
}
```

---

## 4. 配置解析链路

### 4.1 完整执行流程

Workflow 节点执行时，按以下链路解析到具体的 Provider 和 Model，最终通过 Docker 容器执行 Agent：

```
1. Workflow DSL 节点
   │ type: agent_task
   │ agent: { role: "general-developer", model: "claude-sonnet-4" }
   │ config: { mode: "execute", prompt_template: "..." }
   ▼
2. FlowExecutor.executeAgentTask()
   │ 从 DSL 提取 role 和 model（支持模板变量渲染）
   ▼
3. Registry.GetAdapterForRole(role)
   │ 查询 agent_roles 表
   │   ├─ agent_type: "claude-code"
   │   ├─ provider_id: "uuid-1" (或 null)
   │   ├─ model_id: "uuid-3" (或 null)
   │   └─ system_prompt: "你是一个全栈开发工程师..."
   ▼
4. 解析 Provider
   │ ├─ provider_id 非空 → 直接使用
   │ └─ provider_id 为空 → 查询该 agent_type 的默认 Provider
   │ 返回：adapter 实例 + registry_model
   ▼
5. 解析 Model（优先级链）
   │ ├─ DSL 节点显式指定 agent.model → 使用
   │ ├─ registry_model（来自 Role 映射）→ 使用
   │ └─ Adapter 实例默认 Model → 使用
   ▼
6. 构建 AgentRequest
   │ ├─ TaskID, FlowRunID, NodeID
   │ ├─ Mode: "execute" / "spec" / "review" / "opsx_plan" / "opsx_apply"
   │ ├─ Prompt: 渲染后的 prompt_template
   │ ├─ Context: 上游节点输出 + 变量
   │ ├─ RolePrompt: 来自 agent_roles.system_prompt
   │ ├─ Model: 解析后的 model name
   │ ├─ GitRepoURL, GitBranch, GitAccessToken
   │ └─ OpsxConfig: OpenSpec 配置（如果是 opsx 模式）
   ▼
7. TypeAdapter.BuildRequest()
   │ 将 AgentRequest 转换为 ExecutorRequest
   │ ├─ 构建完整 prompt（PromptBuilder）
   │ ├─ 设置环境变量（API Key, Base URL, Model）
   │ ├─ 配置 Git 参数（REPO_URL, BRANCH, ACCESS_TOKEN）
   │ └─ 配置 OpenSpec 参数（OPSX_CHANGE_NAME, OPSX_SCHEMA）
   ▼
8. DockerExecutor.Execute()
   │ ├─ 拉取 Docker 镜像（workgear/agent-claude:latest）
   │ ├─ 创建容器（注入环境变量）
   │ ├─ 启动容器并流式读取日志
   │ ├─ 实时推送日志事件到 WebSocket
   │ ├─ 等待容器完成
   │ ├─ 提取 git_metadata.json（Git 操作结果）
   │ └─ 返回 ExecutorResponse（stdout, stderr, git_metadata）
   ▼
9. TypeAdapter.ParseResponse()
   │ 解析容器输出为 AgentResponse
   │ ├─ Output: 结构化输出（JSON）
   │ ├─ GitMetadata: 分支、提交、PR 信息
   │ └─ Metrics: Token 用量、执行时长
   ▼
10. FlowExecutor 后处理
    │ ├─ 更新 Task Git 信息（branch, commit）
    │ ├─ 更新 FlowRun PR 信息（pr_url, pr_number）
    │ ├─ 创建 Artifact 记录（如果配置了 artifact）
    │ ├─ 提取 Markdown 文件为 Artifact（从 Git 变更）
    │ ├─ 保存 NodeRun 输出和日志流
    │ ├─ 发布 node.completed 事件
    │ └─ 记录 Timeline 事件
```

### 4.2 Model 优先级

| 层级 | 来源 | 说明 |
|------|------|------|
| 1 (最高) | DSL 节点 `agent.model` | Workflow 编辑器中显式指定，支持模板变量 |
| 2 | Role 映射的 `model_id` | agent_roles 表中配置的 Model |
| 3 | Provider 的默认 Model | agent_models 表中 `is_default=true` 的 Model |
| 4 (最低) | Adapter 实例默认 Model | 代码中硬编码的 fallback Model |

### 4.3 System Prompt 优先级

| 层级 | 来源 | 说明 |
|------|------|------|
| 1 (最高) | agent_roles.system_prompt | 数据库中配置的 Role Prompt |
| 2 (最低) | 代码硬编码 | 旧版兼容，已废弃 |

---

## 5. API 接口

### 5.1 Agent 类型（只读）

```
GET /api/agent-types
```

返回系统固化的 Agent 类型定义（`AGENT_TYPES` 常量），含 `providerFields` schema。前端据此动态生成 Provider 配置表单。

路由注册：`packages/api/src/routes/agent-types.ts`

### 5.2 Provider CRUD

```
GET    /api/agent-providers?agent_type=claude-code   # 列表（按类型过滤，secret 字段脱敏）
GET    /api/agent-providers/:id                      # 单个（secret 字段脱敏）
POST   /api/agent-providers                          # 创建
PUT    /api/agent-providers/:id                      # 更新（secret 字段智能合并）
DELETE /api/agent-providers/:id                      # 删除（级联删除 Models）
PUT    /api/agent-providers/:id/default              # 设为默认
```

安全特性：
- GET 返回时对 `type: 'secret'` 字段自动脱敏（`sk-ant-***xxx`），使用 `maskProviderConfig()` 函数
- PUT 更新时，如果 secret 字段值包含 `***`，保留数据库中的旧值（防止脱敏值覆盖真实值）
- 设为默认时，自动取消同 `agent_type` 下其他 Provider 的默认状态

路由注册：`packages/api/src/routes/agent-providers.ts`

### 5.3 Model CRUD

```
GET    /api/agent-providers/:id/models               # 列表（Provider 子路由）
POST   /api/agent-providers/:id/models               # 添加
DELETE /api/agent-models/:id                         # 删除（独立路由）
PUT    /api/agent-models/:id/default                 # 设为默认（独立路由）
```

注意：Model 的列表和创建挂在 Provider 子路由下，删除和设默认使用独立路由前缀 `/api/agent-models`。

路由注册：
- Provider 子路由：`packages/api/src/routes/agent-providers.ts` 中的 `agentProviderRoutes`
- 独立路由：`packages/api/src/routes/agent-providers.ts` 中的 `agentModelRoutes`

### 5.4 Role CRUD

```
GET    /api/agent-roles                              # 列表（含 providerName, modelName 关联查询）
GET    /api/agent-roles/:id                          # 单个
POST   /api/agent-roles                              # 创建（slug, name, agentType, providerId, modelId, systemPrompt）
PUT    /api/agent-roles/:id                          # 更新
DELETE /api/agent-roles/:id                          # 删除（内置角色不可删）
POST   /api/agent-roles/:id/test                     # 测试角色（通过 gRPC 调用 Orchestrator）
```

测试接口流程：
1. 从 `agent_roles` 查询角色配置
2. 解析 Provider（显式指定 → 默认 Provider）
3. 解析 Model（显式指定 → 默认 Model）
4. 通过 gRPC `TestAgent` 调用 Orchestrator
5. Orchestrator 创建临时 Docker 容器执行测试
6. 返回执行结果和日志

路由注册：`packages/api/src/routes/agent-roles.ts`

### 5.5 gRPC 接口（Orchestrator）

```protobuf
// packages/shared/proto/orchestrator.proto

rpc TestAgent(TestAgentRequest) returns (TestAgentResponse);

message TestAgentRequest {
  string role_id = 1;
  string agent_type = 2;
  optional string provider_id = 3;
  map<string, string> provider_config = 4;
  optional string model_name = 5;
  string system_prompt = 6;
  string test_prompt = 7;
}

message TestAgentResponse {
  bool success = 1;
  optional string result = 2;
  optional string error = 3;
  repeated string logs = 4;
}
```

Orchestrator 端处理逻辑（`grpc/server.go`）：
1. 优先从 Registry 查找已注册的 Adapter（`GetAdapterByProvider`）
2. 如果未找到，通过 `factoryRegistry.CreateAdapter()` 创建临时 Adapter
3. 注入日志回调，收集执行日志
4. 设置 2 分钟超时执行
5. 返回结构化结果

---

## 6. 前端界面

### 6.1 路由结构

| 路由 | 页面组件 | 说明 |
|------|---------|------|
| `/settings/agents` | `AgentConfigPage` | Provider + Model 管理 |
| `/settings/agent-roles` | `AgentRolesPage` | Role 管理（含测试功能） |

路由定义：`packages/web/src/App.tsx`  
侧边栏导航：`packages/web/src/components/layout/sidebar.tsx`

### 6.2 Agent 配置页面 `/settings/agents`

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

组件结构：
- `AgentConfigPage`：主页面，Tabs 按 Agent 类型切换
- `ProviderCard`：单个 Provider 卡片，展示配置和 Model 列表
- `ProviderDialog`：创建/编辑 Provider 的 Dialog，表单根据 `providerFields` 动态生成
- `ModelDialog`：添加 Model 的 Dialog

交互细节：
- 添加 Provider 时，表单根据 Agent 类型的 `providerFields` 动态生成
- `secret` 类型字段使用 `password` input，显示时脱敏
- Model 由用户手动输入 model name（不预设列表）
- 每个 Model 可设为默认，每个 Provider 下只有一个默认 Model
- 删除 Provider 会级联删除其下所有 Model

文件：`packages/web/src/pages/settings/agents.tsx`

### 6.3 Agent 角色页面 `/settings/agent-roles`

```
┌─────────────────────────────────────────────────────┐
│  Agent 角色管理                        [+ 新建角色]  │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ 全栈开发工程师  [general-developer]  [内置]  │    │
│  │ 根据需求和技术方案编写高质量代码              │    │
│  │ Agent: ClaudeCode  Provider: 默认  Model: 默认│    │
│  │                          [测试][编辑][删除]  │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │ 代码审查员  [code-reviewer]  [内置]          │    │
│  │ 审查代码质量、安全性、性能和规范性            │    │
│  │ Agent: ClaudeCode  Provider: 默认  Model: 默认│    │
│  │                          [测试][编辑]        │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

组件结构：
- `AgentRolesPage`：主页面，角色列表
- `RoleCard`：单个角色卡片，支持内联编辑模式
- `CreateRoleDialog`：新建角色 Dialog
- `TestAgentDialog`：测试角色 Dialog（输入 prompt → 调用 API → 显示结果和日志）

编辑模式支持三级联动选择：
1. Agent 类型 → 过滤可选 Provider
2. Provider → 过滤可选 Model
3. 切换 Agent 类型时自动重置 Provider 和 Model
4. 切换 Provider 时自动重置 Model
5. 选择"使用默认"表示使用该层级的默认配置

内置角色（`is_builtin=true`）不可删除，但可编辑配置。

文件：`packages/web/src/pages/settings/agent-roles.tsx`

### 6.4 前端类型定义

```typescript
// packages/web/src/lib/types.ts

export interface ProviderField {
  key: string
  label: string
  type: 'string' | 'secret' | 'select'
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface AgentTypeDefinition {
  name: string
  description: string
  providerFields: ProviderField[]
}

export interface AgentProvider {
  id: string
  agentType: string
  name: string
  config: Record<string, any>  // secret 字段已脱敏
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentModel {
  id: string
  providerId: string
  modelName: string
  displayName: string | null
  isDefault: boolean
  createdAt: string
}

export interface AgentRole {
  id: string
  slug: string
  name: string
  description: string | null
  agentType: string
  providerId: string | null
  modelId: string | null
  systemPrompt: string
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
  providerName?: string | null  // 关联查询填充
  modelName?: string | null     // 关联查询填充
}
```

---

## 7. Orchestrator 加载逻辑

### 7.1 启动流程（main.go）

```go
// 1. 创建 Agent Factory Registry
factoryRegistry := agent.NewAgentFactoryRegistry()
factoryRegistry.Register(&agent.ClaudeCodeFactory{PromptBuilder: promptBuilder})
factoryRegistry.Register(&agent.CodexFactory{PromptBuilder: promptBuilder})

// 2. 从数据库加载所有 Provider
providers, err := dbClient.GetAllAgentProviders(ctx)

// 3. 为每个 Provider 创建 Adapter 实例
for _, p := range providers {
    // 获取该 Provider 的默认 Model
    defaultModel, _ := dbClient.GetDefaultModelForProvider(ctx, p.ID)
    modelName := ""
    if defaultModel != nil {
        modelName = defaultModel.ModelName
    }

    // 通过 Factory 创建 Adapter
    adapter, err := factoryRegistry.CreateAdapter(
        logger, 
        p.AgentType,  // "claude-code" / "codex"
        p.ID,         // Provider UUID
        p.Config,     // {"base_url": "...", "auth_token": "..."}
        modelName,    // "claude-sonnet-4"
    )
    
    // 注册到 Registry
    registry.RegisterProvider(p.ID, adapter)
}

// 4. 从数据库加载 Role 映射
roleConfigs, err := dbClient.GetAllAgentRoleConfigs(ctx)

// 5. 为每个 Role 解析 Provider 和 Model
for slug, rc := range roleConfigs {
    providerID := ""
    modelName := ""

    if rc.ProviderID != nil {
        // Role 显式指定了 Provider
        providerID = *rc.ProviderID
        if rc.ModelID != nil {
            // Role 显式指定了 Model
            m, _ := dbClient.GetAgentModel(ctx, *rc.ModelID)
            if m != nil {
                modelName = m.ModelName
            }
        } else {
            // 使用 Provider 的默认 Model
            m, _ := dbClient.GetDefaultModelForProvider(ctx, providerID)
            if m != nil {
                modelName = m.ModelName
            }
        }
    } else {
        // 使用该 agent_type 的默认 Provider
        dp, _ := dbClient.GetDefaultProviderForType(ctx, rc.AgentType)
        if dp != nil {
            providerID = dp.ID
            m, _ := dbClient.GetDefaultModelForProvider(ctx, dp.ID)
            if m != nil {
                modelName = m.ModelName
            }
        }
    }

    if providerID != "" {
        registry.MapRoleToProvider(slug, providerID, modelName)
    }
}

// 6. 环境变量兼容（向后兼容）
if len(providers) == 0 {
    if os.Getenv("ANTHROPIC_API_KEY") != "" {
        envConfig := map[string]any{
            "auth_token": os.Getenv("ANTHROPIC_AUTH_TOKEN"),
            "base_url":   os.Getenv("ANTHROPIC_BASE_URL"),
        }
        adapter, _ := factoryRegistry.CreateAdapter(
            logger, "claude-code", "env-fallback", envConfig, os.Getenv("CLAUDE_MODEL"),
        )
        registry.RegisterProvider("env-fallback", adapter)
    }
}
```

### 7.2 Factory 模式

每个 Agent 类型实现一个 Factory，负责从 Provider 配置创建 Adapter 实例：

```go
// ClaudeCodeFactory
type ClaudeCodeFactory struct {
    PromptBuilder *PromptBuilder
}

func (f *ClaudeCodeFactory) AgentType() string { return "claude-code" }

func (f *ClaudeCodeFactory) CreateAdapter(
    logger *zap.SugaredLogger, 
    providerID string, 
    config map[string]any, 
    modelName string,
) (Adapter, error) {
    authToken, _ := config["auth_token"].(string)
    baseURL, _ := config["base_url"].(string)

    dockerExec, err := NewDockerExecutor(logger)
    if err != nil {
        return nil, err
    }

    adapter := NewClaudeCodeAdapter(f.PromptBuilder, providerID, baseURL, authToken, modelName)
    return NewCombinedAdapter(adapter, dockerExec), nil
}
```

### 7.3 TypeAdapter 实例级配置

TypeAdapter 不再从环境变量读取凭证，改为构造时注入：

```go
type ClaudeCodeAdapter struct {
    promptBuilder *PromptBuilder
    providerID    string   // Provider UUID
    baseURL       string   // 从 Provider config 加载
    authToken     string   // 从 Provider config 加载
    model         string   // 默认 Model
}

func (a *ClaudeCodeAdapter) BuildRequest(ctx context.Context, req *AgentRequest) (*ExecutorRequest, error) {
    // 构建 prompt
    prompt := a.promptBuilder.Build(req)

    // 准备环境变量
    env := map[string]string{
        "AGENT_PROMPT":         prompt,
        "AGENT_MODE":           req.Mode,
        "ANTHROPIC_BASE_URL":   a.baseURL,
        "ANTHROPIC_AUTH_TOKEN": a.authToken,
    }

    // Model 优先级：req.Model > a.model
    model := req.Model
    if model == "" {
        model = a.model
    }
    if model != "" {
        env["CLAUDE_MODEL"] = model
    }

    // Git 配置
    if req.GitRepoURL != "" {
        env["GIT_REPO_URL"] = req.GitRepoURL
        env["GIT_BRANCH"] = req.GitBranch
        env["GIT_ACCESS_TOKEN"] = req.GitAccessToken
    }

    return &ExecutorRequest{
        Image:   "workgear/agent-claude:latest",
        Command: nil,
        Env:     env,
        WorkDir: "/workspace",
        Timeout: 10 * time.Minute,
    }, nil
}
```

### 7.4 Registry 结构

```go
type Registry struct {
    adapters map[string]Adapter      // provider_id → adapter
    legacy   map[string]Adapter      // name → adapter (向后兼容)
    roles    map[string]*RoleMapping // role_slug → {provider_id, model_name}
}

type RoleMapping struct {
    ProviderID string
    ModelName  string
}

// 查询链路
func (r *Registry) GetAdapterForRole(role string) (Adapter, string, error) {
    mapping, ok := r.roles[role]
    if !ok {
        return nil, "", &NoAdapterError{Role: role}
    }
    
    adapter, ok := r.adapters[mapping.ProviderID]
    if !ok {
        return nil, "", &NoAdapterError{Role: role}
    }
    
    return adapter, mapping.ModelName, nil
}
```

### 7.5 执行时配置注入

执行时，TypeAdapter 将配置注入 Docker 容器环境变量：

```go
// ClaudeCode
env["ANTHROPIC_BASE_URL"]  = a.baseURL
env["ANTHROPIC_AUTH_TOKEN"] = a.authToken
env["CLAUDE_MODEL"]         = req.Model

// Codex
env["OPENAI_API_KEY"]      = a.apiKey
env["CODEX_PROVIDER_BASE_URL"] = a.baseURL
env["CODEX_MODEL"]         = req.Model
```

---

## 8. 安全考虑

| 场景 | 处理方式 |
|------|---------|
| API Key 存储 | 明文存储在数据库 jsonb 字段中（后续可加密） |
| API Key 传输（读取） | GET 接口自动脱敏，使用 `maskSecret()` 函数（前 7 位 + `***` + 后 3 位） |
| API Key 传输（更新） | PUT 时如果 secret 字段含 `***`，保留旧值不覆盖 |
| 容器注入 | 通过环境变量注入 Docker 容器，容器销毁后消失 |
| 日志安全 | Orchestrator 日志不输出 API Key 内容 |
| 默认互斥 | 设为默认时自动取消同类型下其他 Provider/Model 的默认状态 |
| 内置角色保护 | `is_builtin=true` 的角色不可删除 |
| 级联删除 | 删除 Provider 时级联删除其下所有 Model；agent_roles 的外键设为 `ON DELETE SET NULL` |

### 8.1 脱敏函数

```typescript
// packages/api/src/agent-types.ts

export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 10) return '***'
  return value.slice(0, 7) + '***' + value.slice(-3)
}

export function maskProviderConfig(agentType: string, config: Record<string, any>): Record<string, any> {
  const secretKeys = getSecretFields(agentType)
  const masked = { ...config }
  for (const key of secretKeys) {
    if (masked[key]) {
      masked[key] = maskSecret(masked[key])
    }
  }
  return masked
}
```

---

## 9. 内置角色（Seed Data）

系统预置 5 个内置角色，通过 seed 脚本写入数据库：

| Slug | 名称 | 默认 Agent 类型 | 用途 |
|------|------|----------------|------|
| `requirement-analyst` | 需求分析师 | claude-code | 需求理解、任务拆分 |
| `general-developer` | 全栈开发工程师 | claude-code | 代码编写 |
| `code-reviewer` | 代码审查员 | claude-code | 代码审查 |
| `qa-engineer` | QA 工程师 | claude-code | 测试编写 |
| `spec-architect` | Spec 架构师 | claude-code | OpenSpec 规范驱动开发 |

Seed 脚本：`packages/api/src/seeds/seed-agent-roles.ts`

Orchestrator 启动时会确保这些常用角色都有映射（`defaultRoles` 列表），如果数据库中没有配置，会自动映射到默认 Provider。

---

## 10. 分层架构详解

### 10.1 TypeAdapter + Executor 两层架构

系统将 Agent 执行拆分为两层，实现关注点分离：

```
┌─────────────────────────────────────────────────┐
│                  Adapter 接口                    │
│  Execute(ctx, AgentRequest) → AgentResponse      │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────┴────────┐
              │ CombinedAdapter │  ← 桥接层
              └───┬─────────┬───┘
                  │         │
    ┌─────────────┴──┐  ┌──┴──────────────┐
    │  TypeAdapter   │  │    Executor      │
    │  （语义层）     │  │  （运行层）       │
    │                │  │                  │
    │ BuildRequest() │  │ Execute()        │
    │ ParseResponse()│  │                  │
    └────────────────┘  └──────────────────┘
```

- **TypeAdapter**（语义层）：负责构建 prompt、设置环境变量、解析输出
  - `ClaudeCodeAdapter`：处理 Claude CLI 的 stream-json 输出格式
  - `CodexAdapter`：处理 Codex CLI 的输出格式
- **Executor**（运行层）：负责实际执行 Agent
  - `DockerExecutor`：在 Docker 容器中执行，支持实时日志流

### 10.2 AgentFactory 模式

Factory 模式封装了从 Provider 配置到 Adapter 实例的创建过程：

```go
type AgentFactory interface {
    AgentType() string
    CreateAdapter(logger, providerID, config, modelName) (Adapter, error)
}

// 已实现的 Factory
type ClaudeCodeFactory struct { ... }  // → ClaudeCodeAdapter + DockerExecutor
type CodexFactory struct { ... }       // → CodexAdapter + DockerExecutor(codex image)
```

### 10.3 DockerExecutor 执行流程

```
1. ensureImage()     → 检查/拉取 Docker 镜像
2. ContainerCreate() → 创建容器（注入环境变量）
3. ContainerStart()  → 启动容器
4. streamLogs()      → 实时读取 stderr（stream-json 事件）
   ├─ 解析 ClaudeStreamEvent
   ├─ 触发 onLogEvent 回调
   └─ FlowExecutor 通过 EventBus 推送到 WebSocket
5. ContainerWait()   → 等待容器完成（或超时 kill）
6. collectLogs()     → 收集最终 stdout/stderr
7. extractGitMetadata() → 从容器提取 /output/git_metadata.json
8. ContainerRemove() → 清理容器（defer）
```

### 10.4 实时日志流

Agent 执行过程中的日志通过以下链路实时推送到前端：

```
Docker Container (stderr)
  → DockerExecutor.streamLogs() 解析 stream-json
    → onLogEvent 回调
      → FlowExecutor.publishEvent("node.log_stream", flatEvent)
        → EventBus
          → gRPC EventStream
            → API Server WebSocket
              → 浏览器
```

日志事件类型：
- `assistant`：Agent 文本输出
- `tool_use`：Agent 调用工具
- `tool_result`：工具返回结果
- `result`：最终执行结果

---

## 11. 文件清单

### 11.1 API Server（packages/api）

| 文件 | 说明 |
|------|------|
| `src/agent-types.ts` | Agent 类型定义 + 脱敏工具函数 |
| `src/routes/agent-types.ts` | Agent 类型只读接口 |
| `src/routes/agent-providers.ts` | Provider CRUD + Model CRUD 接口 |
| `src/routes/agent-roles.ts` | Role CRUD + 测试接口 |
| `src/db/schema.ts` | 数据库 Schema（agent_providers, agent_models, agent_roles 表） |
| `src/seeds/seed-agent-roles.ts` | 内置角色 Seed 脚本 |
| `src/grpc/client.ts` | gRPC 客户端（含 testAgent 方法） |
| `src/server.ts` | 路由注册 |

### 11.2 Orchestrator（packages/orchestrator）

| 文件 | 说明 |
|------|------|
| `internal/agent/adapter.go` | 核心接口定义（Adapter, TypeAdapter, Executor, Registry） |
| `internal/agent/factory.go` | AgentFactory 接口 + AgentFactoryRegistry |
| `internal/agent/claude_factory.go` | ClaudeCode Factory 实现 |
| `internal/agent/codex_factory.go` | Codex Factory 实现 |
| `internal/agent/codex_adapter.go` | Codex TypeAdapter 实现 |
| `internal/agent/executor.go` | DockerExecutor 实现（含实时日志流） |
| `internal/db/models.go` | 数据模型（AgentProvider, AgentModel, AgentRoleConfig） |
| `internal/db/queries.go` | 数据库查询（Provider/Model/Role 相关） |
| `internal/grpc/server.go` | gRPC 服务（含 TestAgent 实现） |
| `internal/engine/node_handlers.go` | 节点执行器（Agent 配置解析链路） |
| `cmd/server/main.go` | 启动入口（加载配置、注册 Factory、初始化 Registry） |

### 11.3 前端（packages/web）

| 文件 | 说明 |
|------|------|
| `src/pages/settings/agents.tsx` | Agent 配置管理页面（Provider + Model） |
| `src/pages/settings/agent-roles.tsx` | Agent 角色管理页面（含测试 Dialog） |
| `src/lib/types.ts` | TypeScript 类型定义 |
| `src/App.tsx` | 路由定义 |
| `src/components/layout/sidebar.tsx` | 侧边栏导航 |

### 11.4 共享（packages/shared）

| 文件 | 说明 |
|------|------|
| `proto/orchestrator.proto` | gRPC Proto 定义（含 TestAgent RPC） |

### 11.5 其他

| 文件 | 说明 |
|------|------|
| `scripts/migrate-agent-config.sh` | 环境变量 → 数据库迁移脚本 |
| `docker/agent-codex/` | Codex Agent Docker 镜像构建 |

---

## 12. 总结

### 12.1 核心特性

1. **灵活的多层配置**：Agent 类型 → Provider → Model → Role 四层架构，支持细粒度控制
2. **Provider 隔离**：同一 Agent 类型可配置多个 Provider（官方 API、代理、自建服务）
3. **动态表单生成**：前端根据 `providerFields` 自动生成配置表单，扩展新 Agent 类型无需前端改动
4. **安全的凭证管理**：API Key 脱敏显示、智能更新、容器隔离
5. **实时日志流**：Agent 执行过程中的日志实时推送到前端
6. **测试功能**：支持在界面上直接测试 Agent 配置是否正常工作
7. **向后兼容**：支持环境变量 fallback，平滑迁移

### 12.2 执行流程总结

```
用户在 Workflow 编辑器中选择 Role
  ↓
FlowExecutor 从 agent_roles 表查询配置
  ↓
解析 Provider（显式指定 → 默认 Provider）
  ↓
解析 Model（DSL 显式 → Role 映射 → Provider 默认 → Adapter 默认）
  ↓
从 Registry 获取 Adapter 实例（启动时已创建）
  ↓
TypeAdapter 构建 ExecutorRequest（prompt + 环境变量）
  ↓
DockerExecutor 创建容器并执行
  ↓
实时流式读取日志并推送到前端
  ↓
提取 git_metadata.json（Git 操作结果）
  ↓
TypeAdapter 解析输出为 AgentResponse
  ↓
FlowExecutor 后处理（更新 Git 信息、创建 Artifact、记录 Timeline）
```

### 12.3 扩展指南

**添加新 Agent 类型**：

1. 在 `packages/api/src/agent-types.ts` 中添加类型定义
2. 实现 `TypeAdapter`（如 `NewAgentAdapter`）
3. 实现 `AgentFactory`（如 `NewAgentFactory`）
4. 在 `main.go` 中注册 Factory
5. 构建 Docker 镜像（如 `workgear/agent-newagent:latest`）

**添加新 Provider**：

1. 在前端 `/settings/agents` 页面点击"添加 Provider"
2. 填写配置（表单自动生成）
3. 添加 Model（手动输入 model name）
4. 重启 Orchestrator 加载新配置（或实现热重载）

**添加新 Role**：

1. 在前端 `/settings/agent-roles` 页面点击"新建角色"
2. 选择 Agent 类型、Provider、Model
3. 编写 System Prompt
4. 在 Workflow 编辑器中使用新 Role

### 12.4 已知限制

1. **配置热重载**：当前 Orchestrator 启动时加载配置，修改后需重启（可优化为监听数据库变更）
2. **API Key 加密**：当前明文存储在数据库，后续可引入加密存储
3. **Model 列表**：当前需手动输入 model name，未来可考虑从 API 动态获取可用模型列表
4. **多租户隔离**：当前所有用户共享 Provider 配置，未来可支持用户级别的 Provider

### 12.5 相关文档

- [Agent 接入层设计](./04-agent-layer.md)
- [流程引擎设计](./03-flow-engine.md)
- [数据模型设计](./06-data-model.md)
- [Phase 4 实施方案](./14-phase4-agent-implementation.md)
