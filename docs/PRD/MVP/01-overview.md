# 1. 背景与目标

## 1.1 背景

当前软件开发中，AI Agent（如 ClaudeCode）已能独立完成代码编写、Review 等任务，但缺乏：

- **多 Agent 协作编排**：无法定义复杂的多步骤工作流，让不同 Agent 按流程协作
- **人机协作机制**：Agent 产出需要人工 Review/确认，但缺乏标准化的打回、重试机制
- **产物追溯**：需求 → PRD → User Story → 代码变更的链路不透明，难以追溯
- **项目管理融合**：看板管理与 Agent 自动化割裂，无法统一视图

## 1.2 目标

构建 **WorkGear MVP**，实现：

### 核心目标（P0）
- 支持单个 Agent（ClaudeCode）按预定义流程完成任务
- 人工可在流程关键节点 Review 并打回
- 看板与流程状态实时同步
- 产物（PRD/User Story）可版本管理和追溯
- 明确单账号协作模式（Owner 账号登录）

### 次要目标（P1）
- 流程执行状态实时推送到前端
- 消息时间线记录完整执行过程
- Git 分支自动创建和管理

---

# 2. 功能范围

## 2.1 范围内（In Scope）

### 2.1.1 项目与看板管理
- 项目 CRUD（创建、查看、编辑、删除）
- 看板视图（列表展示，拖拽排序）
- Task CRUD（创建、编辑、移动列、删除）
- Task 详情面板（侧边栏滑出）
- 登录模式：单账号（Owner）登录，不包含多用户权限模型

### 2.1.2 流程引擎（线性流程）
- 流程 DSL 解析（YAML → 内部线性执行图，受限 DAG）
- 支持节点类型：
  - `agent_task`：Agent 执行节点（spec/execute/review 模式）
  - `human_input`：人工输入节点（表单）
  - `human_review`：人工审核节点（approve/reject/edit）
- 线性流程执行（顺序执行节点，不支持并行）
- 基础打回机制（回到上一节点，次数可按节点配置 `max_loops`）
- 节点状态流转（pending → running → completed/failed/rejected）
- `human_review.edit` 语义：人工直接编辑当前审核目标并保存为新版本，同时更新被审核节点的输出（`node_runs.output`），确保下游引用自动生效。节点状态记为 completed，并继续流转到下一节点。`edit` 语义固定为"编辑后继续"，无需额外配置 `on_edit`，不触发打回

### 2.1.3 Agent 接入
- ClaudeCode Adapter（子进程方式）
- Agent 角色配置（requirement-analyst、code-reviewer 等）
- Agent 输出结构化解析

### 2.1.4 产物管理
- 产物类型：requirement、prd、user_story
- 产物版本管理（创建新版本、查看历史）
- 产物引用关系（derives_from、splits_to）
- 产物在 Task 详情中展示

### 2.1.5 实时通信
- WebSocket 推送流程状态变化
- 消息时间线（agent_message、human_message、status_change、review_action）

### 2.1.6 Git 集成（基础）
- Task 启动时自动创建 feature branch
- 分支命名规则：`feat/task-{id}-{slug}`
- 分支信息在 Task 卡片展示

### 2.1.7 流程编排交互
- 内置 4 个流程模板（简单开发流水线、Bug 修复流程、纯 Code Review、需求分析流程）
- 模板参数配置表单（Agent 角色、打回次数等可调参数）
- YAML 编辑器（Monaco Editor，语法高亮 + 实时校验）
- 右侧 DAG 只读预览（ReactFlow，实时同步 YAML 变更）
- 用户流程：选择模板 → 填写参数 → 微调 YAML → 保存

## 2.2 范围外（Out of Scope）

### MVP 不包含：
- ❌ 并行节点执行（parallel_group）
- ❌ 动态 foreach（根据上游输出动态创建分支）
- ❌ 条件分支（conditional）
- ❌ 多 Agent 协同节点（collab_task、adjudicate、aggregate）
- ❌ 子流程引用（sub_workflow）
- ❌ 流程可视化拖拽编辑器（只支持 YAML 编辑 + 只读 DAG 预览）
- ❌ 流程模板市场（用户上传/分享模板）
- ❌ 流程版本对比（YAML diff）
- ❌ 其他 CLI Agent 接入（如 Droid）
- ❌ 自定义 Agent 接入（HTTP/gRPC）
- ❌ 桌面端（Electron）
- ❌ PR 自动创建
- ❌ Webhook 双向同步
- ❌ 多用户权限管理（MVP 只支持单用户）
- ❌ 通知集成（邮件/Slack）
- ❌ 审计日志
- ❌ 用量统计
