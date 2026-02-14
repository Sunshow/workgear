# 7. 分阶段迭代计划

## 总览

```
Phase A            Phase B              Phase C              Phase 1 (MVP)
P0 收敛            产物模型闭环          多Agent协同           基础骨架
1-2 周             2-3 周               2-4 周               6-8 周
──────────────────────────────────────────────────────────────────────────────
✅ parallel_group  ✅ artifacts 4表     ✅ collab_task节点    ✅ 项目管理CRUD
   执行语义统一    ✅ PRD/Story Schema  ✅ adjudicate节点     ✅ 基础看板
✅ foreach作用域   ✅ 质量门禁节点      ✅ aggregate节点      ✅ 单Agent接入
   与回退定位      ✅ 产物版本管理      ✅ Rubric评分体系       (ClaudeCode)
✅ 执行上下文修正  ✅ 追溯链路          ✅ 协同可视化         ✅ 线性流程执行
   (去除游离ctx)     需求→PRD→Story    ✅ 默认协同策略       ✅ 人工Review节点
✅ DSL校验规则     ✅ 产物API             并行草拟+仲裁+人审  ✅ 消息时间线
                   ✅ 产物审批记录                           ✅ WebSocket实时推送

Phase 2            Phase 3              Phase 4
流程引擎完善        桌面端 + Git集成      生产级能力
4-6 周             4-6 周               4-6 周
──────────────────────────────────────────────────────────────────────────────
✅ 并行节点        ✅ Electron桌面端    ✅ 多用户权限
✅ 条件分支        ✅ Git branch自动管理 ✅ 团队协作
✅ 动态foreach     ✅ PR自动创建/关联    ✅ 审计日志
✅ 打回到任意节点  ✅ Webhook双向同步    ✅ 用量统计
✅ 多Agent并行     ✅ 本地Agent Runtime  ✅ 自定义Agent接入
✅ 子流程          ✅ 离线模式           ✅ 通知集成
✅ 流程可视化编辑器 ✅ 流程模板市场       ✅ CI/CD集成
✅ 变量/表达式系统  ✅ Droid接入    ✅ 性能优化
✅ 持久化状态机    ✅ Outbox副作用控制   ✅ 幂等/回放/检查点
```

---

## Phase A: P0 收敛（1-2 周）

> 目标：修复设计层面的关键缺陷，确保后续实现不会踩坑

### 第1周：执行语义与作用域

- [x] `parallel_group` 新增 `execution_mode` 字段（parallel / pipeline / serial）
- [x] 更新 DSL 示例，所有含顺序依赖的 children 使用 `pipeline` 模式
- [x] 实现 DSL 校验器：检测 children 间数据依赖与 execution_mode 的一致性
- [x] 定义 Scope 模型：`NodeRunIdentifier = node_id + scope_key + iteration_key + attempt`
- [x] `on_reject.goto` 增强为对象，支持 `scope: current_iteration | parent_scope | global`
- [x] `node_runs` 表补充 `scope_key`、`iteration_key`、`idempotency_key` 字段
- [x] 新增唯一约束 `(flow_run_id, node_id, scope_key, iteration_key, attempt)`

### 第2周：执行上下文与恢复

- [x] 修正执行器：严禁 `context.Background()`，统一继承 FlowRun 根 ctx
- [x] 人工等待节点改为"落库即返回"，不阻塞协程
- [x] `flow_runs` 表补充 `resume_token`、`recovery_checkpoint`
- [x] 引擎启动时扫描 `WAITING_HUMAN` / `RUNNING` 状态的 NodeRun，恢复执行
- [x] `node_runs` 表补充租约字段 `locked_by`、`locked_at`、`lock_expires_at`

---

## Phase B: 产物模型 + PRD/Story 闭环（2-3 周）

> 目标：PRD 和 User Story 成为一等实体，可版本管理、审批、追溯

### 第1周：数据模型与 API

- [x] 创建 `artifacts`、`artifact_versions`、`artifact_links`、`artifact_reviews` 四张表
- [x] 实现产物 CRUD API
- [x] 实现产物版本管理（创建新版本、查看历史、版本对比）
- [x] 实现产物引用关系 API（创建/查询引用链路）

### 第2周：Schema 与质量门禁

- [x] 定义 PRD JSON Schema（`schemas/prd.v1.json`）
- [x] 定义 User Story JSON Schema（`schemas/user-story.v1.json`）
- [x] 流程引擎集成：节点配置 `artifact.type` 后自动创建/更新 Artifact
- [x] 自动建立 `derives_from` / `splits_to` 引用关系

### 第3周：前端集成

