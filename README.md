# WorkGear

一个让 AI Agent 和人类协作完成研发任务的平台。

你可以把它理解为"给 AI Agent 用的看板 + 流程引擎"：定义一个流程（比如"需求分析 → 写 PRD → 拆 Story → 写代码 → Review → 测试"），然后让多个 Agent 按流程协作，人类在关键节点介入审核或打回重来。

当前仓库以**技术规格文档**为主，已完成多轮架构评审与增量收口，可作为后续实现阶段的基线。

## 为什么做这个

- 现有 AI Agent 工具大多是"单 Agent 单任务"，缺少多 Agent 协作与流程编排能力
- 研发流程天然是多阶段、多角色、需要人机协作的，但缺少统一的编排平台
- 需求、PRD、Story、代码、PR 之间的追溯链路经常断裂，难以回溯

## 核心能力

### 1. 流程编排

- 用 YAML 定义流程（支持并行、条件分支、打回重试、人工审核）
- 支持多种节点类型：Agent 任务、人工审核、多 Agent 协同、仲裁、聚合等
- 流程可视化 + 实时状态推送

### 2. 多 Agent 协同

- 同一环节可以让多个 Agent 独立产出，然后按质量评分选最优（比如让 3 个 Agent 各写一版 PRD，自动评分选最好的）
- 支持"主写 + 审稿人"模式（一个 Agent 写，其他 Agent 提改进意见）
- 支持辩论模式（Agent 之间互评，最后裁决）

### 3. 产物追溯

- 需求、PRD、User Story、代码、PR 都是一等公民，有版本管理和引用关系
- 可以从一个 Task 回溯到最初的需求文本，或者从 PRD 看到它派生出了哪些 Story

### 4. 看板 + Git 集成

- Task 卡片自动关联流程状态、产物、Git 分支和 PR
- 流程节点完成后自动推进看板列
- 支持 GitHub/GitLab Webhook 双向同步

### 5. 本地 + 云端混合

- 桌面端可以用本地 Agent（比如本机的 ClaudeCode）
- 云端 Web 只能调用远程 Agent（不会直接触达你机器上的进程）
- 同一个流程可以混用不同类型的 Agent（ClaudeCode、Codex、自定义 HTTP Agent 等）

### 6. 稳定性保障

- 流程执行状态持久化到数据库，服务重启后可以恢复
- 人工审核节点不会阻塞系统（落库等待，审核完再继续）
- Git 操作、Webhook 调用等外部副作用有幂等保障，重试不会重复执行

## 仓库结构

```text
.
├── docs/
│   ├── spec/      # 规格与实现设计文档
│   └── reviews/   # 各轮评审报告
└── README.md
```

## 文档索引

### 规格文档（`docs/spec/`）

- `docs/spec/README.md`：总览与索引
- `docs/spec/02-architecture.md`：系统架构
- `docs/spec/03-flow-engine.md`：流程 DSL 与引擎语义
- `docs/spec/04-agent-layer.md`：Agent 接入层与执行器模型
- `docs/spec/05-board-flow-integration.md`：看板与流程融合
- `docs/spec/06-data-model.md`：数据库模型
- `docs/spec/07-roadmap.md`：迭代路线图
- `docs/spec/08-api-design.md`：REST / WebSocket / gRPC 设计
- `docs/spec/09-implementation-details.md`：关键实现细节
- `docs/spec/10-improvements.md`：改进项收口追踪
- `docs/spec/11-security.md`：安全与运行域隔离

### 评审报告（`docs/reviews/`）

按时间戳持续记录设计评审与增量复审过程，可用于审计与决策追溯。

## 当前状态

- ✅ 规格方案已完成多轮 review 与关键问题收口
- ✅ 多 Agent 类型 + 多执行器 + 本地/云端执行域边界已明确
- ✅ 可进入实现冻结与工程落地阶段

## 下一步建议

1. **先跑通最小闭环**：需求输入 → Agent 写 PRD → 人工审核 → Agent 拆 Story → 创建 Task
2. **参考 `docs/spec/07-roadmap.md`** 按 Phase A-C + Phase 1-4 分阶段推进
3. **用 `docs/spec/10-improvements.md`** 作为实现跟踪清单（28 个问题已全部收口）
4. **初始化 Monorepo**：按 `docs/spec/07-roadmap.md` 的目录结构搭建 `packages/web`、`packages/api`、`orchestrator` 等

## 技术栈（规划）

- **Web 前端**：React + TypeScript + Vite
- **API 服务**：Node.js + Fastify + Drizzle ORM
- **流程引擎**：Go + gRPC
- **数据库**：PostgreSQL
- **桌面端**：Electron（共享 Web 组件）

## 说明

- 本仓库当前**只有规格文档**，没有可运行代码
- 规格已完成 6 轮评审，28 个问题全部收口，可以开始编码了
- 如果你想贡献代码或提建议，欢迎提 Issue 或 PR

