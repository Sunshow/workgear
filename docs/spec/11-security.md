# 11. 安全与治理

## 11.1 Agent 沙箱

### 执行隔离

```
┌─────────────────────────────────────────┐
│ Agent Runtime                           │
│ ┌─────────────────────────────────────┐ │
│ │ Sandbox Container                   │ │
│ │ ┌───────────┐  ┌─────────────────┐ │ │
│ │ │ Agent     │  │ 文件系统        │ │ │
│ │ │ Process   │──│ (只读项目目录)   │ │ │
│ │ │           │  │ (可写工作目录)   │ │ │
│ │ └───────────┘  └─────────────────┘ │ │
│ │ ┌───────────┐  ┌─────────────────┐ │ │
│ │ │ 网络策略  │  │ 资源限制        │ │ │
│ │ │ (白名单)  │  │ CPU/Mem/Disk    │ │ │
│ │ └───────────┘  └─────────────────┘ │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 权限模型

```yaml
# Agent 权限配置
agent_permissions:
  file_system:
    read:
      - "{{project.root}}/**"          # 项目目录只读
      - "!{{project.root}}/.env*"      # 排除敏感文件
    write:
      - "{{project.root}}/src/**"      # 源码目录可写
      - "{{project.root}}/tests/**"    # 测试目录可写
      - "!{{project.root}}/**/*.key"   # 排除密钥文件
  
  network:
    allowed_hosts:
      - "api.anthropic.com"
      - "api.openai.com"
      - "registry.npmjs.org"
      - "github.com"
    blocked_ports: [22, 3306, 5432, 6379]  # 禁止直连数据库
  
  execution:
    allowed_commands:
      - "npm"
      - "npx"
      - "node"
      - "go"
      - "git"
    blocked_commands:
      - "rm -rf /"
      - "curl * | sh"
      - "sudo"
    max_execution_time: 300s
    max_memory: "2Gi"
    max_cpu: "2"
```

### 本地 vs 远程 Agent

| 维度 | 本地 Agent | 远程 Agent |
|------|-----------|-----------|
| 隔离方式 | 进程级 + 文件系统限制 | 容器级（Docker/K8s） |
| 网络策略 | iptables / pf 规则 | NetworkPolicy |
| 文件访问 | chroot / 符号链接 | Volume Mount |
| 资源限制 | ulimit / cgroups | K8s ResourceQuota |
| 密钥注入 | 环境变量（进程级） | K8s Secret |

## 11.2 数据分级

### 分级标准

| 级别 | 说明 | 示例 | 存储要求 | 传输要求 |
|------|------|------|----------|----------|
| L1 公开 | 无敏感性 | 项目名称、公开文档 | 无特殊要求 | 无特殊要求 |
| L2 内部 | 业务数据 | PRD、代码、Task 内容 | 加密存储 | TLS |
| L3 机密 | 凭证/密钥 | API Key、Token、密码 | 加密 + 访问审计 | TLS + 端到端加密 |
| L4 严格机密 | 个人数据 | 用户邮箱、操作日志 | 加密 + 脱敏 + 审计 | TLS + 端到端加密 |

### Agent 数据可见性

```go
// 数据分级过滤器：Agent 只能看到其权限范围内的数据
type DataClassificationFilter struct {
    agentLevel  DataLevel  // Agent 被授权的最高数据级别
}

func (f *DataClassificationFilter) Filter(ctx context.Context, data map[string]any) map[string]any {
    filtered := make(map[string]any)
    for key, value := range data {
        level := getDataLevel(key)
        if level <= f.agentLevel {
            filtered[key] = value
        } else {
            filtered[key] = "[REDACTED]"
        }
    }
    return filtered
}
```

### 敏感数据处理

```yaml
# 项目级敏感数据配置
data_classification:
  patterns:
    - pattern: "(?i)(password|secret|token|api_key)"
      level: L3
      action: redact
    - pattern: "(?i)(email|phone|address)"
      level: L4
      action: mask
  
  # Agent prompt 中自动脱敏
  prompt_sanitization: true
  
  # 产物存储前脱敏检查
  artifact_scan: true
```

## 11.3 审计日志

### 审计事件类型

```
AuditEvent
├── auth.*              # 认证事件
│   ├── login
│   ├── logout
│   └── token_refresh
├── project.*           # 项目管理
│   ├── created / updated / deleted
│   └── member_added / member_removed
├── flow.*              # 流程执行
│   ├── started / completed / failed / cancelled
│   ├── node_executed
│   └── review_submitted
├── agent.*             # Agent 操作
│   ├── task_assigned
│   ├── output_generated
│   ├── file_modified
│   └── command_executed
├── artifact.*          # 产物操作
│   ├── created / versioned
│   ├── reviewed / approved / rejected
│   └── linked
├── git.*               # Git 操作
│   ├── branch_created
│   ├── committed
│   └── pr_created
└── admin.*             # 管理操作
    ├── config_changed
    ├── agent_config_updated
    └── permission_changed