- [x] Task 详情面板新增"产物"标签页
- [x] 产物版本历史查看与对比
- [x] 追溯链路可视化（需求 → PRD → Story → Task）
- [x] Task 卡片显示关联产物状态

---

## Phase C: 多 Agent 协同（2-4 周）

> 目标：单环节支持多 Agent 协同产出并仲裁

### 第1-2周：协同节点实现

- [x] 实现 `collab_task` 节点（parallel_draft / lead_review / debate 三种模式）
- [x] 实现 `adjudicate` 节点（rubric_score / majority_vote / weighted_vote / reviewer_decides）
- [x] 实现 `aggregate` 节点（concat / merge_by_key / custom）
- [x] 创建 `node_run_attributions` 表，记录每个 Agent 的产出归属
- [x] 实现 Rubric 加载与评分逻辑

### 第3-4周：协同可视化与调优

- [x] 前端展示多 Agent 候选输出对比
- [x] 仲裁报告展示（评分、理由、来源）
- [x] 协同过程时间线（哪个 Agent 何时产出了什么）
- [x] 降级策略测试（评分不达标 → 人工裁决）

---

## Phase 1: MVP（6-8 周）

> 目标：跑通核心链路，一个Agent能按流程完成一个任务

### 第1-2周：基础设施

```
workgear/
├── packages/
│   ├── shared/                    # 共享类型和工具
│   │   ├── src/
│   │   │   ├── types/             # TypeScript类型定义
│   │   │   │   ├── project.ts
│   │   │   │   ├── task.ts
│   │   │   │   ├── workflow.ts
│   │   │   │   └── agent.ts
│   │   │   └── utils/
│   │   └── package.json
│   │
│   ├── web/                       # Web前端
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── kanban/         # 看板组件
│   │   │   │   ├── timeline/      # 消息时间线
│   │   │   │   ├── flow/          # 流程可视化（只读）
│   │   │   │   └── common/
│   │   │   ├── hooks/
│   │   │   ├── stores/            # Zustand状态管理
│   │   │   └── services/          # API调用
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                       # API服务
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── middleware/
│       │   ├── ws/                # WebSocket处理
│       │   └── db/
│       │       ├── migrations/
│       │       └── schema.ts      # Drizzle ORM schema
│       └── package.json
│
├── services/
│   └── orchestrator/              # Go调度服务
│       ├── cmd/
│       │   └── server/
│       │       └── main.go
│       ├── internal/
│       │   ├── engine/            # 流程引擎
│       │   │   ├── executor.go
│       │   │   ├── state.go
│       │   │   └── scheduler.go
│       │   ├── agent/             # Agent管理
│       │   │   ├── adapter.go
│       │   │   ├── claude_code.go
│       │   │   └── registry.go
│       │   └── grpc/              # gRPC服务
│       ├── proto/                 # Protobuf定义
│       └── go.mod
│
├── docker-compose.yml             # 本地开发环境
├── pnpm-workspace.yaml
└── package.json
```

交付物：
- [x] Monorepo搭建（pnpm workspace）
- [x] PostgreSQL + Redis Docker环境
- [x] 数据库Migration（核心表）
- [x] API Server骨架（Express/Fastify + Drizzle）
- [x] Go Orchestrator骨架 + gRPC Proto定义
- [x] Web前端骨架（React + Vite + React Router）
- [x] 基础认证（JWT，先简单实现）

### 第3-4周：看板 + 项目管理

交付物：
- [x] 项目CRUD API + 前端页面
- [x] 看板视图（拖拽排序，用 @dnd-kit）
- [x] Task CRUD（创建、编辑、移动、删除）
- [x] Task详情面板（侧边栏滑出）
- [x] 消息时间线组件（只读展示）

### 第5-6周：流程引擎 MVP + Agent接入

交付物：
- [x] 流程DSL解析器（YAML → 内部DAG结构）
- [x] 线性流程执行器（顺序执行节点）
- [x] ClaudeCode Adapter（子进程方式）
- [x] agent_task 节点类型实现
- [x] human_review 节点类型实现（暂停/恢复）
- [x] human_input 节点类型实现
- [x] 节点状态流转 + WebSocket推送
- [x] Task启动流程：选择模板 → 创建FlowRun → 开始执行

### 第7-8周：串联 + 打磨

交付物：
- [x] 看板列与流程阶段自动映射
- [x] Task卡片显示流程进度
- [x] 流程只读可视化（用 ReactFlow 渲染DAG）
- [x] 人工Review界面（查看Agent输出 → approve/reject）
- [x] 基础打回（回到上一节点）
- [x] 错误处理和重试
- [x] 基础日志和监控

---

## Phase 2: 流程引擎完善（4-6 周）

