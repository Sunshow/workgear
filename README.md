# WorkGear

> AI Agent 工作流编排平台 — 支持 ClaudeCode 等 Agent 按预定义流程执行任务，配合人工 Review 和看板管理。

---

## 🎯 核心功能

- **AI Agent 工作流编排** — 通过 YAML DSL 定义多节点工作流，支持 agent_task / human_review / human_input 三种节点类型
- **可视化流程设计** — Monaco Editor 编辑 YAML + ReactFlow DAG 实时预览，所见即所得
- **Docker 容器化 Agent** — ClaudeCode Agent 在隔离容器中执行，通过 Git 交互读写代码仓库
- **实时执行监控** — WebSocket 推送流程状态变更、节点日志，前端实时展示
- **产物版本管理** — Agent 产出自动关联流程节点，支持版本追踪、分组展示、在线编辑
- **看板任务管理** — 拖拽排序的看板视图，Task 与工作流深度集成
- **人工审核节点** — 支持 Approve / Reject / Edit 操作，Reject 可打回到上游节点重新执行
- **自动降级机制** — Docker 不可用或无 API Key 时自动回退到 Mock Agent，保证开发体验

---

## 🏗️ 系统架构

```
浏览器
  │
  ├── HTTP ──→ Vite Dev Server (:3000) ──/api 代理──→ Fastify API (:4000)
  │                                                       │
  └── WebSocket ←─────────────────────────────────────────┘
                                                          │
                                                     gRPC 双向流
                                                          │
                                                          ▼
                                                Go Orchestrator (:50051)
                                                ┌─────────────────────┐
                                                │  Flow Engine        │
                                                │  ├─ DSL Parser      │
                                                │  ├─ DAG Advancer    │
                                                │  └─ State Machine   │
                                                │                     │
                                                │  Agent Scheduler    │
                                                │  ├─ Claude Adapter  │
                                                │  ├─ Mock Adapter    │
                                                │  └─ Docker Executor │
                                                │                     │
                                                │  Event Bus → gRPC   │
                                                └────────┬────────────┘
                                                         │
                                              ┌──────────┴──────────┐
                                              │                     │
                                        PostgreSQL (:5432)    Redis (:6379)
```

---

## 💻 技术栈

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 19.2.1 | UI 框架 |
| Vite | 7.0 | 构建工具 |
| TypeScript | 5.9 | 类型系统 |
| Tailwind CSS | 4.1 | 样式（Shadcn/ui 组件） |
| Zustand | 5.0 | 状态管理 |
| React Router | 7.13 | 路由 |
| @xyflow/react | 12.10 | DAG 流程可视化 |
| Monaco Editor | 4.7 | YAML 代码编辑器 |
| @dnd-kit | 6.3 | 看板拖拽排序 |
| ky | 1.14 | HTTP 客户端 |
| Zod | 4.3 | 数据校验 |

### API Server

| 技术 | 版本 | 用途 |
|------|------|------|
| Fastify | 5.7 | Web 框架 |
| Drizzle ORM | 1.0-beta.15 | 数据库 ORM |
| PostgreSQL | 18.1 | 主数据库 |
| Redis | 8.4 | 缓存 / 消息队列 |
| @fastify/websocket | 11.0 | WebSocket 推送 |
| @fastify/jwt | 10.0 | JWT 认证 |
| @grpc/grpc-js | 1.12 | gRPC 客户端 |
| Pino | 10.1 | 日志 |

### Orchestrator

| 技术 | 版本 | 用途 |
|------|------|------|
| Go | 1.25 | 运行时 |
| gRPC | 1.70 | 服务通信 |
| pgx | 5.8 | PostgreSQL 驱动 |
| Docker SDK | 28.5 | Agent 容器管理 |
| Zap | 1.27 | 结构化日志 |
| Protobuf | 1.36 | 序列化协议 |

---

## 🚀 快速开始

### 前置要求

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Docker & Docker Compose
- Go >= 1.25（Orchestrator 开发）

### 一键安装

```bash
git clone <repo-url>
cd workgear

chmod +x scripts/setup.sh
./scripts/setup.sh
```

脚本自动完成：检查软件版本 → 启动 Docker 数据库 → 安装依赖 → 推送 Schema → 导入种子数据

### 启动开发环境

```bash
# 同时启动前端 + API + Orchestrator
pnpm dev
```

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 | http://localhost:3000 | React 开发服务器 |
| API | http://localhost:4000 | Fastify REST API |
| Orchestrator | localhost:50051 | Go gRPC 服务 |
| Drizzle Studio | http://localhost:4983 | 数据库可视化（`pnpm db:studio`） |

### 数据库管理

```bash
cd packages/api

pnpm db:push       # 推送 Schema 到数据库
pnpm db:seed       # 导入内置流程模板
pnpm db:generate   # 生成迁移文件（生产环境）
pnpm db:studio     # 启动可视化管理工具
```