```

### 审计日志格式

```json
{
  "id": "audit-uuid",
  "timestamp": "2026-02-11T10:30:00Z",
  "event_type": "flow.review_submitted",
  "actor": {
    "type": "human",
    "id": "user-001",
    "name": "张三",
    "ip": "192.168.1.100"
  },
  "resource": {
    "type": "node_run",
    "id": "noderun-uuid",
    "name": "review_prd"
  },
  "action": "approve",
  "details": {
    "flow_run_id": "flowrun-uuid",
    "artifact_id": "artifact-uuid",
    "artifact_version": 3,
    "score": 87,
    "comment": "PRD 质量达标，批准通过"
  },
  "result": "success",
  "project_id": "project-uuid"
}
```

### 审计存储策略

| 数据 | 保留期限 | 存储位置 |
|------|----------|----------|
| 认证事件 | 1 年 | PostgreSQL + 归档到 S3 |
| 流程执行 | 2 年 | PostgreSQL + 归档到 S3 |
| Agent 操作 | 6 个月 | PostgreSQL |
| 产物审批 | 永久 | PostgreSQL |
| 管理操作 | 永久 | PostgreSQL |

## 11.4 Prompt 注入防护

### 威胁模型

```
用户输入（需求文本）
    ↓
┌─────────────────────────┐
│ 输入清洗层              │  ← 第一道防线
│ - 检测注入模式          │
│ - 转义特殊标记          │
│ - 长度限制              │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│ Prompt 构建层           │  ← 第二道防线
│ - System prompt 隔离    │
│ - 用户输入标记为 user   │
│ - 指令与数据分离        │
└─────────────────────────┘
    ↓
┌─────────────────────────┐
│ 输出验证层              │  ← 第三道防线
│ - Schema 校验           │
│ - 危险操作检测          │
│ - 输出内容扫描          │
└─────────────────────────┘
```

### 防护措施

```go
// 输入清洗
type PromptSanitizer struct {
    // 已知注入模式
    injectionPatterns []*regexp.Regexp
    // 最大输入长度
    maxInputLength int
}

func (s *PromptSanitizer) Sanitize(input string) (string, []Warning) {
    var warnings []Warning
    
    // 1. 长度限制
    if len(input) > s.maxInputLength {
        input = input[:s.maxInputLength]
        warnings = append(warnings, Warning{Type: "truncated"})
    }
    
    // 2. 检测注入模式
    for _, pattern := range s.injectionPatterns {
        if pattern.MatchString(input) {
            warnings = append(warnings, Warning{
                Type:    "injection_detected",
                Pattern: pattern.String(),
            })
            // 转义而非拒绝，保留用户意图
            input = pattern.ReplaceAllStringFunc(input, escapeInjection)
        }
    }
    
    return input, warnings
}

// 输出验证
type OutputValidator struct {
    dangerousPatterns []*regexp.Regexp  // rm -rf, DROP TABLE 等
}

func (v *OutputValidator) Validate(output map[string]any) (*ValidationResult, error) {
    result := &ValidationResult{Valid: true}
    
    // 1. Schema 校验（如果有 output_schema_ref）
    if schemaRef, ok := output["_schema_ref"]; ok {
        if err := validateJSONSchema(schemaRef.(string), output); err != nil {
            result.Valid = false
            result.Errors = append(result.Errors, err.Error())
        }
    }
    
    // 2. 危险操作检测
    outputStr := toJSON(output)
    for _, pattern := range v.dangerousPatterns {
        if pattern.MatchString(outputStr) {
            result.Warnings = append(result.Warnings, Warning{
                Type:    "dangerous_pattern",
                Pattern: pattern.String(),
            })
        }
    }
    
    return result, nil
}
```

## 11.5 API 安全

### 认证与授权

```
请求 → JWT 验证 → RBAC 权限检查 → Rate Limiting → 业务逻辑
```

- JWT Token（Access Token 15min + Refresh Token 7d）
- RBAC 角色：Owner / Admin / Member / Viewer
- API Rate Limiting：按用户 + 按项目 + 按 Agent

### API Key 管理

```yaml
api_keys:
  # 项目级 API Key（用于 Webhook、CI/CD 集成）
  scope: project
  permissions:
    - "flow:trigger"
    - "webhook:receive"
  rate_limit: 100/min
  expires_at: "2027-01-01"
  
  # Agent 级 API Key（用于远程 Agent 认证）
  scope: agent
  permissions:
    - "agent:execute"
    - "agent:stream"
  rate_limit: 50/min
```

### 通信安全

| 通道 | 协议 | 加密 |
|------|------|------|
| Web → API | HTTPS | TLS 1.3 |
| API → Orchestrator | gRPC | mTLS |
| WebSocket | WSS | TLS 1.3 |
| Agent → Orchestrator | gRPC | mTLS + API Key |
| Electron → API | HTTPS | TLS 1.3 + Certificate Pinning |

## 11.6 运行域隔离（R3 新增）

### 边界约束

**禁止云端控制面直接触达用户本地 Agent 进程。**

- 云端 Web/API 只能调用 `runtime=remote` 或 `runtime=docker` 的 Agent
- 本地 Agent（`runtime=local`）仅在本地受控环境中使用：
  - 桌面端（Electron）进程内
  - 本地编排器（同机 IPC）
  - 本地容器（Docker Desktop）

### 实施策略

1. **API 层拦截**：
   - 云端项目创建 Agent 配置时，`runtime=local` 被拒绝
   - 返回错误：`AGENT_RUNTIME_NOT_ALLOWED_IN_CLOUD`（HTTP 400）

2. **调度层过滤**：
   - 云端流程执行时，候选池自动过滤掉 `runtime=local` 实例
   - 桌面端流程可使用所有运行时（优先本地）

3. **认证隔离**：
   - 本地 Runtime 只接受本地签发的任务令牌（本机 IPC / 进程内调用）
   - 云端令牌无法驱动本地 Agent 进程
   - 本地令牌不可跨机器传递

### 审计要求

- 所有 Agent 调用记录 `execution_domain`（local / cloud）
- 审计日志可追溯"哪个流程在哪个域执行了哪个 Agent"
- 异常检测：云端流程尝试调用 local Agent 时记录安全事件