### 核心能力
- 并行节点执行（parallel_group，含 execution_mode 语义）
- 动态foreach（根据上游输出动态创建并行分支）
- 条件分支（conditional节点）
- 打回到任意节点 + 作用域定位 + 循环次数限制
- 子流程引用（sub_workflow）
- 完整的变量/表达式系统（模板引擎）
- 多Agent并行调度

### 持久化与稳定性（P1-2/P1-3 改进）
- 引擎改为"持久化驱动状态机"（DB 队列 + 无状态 Worker）
- 人工等待节点落库即返回，API 触发 resume
- 并发节点加租约与心跳（防重复执行）
- Integration 节点使用 Outbox 模式发送外部副作用
- 全链路幂等键（FlowRun / NodeRun / Integration 三级）
- Webhook 入站去重（delivery_id + 时间窗口）
- 所有重试策略按节点类型可配置（指数退避 + 抖动）

### 流程可视化编辑器
- 基于ReactFlow的拖拽编辑器
- 节点面板（拖拽添加节点，含新增的 collab_task/adjudicate/aggregate）
- 连线编辑（拖拽连接）
- 节点配置面板（右侧属性编辑）
- DSL ↔ 可视化双向同步
- 流程校验（检测环路、孤立节点、execution_mode 一致性等）

### Agent增强
- Agent健康检查和自动恢复
- 执行超时处理
- Token用量追踪
- Agent输出流式展示

---

## Phase 3: 桌面端 + Git集成（4-6 周）

### Electron桌面端
- 项目选择器（启动页）
- 与Web端共享React组件库
- 本地Agent Runtime（直接管理ClaudeCode进程）
- 轻量编排器（可离线执行简单流程）
- 云端状态同步

### Git深度集成
- 项目绑定Git仓库
- Task启动时自动创建feature branch
- Agent执行时自动commit
- Review通过后自动创建PR
- GitHub/GitLab Webhook接收（含入站去重）
- PR状态反向同步到Task
- Commit message规范化
- 所有 Git 操作通过 Outbox 模式执行（幂等、可重试）

### Droid接入
- Droid Adapter实现
- Droid配置文件生成
- 与ClaudeCode的调度协同

### 流程模板
- 内置模板库（完整开发流水线、Bug修复流程、Code Review流程等）
- 模板导入/导出
- 模板参数化

---

## Phase 4: 生产级能力（4-6 周）

### 多用户与权限
- RBAC权限模型
- 项目级角色（Owner/Admin/Member/Viewer）
- 流程级权限（谁可以approve、谁可以触发）
- API Key管理

### 团队协作
- 实时协作（多人同时查看看板/流程）
- @提及和通知
- 评论系统
- 活动日志

### 通知集成
- 邮件通知
- Slack/钉钉/飞书 Webhook
- 浏览器推送通知

### CI/CD集成
- GitHub Actions触发
- GitLab CI触发
- 自定义Webhook触发
- CI状态回传

### 运维能力
- 审计日志（标准化：谁在何时批准了哪个版本的 PRD/Story）
- Agent用量统计和报表（含成本预算）
- 流程执行分析（耗时、成功率、打回率、协同仲裁统计）
- 系统健康监控
- 数据备份和恢复
- 检查点回放（从任意检查点重放流程）
- 幂等性全链路验证

### 自定义Agent接入
- HTTP/gRPC Agent协议规范
- Agent开发SDK（TypeScript/Python）
- Agent调试工具

---

## 技术选型汇总

| 层级 | 技术 | 说明 |
|------|------|------|
| Web前端 | React 19 + TypeScript + Vite | SPA |
| UI组件 | Shadcn/ui + Tailwind CSS | 可定制 |
| 状态管理 | Zustand | 轻量 |
| 看板拖拽 | @dnd-kit | 无障碍支持好 |
| 流程可视化 | ReactFlow | DAG编辑和展示 |
| 桌面端 | Electron + React | 共享Web组件 |
| API服务 | Node.js + Fastify + TypeScript | 高性能 |
| ORM | Drizzle ORM | 类型安全 |
| 实时通信 | WebSocket (ws) | 前端推送 |
| 调度服务 | Go 1.22+ | 高并发 |
| 内部通信 | gRPC + Protobuf | 类型安全、双向流 |
| 数据库 | PostgreSQL 16 | JSONB支持好 |
| 缓存/队列 | Redis 7 | 任务队列、缓存 |
| 文件存储 | MinIO (S3兼容) | 产出物存储 |
| 包管理 | pnpm workspace | Monorepo |
| 容器化 | Docker Compose | 本地开发 |
| CI | GitHub Actions | 自动化 |
