# Proposal: OpenSpec 初始化 — WorkGear Source of Truth

## 背景

WorkGear 是一个 AI Agent 工作流编排平台，已完成 Phase 1 基础设施建设（Monorepo 骨架、17 张数据库表、基础 CRUD API、Go Orchestrator 骨架、前端空壳页面），并在 Phase 2-4 中逐步实现了看板、流程引擎、Agent 调用等核心功能。

项目拥有完善的 PRD 和技术规格文档（docs/PRD/ 和 docs/spec/），但缺乏结构化的行为规范（Spec）来作为功能的 Source of Truth。随着项目复杂度增长，需要引入 OpenSpec 规范驱动开发方法论，确保每个功能模块都有清晰、可验证的行为描述。

## 目标

1. 初始化 OpenSpec 目录结构和配置文件
2. 按功能模块划分 specs 子目录（8 个模块）
3. 为项目所有已实现的核心功能编写初始 Source of Truth specs
4. 使用 Given/When/Then 格式描述行为规范，覆盖所有关键场景
5. 建立后续变更的规范化流程基础

## 影响范围

### 新增文件

| 路径 | 说明 |
|------|------|
| `openspec/config.yaml` | 更新配置，添加项目上下文和规则 |
| `openspec/specs/auth/` | 用户认证与授权规范 |
| `openspec/specs/project/` | 项目管理规范 |
| `openspec/specs/kanban/` | 看板与任务管理规范 |
| `openspec/specs/flow-engine/` | 工作流引擎规范（DSL + 执行） |
| `openspec/specs/agent/` | Agent 编排与执行规范 |
| `openspec/specs/artifact/` | 产物管理与版本追踪规范 |
| `openspec/specs/api/` | REST API 层规范 |
| `openspec/specs/orchestrator/` | Go gRPC 调度服务规范 |

### 受影响的 Packages

- 无代码变更，仅新增文档

## 非目标

- 不修改任何现有代码
- 不引入新的技术依赖
- 不覆盖尚未实现的 Phase 2+ 功能的详细实现 spec（仅记录已实现部分）
- 不替代现有的 docs/PRD 和 docs/spec 文档（OpenSpec 是行为规范层，与设计文档互补）
