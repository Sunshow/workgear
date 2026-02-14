# WorkGear - 多Agent协作编排平台

## 技术规格文档 v1.0

> 一个支持多AI Agent自定义编排的项目协作平台，融合看板管理与自动化流程引擎。

---

## 目录

1. [系统概览](#1-系统概览)
2. [架构设计](#2-架构设计)
3. [流程编排引擎](#3-流程编排引擎)
4. [Agent接入层](#4-agent接入层)
5. [看板与流程融合](#5-看板与流程融合)
6. [数据模型](#6-数据模型)
7. [分阶段迭代计划](#7-分阶段迭代计划)

---

## 1. 系统概览

### 1.1 产品形态

| 形态 | 技术栈 | 说明 |
|------|--------|------|
| Web端 | React + TypeScript + Vite | 多项目管理、Agent编排、看板、流程可视化 |
| 桌面端 | Electron + React | 启动时选择项目，本地Agent执行环境 |
| 调度服务 | Go | 流程引擎、Agent调度、任务队列 |
| API服务 | Node.js + TypeScript | Web API、WebSocket推送、业务逻辑 |
| 数据库 | PostgreSQL | 多用户协作数据持久化 |

### 1.2 核心能力

- **多Agent编排**：支持ClaudeCode等CLI Agent可扩展接入
- **流程引擎**：DSL定义 + 可视化DAG编排，支持条件分支、打回、并行
- **人机协作**：流程节点支持人工Review/编辑/确认，类似Spec模式
- **看板融合**：Task与流程节点绑定，启动任务自动触发流程
- **Git集成**：项目绑定Git仓库，Task自动关联branch/PR

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [02-architecture.md](./02-architecture.md) | 整体架构、服务职责、通信协议、桌面端架构 |
| [03-flow-engine.md](./03-flow-engine.md) | 流程DSL设计、节点类型、状态机、打回机制、表达式系统、多Agent协同节点 |
| [04-agent-layer.md](./04-agent-layer.md) | Agent Adapter接口、ClaudeCode/Droid/Human适配器、Agent Registry、协同协议 |
| [05-kanban-flow-integration.md](./05-kanban-flow-integration.md) | 看板与流程融合、Task生命周期、Git集成、消息时间线、产物追溯 |
| [06-data-model.md](./06-data-model.md) | 完整数据库表结构（PostgreSQL）、产物模型、Outbox模式 |
| [07-roadmap.md](./07-roadmap.md) | Phase A-C + Phase 1-4 迭代计划、项目结构、技术选型汇总 |
| [08-api-design.md](./08-api-design.md) | REST API、WebSocket事件、gRPC Proto定义、产物/协同/检查点API |
| [09-implementation-details.md](./09-implementation-details.md) | 流程引擎执行器（持久化状态机）、协同节点、Outbox Worker、WebSocket推送 |
| [10-improvements.md](./10-improvements.md) | 改进方案汇总（基于设计评审报告） |
| [11-security.md](./11-security.md) | Agent沙箱、数据分级、审计日志、Prompt注入防护 |
| [schemas/prd.v1.json](./schemas/prd.v1.json) | PRD JSON Schema |
| [schemas/user-story.v1.json](./schemas/user-story.v1.json) | User Story JSON Schema |
| [rubrics/prd-quality.v1.yaml](./rubrics/prd-quality.v1.yaml) | PRD 质量评估 Rubric |

---

## 假想流程对应关系

```
用户假想流程                          系统实现
──────────────────────────────────────────────────────
1. 提交需求                    →  human_input 节点 + Task创建
2. Agent分析需求并分发          →  agent_task (requirement-analyst角色)
3. 拆解需求转换成可执行Task     →  agent_task + 动态创建SubTask
4. Agent Plan/Spec             →  parallel_group + agent_task (mode:spec)
5. Review Spec                 →  human_review 节点 (approve/reject/edit)
6. Agent执行                   →  parallel_group + agent_task (mode:execute)
7. Agent Review                →  agent_task (code-reviewer角色) + human_review
8. 测试验收                    →  agent_task (qa-engineer角色)
9. 二次Review                  →  agent_task + human_review (打回机制)
10. 最终确认 + CI              →  human_review + integration (github_actions)
```
