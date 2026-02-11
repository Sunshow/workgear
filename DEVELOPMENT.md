# WorkGear 开发指引

> 本文档提供 WorkGear 项目的完整开发指引和最佳实践

---

## 📋 目录

- [前置要求](#前置要求)
- [首次环境搭建](#首次环境搭建)
- [日常开发流程](#日常开发流程)
- [项目结构](#项目结构)
- [数据库管理](#数据库管理)
- [环境变量配置](#环境变量配置)
- [可用脚本命令](#可用脚本命令)
- [端口分配](#端口分配)
- [前端开发指引](#前端开发指引)
- [API 开发指引](#api-开发指引)
- [Orchestrator 开发指引](#orchestrator-开发指引)
- [代码规范](#代码规范)
- [调试技巧](#调试技巧)
- [常见问题排查](#常见问题排查)

---

## 前置要求

### 必需软件

| 软件 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Node.js | 22.0.0 | 22.22.0 LTS | JavaScript 运行时 |
| pnpm | 10.0.0 | 10.28.2 | 包管理器（项目锁定） |
| Docker | 20.x | 最新稳定版 | 容器运行时 |
| Docker Compose | 2.x | 最新稳定版 | 多容器编排 |
| Go | 1.22 | 1.22+ | Orchestrator 开发 |

### 可选软件

| 软件 | 用途 |
|------|------|
| protoc | Protobuf 代码生成（Phase 3） |
| psql | PostgreSQL 命令行客户端 |
| grpcurl | gRPC 接口测试 |

### 版本检查

```bash
node -v        # 应显示 v22.x.x
pnpm -v        # 应显示 10.x.x
docker -v      # 应显示 Docker version 20+
go version     # 应显示 go1.22+
```

---

## 首次环境搭建

### 方式一：一键脚本（推荐）

```bash
# 克隆仓库
git clone <repo-url>
cd workgear

# 运行自动化设置脚本
chmod +x scripts/setup.sh
./scripts/setup.sh
```

脚本会自动完成：
1. ✅ 检查必需软件版本
2. ✅ 启动 Docker 数据库（PostgreSQL + Redis）
3. ✅ 安装所有 npm 依赖
4. ✅ 推送数据库 Schema
5. ✅ 导入内置流程模板种子数据

### 方式二：手动步骤

```bash
# 1. 启动数据库
cd docker
docker-compose up -d
cd ..

# 2. 安装依赖
pnpm install

# 3. 配置环境变量（可选，使用默认值）
cp packages/api/.env.example packages/api/.env

# 4. 推送数据库 Schema
cd packages/api
pnpm db:push

# 5. 导入内置流程模板
pnpm db:seed
cd ../..

# 5. 验证安装
pnpm --filter @workgear/web exec tsc --noEmit
pnpm --filter @workgear/api exec tsc --noEmit
cd packages/orchestrator && go build ./cmd/server
```

---

## 日常开发流程

### 启动开发环境

```bash
# 1. 启动数据库（如果未运行）
cd docker && docker-compose up -d && cd ..

# 2. 启动所有服务（推荐）
pnpm dev
# 这会同时启动前端（:3000）、API（:4000）和 Orchestrator（:50051）

# 或者分别启动各个服务
pnpm run dev:web           # 前端
pnpm run dev:api           # API
pnpm run dev:orchestrator  # Orchestrator
```

### 服务访问地址

- **前端**: http://localhost:3000
- **API**: http://localhost:4000
- **API 健康检查**: http://localhost:4000/api/health
- **Orchestrator gRPC**: localhost:50051
- **Drizzle Studio**: http://localhost:4983 (运行 `pnpm db:studio` 后)

### 停止服务

```bash
# 停止前端/API（Ctrl+C）

# 停止数据库
cd docker && docker-compose down

# 停止并删除数据
cd docker && docker-compose down -v
```

---

## 项目结构

```
workgear/
├── packages/
│   ├── web/                    # React 19 前端
│   │   ├── src/
│   │   │   ├── App.tsx         # 根组件
│   │   │   ├── main.tsx        # 入口文件
│   │   │   └── index.css       # 全局样式
│   │   ├── package.json
│   │   ├── vite.config.ts      # Vite 配置
│   │   ├── tailwind.config.ts  # Tailwind 配置
│   │   └── tsconfig.json
│   │
│   ├── api/                    # Fastify 5 API Server
│   │   ├── src/
│   │   │   ├── server.ts       # 服务器入口
│   │   │   ├── db/
│   │   │   │   ├── schema.ts   # Drizzle Schema（17 张表）
│   │   │   │   └── index.ts    # 数据库连接
│   │   │   └── routes/
│   │   │       ├── health.ts   # 健康检查
│   │   │       ├── projects.ts # 项目 CRUD
│   │   │       ├── boards.ts   # 看板查询
│   │   │       └── tasks.ts    # 任务 CRUD
│   │   ├── package.json
│   │   ├── drizzle.config.ts   # Drizzle Kit 配置
│   │   ├── .env.example        # 环境变量模板
│   │   └── tsconfig.json
│   │
│   ├── orchestrator/           # Go gRPC 调度服务
│   │   ├── cmd/server/
│   │   │   └── main.go         # 服务器入口
│   │   ├── internal/grpc/
│   │   │   └── server.go       # gRPC 服务实现
│   │   ├── go.mod
│   │   └── Makefile
│   │
│   └── shared/                 # 共享代码
│       └── proto/
│           └── orchestrator.proto  # gRPC 服务定义
│
├── docker/
│   └── docker-compose.yml      # PostgreSQL + Redis
│
├── scripts/
│   └── setup.sh                # 自动化设置脚本
│
├── docs/                       # 项目文档
│   ├── PRD/MVP/                # 产品需求文档
│   ├── spec/                   # 技术规格文档
│   └── PHASE1-COMPLETION.md    # Phase 1 完成报告
│
├── pnpm-workspace.yaml         # pnpm workspace 配置
├── package.json                # 根 package.json
├── README.md                   # 项目概览
└── DEVELOPMENT.md              # 本文档
```

---

## 数据库管理

### 连接信息

**开发环境默认配置**:
```
Host: localhost
Port: 5432
Database: workgear_dev
User: workgear
Password: workgear_dev_pass
```

### Schema 修改流程

#### 开发环境（推荐）

```bash
# 1. 编辑 Schema
vim packages/api/src/db/schema.ts

# 2. 直接推送到数据库（无需生成迁移文件）
cd packages/api
pnpm db:push
```

#### 生产环境

```bash
# 1. 编辑 Schema
vim packages/api/src/db/schema.ts

# 2. 生成迁移文件
cd packages/api
pnpm db:generate

# 3. 检查生成的 SQL 文件
ls src/db/migrations/

# 4. 应用迁移（生产环境）
pnpm db:migrate
```

### Drizzle Studio（可视化管理）

```bash
cd packages/api
pnpm db:studio
# 访问 http://localhost:4983
```

功能：
- 浏览所有表和数据
- 执行 SQL 查询
- 编辑数据
- 查看表结构

### 直连数据库

```bash
# 使用 psql
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev

# 或使用 Docker
docker exec -it workgear-postgres psql -U workgear -d workgear_dev
```

### 重置数据库

```bash
# 方式一：删除并重建容器
cd docker
docker-compose down -v
docker-compose up -d
cd ../packages/api
pnpm db:push
pnpm db:seed

# 方式二：清空所有表
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
cd packages/api
pnpm db:push
pnpm db:seed
```

---

## 环境变量配置

### API Server (.env)

在 `packages/api/` 目录创建 `.env` 文件：

```bash
# 数据库连接
DATABASE_URL=postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev

# Redis 连接
REDIS_URL=redis://localhost:6379

# 服务器配置
PORT=4000
HOST=0.0.0.0

# Orchestrator gRPC 地址
ORCHESTRATOR_GRPC_URL=localhost:50051
```

### Orchestrator (环境变量)

```bash
# gRPC 端口（可选，默认 50051）
export GRPC_PORT=50051
```

---

## 可用脚本命令

### 根目录命令

```bash
# 同时启动前端、API 和 Orchestrator（开发模式）
pnpm dev

# 单独启动某个服务
pnpm run dev:web           # 前端
pnpm run dev:api           # API Server
pnpm run dev:orchestrator  # Go Orchestrator

# 构建所有包
pnpm build

# 清理所有 node_modules 和构建产物
pnpm clean
```

### Web 前端命令

```bash
cd packages/web

# 启动开发服务器（热重载）
pnpm dev

# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview

# 清理
pnpm clean
```

### API Server 命令

```bash
cd packages/api

# 启动开发服务器（热重载）
pnpm dev

# 构建 TypeScript
pnpm build

# 启动生产服务器
pnpm start

# 生成数据库迁移文件
pnpm db:generate

# 推送 Schema 到数据库（开发）
pnpm db:push

# 导入内置流程模板种子数据
pnpm db:seed

# 启动 Drizzle Studio
pnpm db:studio

# 清理
pnpm clean
```

### Orchestrator 命令

```bash
cd packages/orchestrator

# 生成 Protobuf Go 代码（Phase 3）
make proto

# 构建二进制文件
make build

# 运行服务器
make run

# 清理构建产物
make clean
```

---

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| 前端 Vite Dev Server | 3000 | React 开发服务器 |
| API Server | 4000 | Fastify REST API |
| Orchestrator gRPC | 50051 | Go gRPC 服务 |
| PostgreSQL | 5432 | 数据库 |
| Redis | 6379 | 缓存/消息队列 |
| Drizzle Studio | 4983 | 数据库可视化工具 |

---

## 前端开发指引

### 技术栈

- **框架**: React 19.2.1
- **构建工具**: Vite 7.0
- **样式**: Tailwind CSS 4.1.18
- **状态管理**: Zustand 5.0.11
- **路由**: React Router 7.13.0
- **表单**: React Hook Form 7.54.0 + Zod 4.3.6
- **HTTP 客户端**: ky 1.14.3
- **流程图**: @xyflow/react 12.10.0
- **代码编辑器**: @monaco-editor/react 4.7.0

### 路径别名

```typescript
// vite.config.ts 已配置
import Component from '@/components/Component'
// 等同于
import Component from './src/components/Component'
```

### API 调用

Vite 已配置代理，所有 `/api` 请求会转发到 `http://localhost:4000`：

```typescript
import ky from 'ky'

// 自动代理到 http://localhost:4000/api/projects
const projects = await ky.get('/api/projects').json()
```

### 状态管理示例（Zustand）

```typescript
// src/stores/projectStore.ts
import { create } from 'zustand'

interface ProjectStore {
  projects: Project[]
  setProjects: (projects: Project[]) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  setProjects: (projects) => set({ projects }),
}))
```

### 表单验证示例（React Hook Form + Zod）

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1, '项目名称不能为空'),
  description: z.string().optional(),
})

type FormData = z.infer<typeof schema>

function ProjectForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const onSubmit = (data: FormData) => {
    console.log(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}
    </form>
  )
}
```

---

## API 开发指引

### 技术栈

- **框架**: Fastify 5.7.4
- **ORM**: Drizzle ORM 1.0.0-beta.15
- **数据库驱动**: postgres 3.4.0
- **验证**: Zod 4.3.6
- **日志**: Pino 10.1.0
- **热重载**: tsx 4.19.0

### 添加新路由

```typescript
// src/routes/example.ts
import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { exampleTable } from '../db/schema.js'

export async function exampleRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    const results = await db.select().from(exampleTable)
    return results
  })

  app.post('/', async (request, reply) => {
    const { name } = request.body as { name: string }
    const [created] = await db.insert(exampleTable)
      .values({ name })
      .returning()
    return reply.status(201).send(created)
  })
}
```

```typescript
// src/server.ts
import { exampleRoutes } from './routes/example.js'

await app.register(exampleRoutes, { prefix: '/api/example' })
```

### 数据库查询示例（Drizzle ORM）

```typescript
import { eq, and, or, desc } from 'drizzle-orm'
import { db } from './db/index.js'
import { projects, tasks } from './db/schema.js'

// 查询所有
const allProjects = await db.select().from(projects)

// 条件查询
const project = await db.select()
  .from(projects)
  .where(eq(projects.id, projectId))

// 复杂条件
const filteredTasks = await db.select()
  .from(tasks)
  .where(
    and(
      eq(tasks.projectId, projectId),
      or(
        eq(tasks.status, 'pending'),
        eq(tasks.status, 'in_progress')
      )
    )
  )
  .orderBy(desc(tasks.createdAt))

// 插入
const [newProject] = await db.insert(projects)
  .values({ name: 'New Project' })
  .returning()

// 更新
const [updated] = await db.update(projects)
  .set({ name: 'Updated Name', updatedAt: new Date() })
  .where(eq(projects.id, projectId))
  .returning()

// 删除
await db.delete(projects).where(eq(projects.id, projectId))
```

### 重要：Drizzle ORM API

当前使用 beta 版本 `drizzle-orm@1.0.0-beta.15` + `drizzle-kit@1.0.0-beta.15`：

```typescript
// ✅ 正确（beta 版本，单参数对象）
export const db = drizzle({ client, schema })

// ❌ 错误（旧版 0.x API）
export const db = drizzle(client, { schema })
```

> ⚠️ beta 版本在 npm 上的完整版本号带 hash 后缀（如 `1.0.0-beta.15-859cf75`），package.json 中必须使用完整版本号。

---

## Orchestrator 开发指引

### 技术栈

- **语言**: Go 1.22
- **gRPC**: google.golang.org/grpc v1.70.0
- **日志**: go.uber.org/zap v1.27.0
- **Protobuf**: google.golang.org/protobuf v1.36.1

### 当前状态（Phase 1）

Orchestrator 目前仅实现健康检查，完整的流程编排功能将在 Phase 3 实现。

### 生成 Protobuf 代码（Phase 3）

```bash
cd packages/orchestrator

# 确保已安装 protoc 和插件
# brew install protobuf
# go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
# go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# 生成 Go 代码
make proto
```

### 测试 gRPC 服务

```bash
# 使用 grpcurl 测试健康检查
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check

# 响应示例
{
  "status": "SERVING"
}
```

### 日志使用

```go
import "go.uber.org/zap"

logger, _ := zap.NewDevelopment()
sugar := logger.Sugar()

sugar.Infow("Message",
    "key1", "value1",
    "key2", 123,
)
```

---

## 代码规范

### TypeScript

- ✅ 使用 `strict` 模式
- ✅ 使用 ESM 模块（`import`/`export`）
- ✅ 文件扩展名：`.ts` / `.tsx`
- ✅ 导入时包含 `.js` 扩展名（ESM 要求）
- ✅ 使用 `type` 导入类型：`import type { Type } from '...'`

### 命名规范

```typescript
// 文件名：kebab-case
user-profile.ts
project-list.tsx

// 组件名：PascalCase
function ProjectList() {}
export default ProjectList

// 变量/函数：camelCase
const projectId = '123'
function fetchProjects() {}

// 常量：UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3

// 类型/接口：PascalCase
interface Project {}
type TaskStatus = 'pending' | 'done'
```

### Go

- ✅ 遵循标准 Go 项目布局
- ✅ 使用 `gofmt` 格式化代码
- ✅ 包名使用小写单词
- ✅ 导出标识符使用 PascalCase
- ✅ 私有标识符使用 camelCase

---

## 调试技巧

### 前端调试

```typescript
// 使用 React DevTools（浏览器扩展）

// 使用 console.log
console.log('Debug:', data)

// 使用 debugger
debugger

// Vite 支持 source maps，可直接在浏览器调试 TypeScript
```

### API 调试

```typescript
// Fastify 自带 Pino 日志
app.log.info('Info message')
app.log.error('Error message')
app.log.debug({ data }, 'Debug with data')

// 使用 pino-pretty 美化日志（已配置）
```

### 数据库调试

```bash
# 查看 Drizzle 生成的 SQL
cd packages/api
pnpm db:push --verbose

# 使用 Drizzle Studio
pnpm db:studio

# 直接查询
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev \
  -c "SELECT * FROM projects;"
```

### gRPC 调试

```bash
# 使用 grpcurl
grpcurl -plaintext localhost:50051 list
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

---

## 常见问题排查

### 1. 端口已被占用

```bash
# 查找占用端口的进程
lsof -i :3000  # 前端
lsof -i :4000  # API
lsof -i :5432  # PostgreSQL

# 杀死进程
kill -9 <PID>
```

### 2. 数据库连接失败

```bash
# 检查 Docker 容器状态
docker ps

# 查看容器日志
docker logs workgear-postgres

# 重启容器
cd docker
docker-compose restart postgres

# 测试连接
psql postgresql://workgear:workgear_dev_pass@localhost:5432/workgear_dev -c "SELECT 1;"
```

### 3. pnpm approve-builds 警告

```bash
# 批准 esbuild 和 protobufjs 的构建脚本
pnpm approve-builds

# 使用空格选择，回车确认
```

### 4. TypeScript 编译错误

```bash
# 清理并重新安装
pnpm clean
pnpm install

# 检查 TypeScript 版本
pnpm list typescript

# 单独检查各包
cd packages/web && pnpm exec tsc --noEmit
cd packages/api && pnpm exec tsc --noEmit
```

### 5. Go 模块下载慢

```bash
# 配置国内代理（可选）
export GOPROXY=https://goproxy.cn,direct

# 或使用官方代理
export GOPROXY=https://proxy.golang.org,direct

# 重新下载
cd packages/orchestrator
go mod download
```

### 6. Drizzle ORM 初始化错误

确保使用正确的 API（beta 版本）：

```typescript
// ✅ 正确（1.0-beta 单参数对象）
import { drizzle } from 'drizzle-orm/postgres-js'
export const db = drizzle({ client, schema })

// ❌ 错误（旧版 0.x API）
export const db = drizzle(client, { schema })
```

### 8. Drizzle Kit 版本过旧错误

如果遇到 `This version of drizzle-kit is outdated` 错误：

**原因**：`drizzle-orm` 和 `drizzle-kit` 版本不匹配

**解决方案**：
```bash
# 确保 package.json 中 drizzle-orm 和 drizzle-kit 使用相同的 beta 版本
# drizzle-orm: 1.0.0-beta.15-859cf75
# drizzle-kit: 1.0.0-beta.15-859cf75

# 清理并重新安装
rm pnpm-lock.yaml
pnpm install

# 验证
cd packages/api
pnpm db:push
```

> ⚠️ beta 版本号必须带 hash 后缀（如 `1.0.0-beta.15-859cf75`），npm 上不存在不带 hash 的简单版本号。

### 7. 前端无法访问 API

检查 Vite 代理配置：

```typescript
// packages/web/vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:4000',
      changeOrigin: true,
    },
  },
}
```

确保 API Server 正在运行：
```bash
curl http://localhost:4000/api/health
```

---

## 获取帮助

- **文档**: 查看 `docs/` 目录
- **PRD**: `docs/PRD/MVP/`
- **技术规格**: `docs/spec/`
- **Phase 1 报告**: `docs/PHASE1-COMPLETION.md`
- **项目概览**: `README.md`

---

**最后更新**: 2026-02-11  
**适用版本**: Phase 1 (v0.1.0)