---

## 📖 使用流程

### 1. 注册并登录

访问 http://localhost:3000，注册账号后登录系统。

### 2. 创建项目

在项目列表页创建新项目，可配置 Git 仓库地址用于 Agent 代码交互。

### 3. 配置工作流

进入项目的「工作流」页面，从内置模板创建或自定义 YAML DSL：

```yaml
name: code-review-flow
nodes:
  - id: implement
    type: agent_task
    name: 代码实现
    agent_role: developer
    prompt_template: |
      请根据以下需求实现代码：
      {{task.description}}

  - id: review
    type: human_review
    name: 代码审核
    depends_on: [implement]

  - id: fix
    type: agent_task
    name: 修复问题
    agent_role: developer
    depends_on: [review]
    prompt_template: |
      请根据审核反馈修复代码：
      {{review.feedback}}
```

### 4. 在看板中创建任务并执行

在看板视图创建 Task，选择工作流后启动执行。系统自动按 DAG 顺序调度节点：
- **agent_task** → Docker 容器中运行 ClaudeCode 执行
- **human_review** → 等待人工审核（Approve / Reject / Edit）
- **human_input** → 等待人工输入数据

### 5. 查看产物

流程执行过程中产生的产物（代码、文档、设计稿等）自动关联到对应节点，支持按节点分组查看、版本对比和在线编辑。

---

## 🤖 Agent 配置

### ClaudeCode Agent

在 `packages/orchestrator/.env` 中配置：

```env
# 方式一：直接使用 Anthropic API
ANTHROPIC_API_KEY=sk-ant-xxx

# 方式二：自定义端点（代理场景）
ANTHROPIC_BASE_URL=https://your-proxy.example.com
ANTHROPIC_AUTH_TOKEN=your-auth-token
```

### 构建 Agent 镜像

```bash
cd docker/agent-claude
docker build -t workgear/agent-claude:latest .
```

### 降级机制

启用真实 Agent 需要同时满足：
1. Docker daemon 运行中
2. `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 至少设置一个
3. Agent 镜像已构建

不满足条件时自动降级到 Mock Agent（模拟输出，2 秒延迟），不影响流程调试。

---

## 🔌 API 端点

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/refresh` | 刷新令牌 |
| GET | `/api/auth/me` | 获取当前用户 |

### 项目

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 获取所有项目 |
| GET | `/api/projects/:id` | 获取单个项目 |
| POST | `/api/projects` | 创建项目（自动创建默认看板） |
| PUT | `/api/projects/:id` | 更新项目 |
| DELETE | `/api/projects/:id` | 删除项目 |

### 看板与任务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/kanbans?projectId=xxx` | 获取项目看板 |
| GET | `/api/tasks?projectId=xxx` | 获取项目任务 |
| GET | `/api/tasks/:id` | 获取任务详情 |
| POST | `/api/tasks` | 创建任务 |
| PUT | `/api/tasks/:id` | 更新任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |

### 工作流

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workflow-templates` | 获取流程模板列表 |
| GET | `/api/workflows?projectId=xxx` | 获取项目工作流 |
| POST | `/api/workflows` | 创建工作流 |
| PUT | `/api/workflows/:id` | 更新工作流 |

### 流程执行

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/flow-runs?taskId=xxx` | 获取任务的流程实例 |
| POST | `/api/flow-runs` | 启动流程执行 |
| GET | `/api/node-runs?flowRunId=xxx` | 获取节点执行列表 |

### 产物

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/artifacts?taskId=xxx` | 获取任务产物 |
| PUT | `/api/artifacts/:id` | 更新产物 |

### Agent 角色

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agent-roles` | 获取 Agent 角色列表 |
| POST | `/api/agent-roles` | 创建 Agent 角色 |
| PUT | `/api/agent-roles/:id` | 更新 Agent 角色 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| WebSocket | `/ws` | 实时事件推送 |

### gRPC 服务 (Orchestrator)

```protobuf
service OrchestratorService {
  rpc StartFlow(StartFlowRequest) returns (StartFlowResponse);
  rpc CancelFlow(CancelFlowRequest) returns (CancelFlowResponse);
  rpc ApproveNode(ApproveNodeRequest) returns (NodeActionResponse);
  rpc RejectNode(RejectNodeRequest) returns (NodeActionResponse);
  rpc EditNode(EditNodeRequest) returns (NodeActionResponse);
  rpc SubmitHumanInput(SubmitHumanInputRequest) returns (NodeActionResponse);
  rpc RetryNode(RetryNodeRequest) returns (NodeActionResponse);
  rpc EventStream(EventStreamRequest) returns (stream ServerEvent);
}
```

---

## 📦 项目结构

