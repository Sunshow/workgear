# WorkGear MVP PRD

> **版本**: 1.0  
> **日期**: 2026-02-11  
> **状态**: Draft

---

## 文档结构

本 MVP PRD 拆分为以下文档：

1. [01-overview.md](./01-overview.md) - 背景、目标与功能范围
2. [02-user-stories.md](./02-user-stories.md) - 用户故事
3. [03-technical-solution.md](./03-technical-solution.md) - 技术方案
4. [04-acceptance-criteria.md](./04-acceptance-criteria.md) - 验收标准
5. [05-risks-and-timeline.md](./05-risks-and-timeline.md) - 风险与时间规划
6. [improvements.md](./improvements.md) - 改进清单（P1 待细化项）

---

## 快速导航

### 核心目标
- 支持单个 Agent（ClaudeCode）按预定义流程完成任务
- 人机协作（Review + 打回机制）
- 看板与流程状态实时同步
- 产物版本管理和追溯

### 关键特性
- 内置 4 个流程模板
- YAML 编辑器 + DAG 实时预览
- WebSocket 实时推送
- 产物追溯链路

### 时间规划
- **总计**: 9 周
- **Phase 1**: 基础设施（2 周）
- **Phase 2**: 看板 + 项目管理 + 流程模板（3 周）
- **Phase 3**: 流程引擎 + Agent 接入（2 周）
- **Phase 4**: 串联 + 打磨（2 周）

---

## 参考文档

- [完整技术规格](../../spec/README.md)
- [架构设计](../../spec/02-architecture.md)
- [流程引擎](../../spec/03-flow-engine.md)
- [Agent 接入层](../../spec/04-agent-layer.md)
- [数据模型](../../spec/06-data-model.md)
