# AGENTS.md

WorkGear 是一个 AI Agent 工作流编排平台，支持 ClaudeCode 等 Agent 按预定义流程执行任务，配合人工 Review 和看板管理。

---

## 核心规则

### 技术栈（不可更换）

| 层 | 技术 | 版本 |
|---|------|------|
| 运行时 | Node.js | >= 22 |
| 包管理 | pnpm workspace (monorepo) | >= 10 |
| 前端 | React + Vite + Tailwind CSS + TypeScript | 19 / 7 / 4 / 5.9 |
| API | Fastify + Drizzle ORM + PostgreSQL | 5 / 1.0-beta.15 / 18 |
| 调度 | Go + gRPC | >= 1.25 / 1.70 |
| 缓存 | Redis | 8.4 |

### 代码规范

- TypeScript 使用 `strict` 模式，全部 ESM 模块
- import 路径必须带 `.js` 扩展名：`import { db } from '../db/index.js'`
- 类型导入使用 `import type`：`import type { FastifyInstance } from 'fastify'`
- Drizzle ORM 使用 beta API：`drizzle({ client, schema })`，不要用旧版的双参数形式
- Fastify 路由使用 plugin 模式注册，通过 `app.register(routes, { prefix })` 挂载
- Go 代码遵循标准项目布局（`cmd/` + `internal/`）
- Tailwind CSS 4 不再使用 `tailwind.config.ts`，所有主题配置写在 `src/index.css` 的 `@theme inline` 块中
- CSS 入口文件使用 `@import "tailwindcss"` 而非旧版的 `@tailwind base/components/utilities`
- 使用 `@tailwindcss/vite` 插件集成 Vite，不需要 PostCSS 配置
- 自定义颜色通过 CSS 变量 + `@theme inline` 映射：`--color-primary: hsl(var(--primary))`
- 前端 UI 组件基于 Shadcn/ui 模式（Radix UI + Tailwind），组件位于 `packages/web/src/components/ui/`

### 架构约束

```
浏览器 → Vite(:3000) --/api代理-→ Fastify(:4000) --gRPC-→ Go Orchestrator(:50051)
                                       ↓
                                  PostgreSQL(:5432) + Redis(:6379)
```

- 数据库 Schema 唯一定义位置：`packages/api/src/db/schema.ts`
- Protobuf 定义位置：`packages/shared/proto/orchestrator.proto`
- 前端所有 API 调用走 `/api` 前缀，Vite 自动代理到 API Server
- 不要在前端直接连数据库或 gRPC

---

## 项目结构

```
packages/
  web/           → React 前端（@workgear/web）
  api/           → Fastify API Server（@workgear/api）
  orchestrator/  → Go gRPC 调度服务
  shared/        → 共享 Protobuf 定义
docker/          → Docker Compose（PostgreSQL + Redis）
docs/            → 所有文档
scripts/         → 工具脚本
```

---

## 文档索引

按需查阅，不要一次性全部读取。

### 产品需求

| 场景 | 文档 | 说明 |
|------|------|------|
| 了解产品目标和功能范围 | `docs/PRD/MVP/01-overview.md` | 背景、目标、功能边界 |
| 了解用户故事 | `docs/PRD/MVP/02-user-stories.md` | 用户角色和使用场景 |
| 了解验收标准 | `docs/PRD/MVP/04-acceptance-criteria.md` | 功能验收条件 |
| 了解排期和风险 | `docs/PRD/MVP/05-risks-and-timeline.md` | 4 个 Phase 的时间规划 |

### 技术设计

| 场景 | 文档 | 说明 |
|------|------|------|
| 了解整体架构 | `docs/spec/02-architecture.md` | 服务职责、通信协议、部署架构 |
| 开发流程引擎 | `docs/spec/03-flow-engine.md` | DSL 设计、节点类型、状态机、打回机制 |
| 接入 Agent | `docs/spec/04-agent-layer.md` | Adapter 接口、ClaudeCode 适配器 |
| 开发看板功能 | `docs/spec/05-board-flow-integration.md` | 看板与流程融合、Task 生命周期 |
| 修改数据库 | `docs/spec/06-data-model.md` | 完整表结构设计、产物模型 |
| 开发 API | `docs/spec/08-api-design.md` | REST API、WebSocket 事件、gRPC Proto |
| 了解实现细节 | `docs/spec/09-implementation-details.md` | 执行器、Outbox Worker、WebSocket 推送 |
| 了解安全要求 | `docs/spec/11-security.md` | Agent 沙箱、数据分级、审计 |
| Phase 3 实施方案 | `docs/spec/13-phase3-implementation.md` | 流程引擎 + Mock Agent 实施细节 |
| Phase 4 实施方案 | `docs/spec/14-phase4-agent-implementation.md` | 真实 Agent 调用（Docker 容器化）实施细节 |

### 开发指引

| 场景 | 文档 | 说明 |
|------|------|------|
| 环境搭建和日常开发 | `DEVELOPMENT.md` | 前置要求、启动命令、脚本列表、调试技巧、常见问题 |
| 了解迭代计划 | `docs/spec/07-roadmap.md` | Phase A-C + Phase 1-4 详细计划 |
| Phase 1 实施方案 | `docs/spec/12-phase1-implementation.md` | 当前阶段的技术方案和版本选型 |
| Phase 1 完成状态 | `docs/PHASE1-COMPLETION.md` | 已完成内容、待办事项 |

---

## 当前状态：Phase 1 已完成

已实现：
- Monorepo 骨架、Docker 环境、数据库 17 张表
- API Server 基础 CRUD（projects / boards / tasks）
- Go Orchestrator 健康检查（Mock 模式）
- 前端空壳页面

未实现（Phase 2+）：
- 看板拖拽、流程模板库、YAML 编辑器、DAG 预览
- WebSocket 实时推送
- 流程引擎核心逻辑、Agent 接入
- Protobuf Go 代码生成