```
workgear/
├── packages/
│   ├── web/                        # React 19 前端（57 个源文件）
│   │   └── src/
│   │       ├── pages/              # 页面组件
│   │       │   ├── auth/           #   登录 / 注册
│   │       │   ├── projects/       #   项目列表
│   │       │   ├── kanban/         #   看板视图 + 任务详情
│   │       │   ├── workflows/      #   工作流编辑器 + DAG 预览
│   │       │   ├── explore/        #   探索页
│   │       │   └── settings/       #   Agent 角色管理
│   │       ├── components/         # 通用组件
│   │       │   ├── ui/             #   Shadcn/ui 基础组件
│   │       │   └── ...             #   产物编辑器、日志对话框等
│   │       ├── stores/             # Zustand 状态管理
│   │       ├── hooks/              # 自定义 Hooks
│   │       └── lib/                # 工具函数
│   │
│   ├── api/                        # Fastify 5 API Server（23 个源文件）
│   │   └── src/
│   │       ├── routes/             # 12 个路由模块
│   │       ├── db/                 # Drizzle ORM（18 张表）
│   │       ├── ws/                 # WebSocket 网关
│   │       ├── grpc/               # gRPC 客户端
│   │       ├── middleware/         # 认证中间件
│   │       ├── seeds/              # 种子数据
│   │       └── server.ts           # 入口
│   │
│   ├── orchestrator/               # Go gRPC 调度服务（18 个源文件）
│   │   ├── cmd/server/             # 入口
│   │   └── internal/
│   │       ├── engine/             # 流程引擎（DSL / DAG / 状态机）
│   │       ├── agent/              # Agent 适配器（Claude / Mock / Docker）
│   │       ├── grpc/               # gRPC 服务 + Protobuf 生成代码
│   │       ├── db/                 # PostgreSQL 查询
│   │       └── event/              # 事件总线
│   │
│   └── shared/                     # 共享 Protobuf 定义
│       └── proto/orchestrator.proto
│
├── docker/
│   ├── docker-compose.yml          # PostgreSQL 18 + Redis 8.4
│   ├── docker-compose.prod.yml     # 生产环境配置
│   └── agent-claude/               # ClaudeCode Agent 镜像
│
├── scripts/setup.sh                # 自动化设置脚本
├── docs/                           # 项目文档
│   ├── PRD/MVP/                    # 产品需求文档
│   └── spec/                       # 技术规格文档
├── openspec/                       # OpenSpec 变更记录
├── DEVELOPMENT.md                  # 开发指引
└── AGENTS.md                       # AI Agent 编码规范
```

---

## 🗄️ 数据库 Schema

18 张核心表，定义在 `packages/api/src/db/schema.ts`：

| 表名 | 说明 |
|------|------|
| `users` | 用户 |
| `refresh_tokens` | 刷新令牌 |
| `projects` | 项目 |
| `project_members` | 项目成员 |
| `kanbans` | 看板 |
| `kanban_columns` | 看板列 |
| `tasks` | 任务 |
| `workflow_templates` | 流程模板 |
| `workflows` | 项目工作流 |
| `flow_runs` | 流程实例 |
| `node_runs` | 节点执行 |
| `node_run_history` | 节点执行历史 |
| `artifacts` | 产物 |
| `artifact_versions` | 产物版本 |
| `artifact_links` | 产物关联 |
| `timeline_events` | 时间线事件 |
| `agent_configs` | Agent 配置 |
| `agent_roles` | Agent 角色模板 |

---

## ✅ 完成状态

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 基础设施：Monorepo、Docker、数据库 Schema、API 骨架 | ✅ 完成 |
| Phase 2 | 看板拖拽、流程模板库、YAML 编辑器、DAG 预览、WebSocket | ✅ 完成 |
| Phase 3 | 流程引擎核心：DSL 解析、DAG 推进、状态机、Mock Agent | ✅ 完成 |
| Phase 4 | 真实 Agent 调用：Docker 容器化 ClaudeCode、自动降级 | ✅ 完成 |

---

## 🔮 未来规划

- 多 Agent 协作（多个 Agent 并行执行不同节点）
- 更多 Agent 类型支持（Cursor、Copilot 等）
- 流程模板市场
- 团队协作与权限管理增强
- 云端部署方案
- CI/CD 集成

---

## 📚 文档

| 文档 | 说明 |
|------|------|
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 开发指引（环境搭建、脚本命令、调试技巧） |
| [PRD MVP 文档](./docs/PRD/MVP/) | 产品需求文档 |
| [技术规格](./docs/spec/) | 架构设计、流程引擎、数据模型等 |
| [Phase 3 实施方案](./docs/spec/13-phase3-implementation.md) | 流程引擎 + Mock Agent |
| [Phase 4 实施方案](./docs/spec/14-phase4-agent-implementation.md) | 真实 Agent 调用 |

---

## License

MIT
