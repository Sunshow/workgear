# WorkGear

> AI Agent 工作流编排平台 - Phase 1 基础设施

## 技术栈

### 基础设施
- **PostgreSQL**: 18.1
- **Redis**: 8.4.1
- **Node.js**: 22.22.0 LTS
- **pnpm**: 10.28.2
- **Go**: 1.26

### 前端
- React 19.2.1 + Vite 7.0 + TypeScript 5.9
- Tailwind CSS 4.1.18 + Shadcn/ui
- Zustand 5.0.11 + React Router 7.13.0
- Zod 4.3.6 + React Hook Form

### 后端
- Fastify 5.7.4 + Drizzle ORM 1.0-beta.15
- WebSocket (ws) + gRPC
- Pino 10.1.0

### Orchestrator
- Go 1.26 + gRPC 1.78.0
- pgx 5.8.0 + go-redis 9.7.0
- Zap 1.27.1

## 快速开始

### 前置要求

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Docker & Docker Compose
- Go >= 1.26 (可选，用于 Orchestrator)

### 安装

```bash
# 克隆仓库
git clone <repo-url>
cd workgear

# 运行设置脚本（自动安装依赖并启动数据库）
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 开发

```bash
# 启动所有服务
pnpm dev

# 或分别启动
pnpm --filter @workgear/web dev      # 前端 (http://localhost:3000)
pnpm --filter @workgear/api dev      # API (http://localhost:4000)
cd packages/orchestrator && make run # Orchestrator (gRPC :50051)
```

### 数据库管理

```bash
# 查看数据库
cd packages/api
pnpm db:studio

# 生成迁移
pnpm db:generate

# 推送 schema
pnpm db:push
```

## 项目结构

```
workgear/
├── packages/
│   ├── web/           # React 前端
│   ├── api/           # Fastify API Server
│   ├── orchestrator/  # Go 调度服务
│   └── shared/        # 共享代码
├── docker/            # Docker 配置
├── scripts/           # 工具脚本
└── docs/              # 文档
```

## API 端点

### Health Check
- `GET /api/health` - 健康检查

### Projects
- `GET /api/projects` - 获取所有项目
- `GET /api/projects/:id` - 获取单个项目
- `POST /api/projects` - 创建项目
- `PUT /api/projects/:id` - 更新项目
- `DELETE /api/projects/:id` - 删除项目

### Boards
- `GET /api/boards?projectId=xxx` - 获取项目看板
- `GET /api/boards/:id/columns` - 获取看板列

### Tasks
- `GET /api/tasks?projectId=xxx` - 获取项目任务
- `GET /api/tasks/:id` - 获取单个任务
- `POST /api/tasks` - 创建任务
- `PUT /api/tasks/:id` - 更新任务
- `DELETE /api/tasks/:id` - 删除任务

## Phase 1 完成状态

- ✅ Monorepo 结构（pnpm workspace）
- ✅ PostgreSQL 18.1 + Redis 8.4 Docker Compose
- ✅ 数据库 Schema（17 张核心表）
- ✅ Fastify 5 API Server 骨架
- ✅ 基础 CRUD API（projects、boards、tasks）
- ✅ React 19 + Vite 7 前端骨架
- ✅ Tailwind CSS 4 配置
- ✅ Go 1.26 Orchestrator 骨架
- ✅ gRPC 服务端（Mock 实现）

## 下一步（Phase 2）

- 看板拖拽功能
- 流程模板库（4 个内置模板）
- YAML 编辑器 + DAG 预览
- Task 详情面板
- WebSocket 实时推送

## 文档

详细文档请查看 `docs/` 目录：
- [PRD MVP 文档](./docs/PRD/MVP/)
- [技术规格](./docs/spec/)
- [Phase 1 实施方案](./docs/spec/12-phase1-implementation.md)

## License

MIT
