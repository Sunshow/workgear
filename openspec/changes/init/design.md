# Design: OpenSpec 初始化 — 技术方案

## 概述

本次变更为纯文档初始化，不涉及代码修改。核心工作是建立 OpenSpec 目录结构、配置项目上下文、并为 8 个功能模块编写 Source of Truth 行为规范。

## 模块划分设计

```
openspec/
├── config.yaml                          # 项目上下文 + 规则配置
├── specs/                               # Source of Truth（归档后的正式规范）
│   ├── auth/                            # 用户认证与授权
│   │   └── 2026-02-14-user-authentication.md
│   ├── project/                         # 项目管理
│   │   └── 2026-02-14-project-management.md
│   ├── kanban/                          # 看板与任务管理
│   │   └── 2026-02-14-kanban-board.md
│   ├── flow-engine/                     # 工作流引擎
│   │   ├── 2026-02-14-workflow-dsl.md       # DSL 定义与模板
│   │   └── 2026-02-14-flow-execution.md     # 执行与状态机
│   ├── agent/                           # Agent 编排与执行
│   │   └── 2026-02-14-agent-orchestration.md
│   ├── artifact/                        # 产物管理
│   │   └── 2026-02-14-artifact-management.md
│   ├── api/                             # REST API 层
│   │   └── 2026-02-14-rest-api.md
│   └── orchestrator/                    # Go gRPC 调度服务
│       └── 2026-02-14-grpc-orchestrator.md
├── changes/                             # 变更记录
│   ├── init/                            # 本次初始化变更
│   │   ├── proposal.md
│   │   ├── design.md
│   │   ├── tasks.md
│   │   └── specs/                       # Delta specs (ADDED-*)
│   └── archive/                         # 已归档的变更
└──
```

## 模块划分理由

| 模块 | 对应代码 | 划分依据 |
|------|----------|----------|
| auth | `api/src/routes/auth.ts`, `web/src/stores/auth-store.ts` | 独立的认证子系统 |
| project | `api/src/routes/projects.ts`, `web/src/stores/project-store.ts` | 项目是顶层资源 |
| kanban | `api/src/routes/kanbans.ts`, `api/src/routes/tasks.ts`, `web/src/pages/kanban/` | 看板+任务紧密耦合 |
| flow-engine | `api/src/routes/workflows.ts`, `api/src/routes/flow-runs.ts`, `api/src/routes/node-runs.ts` | 流程引擎是核心，拆为 DSL 和执行两个 spec |
| agent | `orchestrator/internal/agent/`, `api/src/db/schema.ts (agent_configs, agent_roles)` | Agent 是独立子系统 |
| artifact | `api/src/routes/artifacts.ts`, `api/src/db/schema.ts (artifacts, artifact_versions, artifact_links)` | 产物管理独立 |
| api | `api/src/server.ts`, 全局中间件 | API 层横切关注点 |
| orchestrator | `orchestrator/cmd/`, `orchestrator/internal/grpc/` | Go 服务独立进程 |

## 数据流

```
开发者编写需求
    ↓
OpenSpec 创建 change（proposal → specs → design → tasks）
    ↓
实施代码变更
    ↓
归档：delta specs → Source of Truth（openspec/specs/）
    ↓
下次变更引用 Source of Truth 作为基线
```

## Spec 编写规范

- 每个 spec 文件聚焦一个独立功能或能力
- 使用 Given/When/Then 格式描述行为场景
- 场景覆盖正常流程和异常/边界情况
- 引用具体的 HTTP 方法、路径、状态码
- 引用具体的状态机转换
- 引用具体的数据库表和字段

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| MODIFIED | `openspec/config.yaml` | 添加项目上下文和规则 |
| ADDED | `openspec/specs/auth/2026-02-14-user-authentication.md` | 认证规范 |
| ADDED | `openspec/specs/project/2026-02-14-project-management.md` | 项目管理规范 |
| ADDED | `openspec/specs/kanban/2026-02-14-kanban-board.md` | 看板规范 |
| ADDED | `openspec/specs/flow-engine/2026-02-14-workflow-dsl.md` | 工作流 DSL 规范 |
| ADDED | `openspec/specs/flow-engine/2026-02-14-flow-execution.md` | 流程执行规范 |
| ADDED | `openspec/specs/agent/2026-02-14-agent-orchestration.md` | Agent 规范 |
| ADDED | `openspec/specs/artifact/2026-02-14-artifact-management.md` | 产物管理规范 |
| ADDED | `openspec/specs/api/2026-02-14-rest-api.md` | REST API 规范 |
| ADDED | `openspec/specs/orchestrator/2026-02-14-grpc-orchestrator.md` | gRPC 调度规范 |
| ADDED | `openspec/changes/init/proposal.md` | 变更提案 |
| ADDED | `openspec/changes/init/design.md` | 技术方案 |
| ADDED | `openspec/changes/init/tasks.md` | 任务清单 |
| ADDED | `openspec/changes/init/specs/` | Delta specs |
