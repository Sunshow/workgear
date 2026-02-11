# 6. 技术风险与缓解

| 风险 | 严重性 | 缓解措施 |
|------|--------|----------|
| ClaudeCode 输出格式不稳定 | High | 使用 output_schema 约束，解析失败时重试 |
| 流程执行中服务重启导致状态丢失 | High | 使用 resume_token 和 recovery_checkpoint 恢复 |
| WebSocket 连接断开 | Medium | 前端自动重连，断线期间消息通过 REST API 补全 |
| 并发执行导致数据竞争 | Medium | 使用数据库锁和唯一约束 |

---

# 7. 时间规划

## Phase 1: 基础设施（2 周）
- Monorepo 搭建
- 数据库 Migration
- API Server 骨架
- Go Orchestrator 骨架
- Web 前端骨架
- 退出标准：可创建项目并成功创建首个 FlowRun（mock 执行）

> **发布前置条件**：发布前必须完成 [improvements.md](./improvements.md) 中所有勾选项。

## Phase 2: 看板 + 项目管理 + 流程模板（3 周）
- 项目 CRUD
- 看板视图
- Task CRUD
- Task 详情面板
- 流程模板库（4 个内置模板）
- 模板参数配置表单
- YAML 编辑器 + DAG 预览
- 退出标准：看板与 Task 全链路可用，拖拽后状态持久化；可从模板创建流程并保存

## Phase 3: 流程引擎 + Agent 接入（2 周）
- 流程 DSL 解析
- 线性流程执行器
- ClaudeCode Adapter
- 节点类型实现
- 退出标准：示例流程可从 `input_requirement` 跑到 `review_code`（含一次 Reject 回退）

## Phase 4: 串联 + 打磨（2 周）
- 看板与流程融合
- 人工 Review 界面
- 打回机制
- 产物管理
- 消息时间线
- WebSocket 推送
- 退出标准：满足 5.1~5.4 验收条目，完成 MVP 发布评审

**总计：9 周**

---

# 8. 成功指标

- 可完整跑通"需求输入 → Agent 分析 → 人工确认 → Agent 执行 → 人工 Review"流程
- 产物追溯链路完整（Requirement → PRD → Task）
- 流程执行状态实时可见
- 打回机制可正常工作
- 代码覆盖率 > 60%
- 核心 API 响应时间 < 2s

---

# 附录

## A. 参考文档

- [架构设计](../../spec/02-architecture.md)
- [流程引擎](../../spec/03-flow-engine.md)
- [Agent 接入层](../../spec/04-agent-layer.md)
- [看板与流程融合](../../spec/05-board-flow-integration.md)
- [数据模型](../../spec/06-data-model.md)
- [迭代计划](../../spec/07-roadmap.md)

## B. Schema 定义

- [PRD Schema](../../spec/schemas/prd.v1.json)
- [User Story Schema](../../spec/schemas/user-story.v1.json)
- [PRD Quality Rubric](../../spec/rubrics/prd-quality.v1.yaml)
