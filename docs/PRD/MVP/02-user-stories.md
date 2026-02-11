# 3. 用户故事

## US-001: 创建项目和看板

**As a** 开发者  
**I want** 创建项目并配置看板  
**So that** 可以开始管理任务

**验收标准**：
- **Given** Owner 账号已登录系统
- **When** 点击"新建项目"，填写项目名称、描述、Git 仓库地址
- **Then** 项目创建成功，自动创建默认看板（Backlog、In Progress、Review、Done）

---

## US-002: 创建任务并启动流程

**As a** 开发者  
**I want** 创建任务并选择流程模板启动  
**So that** Agent 可以按流程自动执行

**验收标准**：
- **Given** 项目已创建，存在流程模板
- **When** 在 Backlog 列创建 Task，点击"启动任务"，选择流程模板
- **Then** 创建 FlowRun 实例，流程开始执行，Task 卡片显示流程进度

---

## US-003: Agent 执行任务节点

**As a** 系统  
**I want** 调度 ClaudeCode 执行 agent_task 节点  
**So that** 自动完成代码分析、编写、Review

**验收标准**：
- **Given** FlowRun 执行到 agent_task 节点
- **When** 引擎调度 ClaudeCode Adapter
- **Then** Agent 执行完成，输出结构化结果，节点状态变为 completed

---

## US-004: 人工 Review 并打回

**As a** 开发者  
**I want** Review Agent 产出并在不满意时打回  
**So that** Agent 可以根据反馈重新执行

**验收标准**：
- **Given** FlowRun 执行到 human_review 节点
- **When** 前端显示 Agent 输出，用户点击"Reject"并填写反馈
- **Then** 流程回退到上一节点，注入反馈上下文，重新执行（次数按节点配置的 `max_loops`）

---

## US-005: 查看产物版本历史

**As a** 开发者  
**I want** 查看 PRD/User Story 的版本历史  
**So that** 可以追溯需求演变过程

**验收标准**：
- **Given** Task 关联了 PRD 产物
- **When** 在 Task 详情"产物"标签页点击"版本历史"
- **Then** 显示所有版本列表，可查看每个版本的内容和变更说明

---

## US-006: 实时查看流程执行状态

**As a** 开发者  
**I want** 实时看到流程执行进度和 Agent 输出  
**So that** 了解任务当前状态

**验收标准**：
- **Given** FlowRun 正在执行
- **When** 打开 Task 详情面板
- **Then** 通过 WebSocket 实时推送节点状态变化，消息时间线实时更新

---

## US-007: 从模板创建流程

**As a** 开发者  
**I want** 从内置模板创建流程并微调参数  
**So that** 快速配置适合项目的工作流

**验收标准**：
- **Given** 用户进入项目的流程管理页面
- **When** 点击"创建流程"，选择内置模板，填写参数，进入 YAML 编辑器
- **Then** 模板渲染为 YAML，右侧实时预览 DAG 图，校验通过后可保存

---

## US-008: 取消正在执行的流程

**As a** 开发者  
**I want** 取消正在执行的流程  
**So that** 可以停止错误的任务执行

**验收标准**：
- **Given** FlowRun 正在执行
- **When** 用户点击"取消流程"
- **Then** 流程标记为 cancelled，停止后续节点调度，当前执行节点尝试优雅终止

---

## US-009: 从失败点恢复流程

**As a** 开发者  
**I want** 从失败点恢复流程  
**So that** 不需要从头重新执行

**验收标准**：
- **Given** FlowRun 因 Agent 失败而中断
- **When** 用户点击"重试"
- **Then** 从失败节点重新执行，保留之前成功节点的输出

---

## US-010: 处理 Git 分支创建失败

**As a** 系统  
**I want** 处理 Git 分支创建失败的情况  
**So that** 流程可以优雅降级或提示用户

**验收标准**：
- **Given** Task 启动时 Git 分支创建失败（如分支已存在）
- **When** 系统检测到失败
- **Then** 记录错误到 timeline，提示用户手动处理或使用已有分支
