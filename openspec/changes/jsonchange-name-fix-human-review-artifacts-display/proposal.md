# Proposal: 修复人工审核节点产物展示问题

## 背景

在 WorkGear 工作流引擎中，人工审核（HumanReview）节点用于在工作流执行过程中暂停并等待人工介入审核。当前实现中，人工审核节点关联的产物（artifacts）在看板任务详情面板中无法正确展示，导致审核人员无法查看需要审核的内容。

根据现有的产物管理规范（openspec/specs/artifact/），产物查询需要通过 `GET /api/artifacts?taskId={taskId}` 接口获取，但人工审核节点的产物展示逻辑存在以下问题：

1. 产物查询范围不正确，可能未正确关联到审核节点对应的 taskId
2. 产物类型过滤逻辑缺失，导致展示了不相关的产物
3. 前端 ArtifactsTab 组件未正确处理人工审核场景的产物数据

这导致审核人员在看板界面无法看到需要审核的 PRD、Spec、Code 等产物，严重影响工作流的可用性。

## 目标

1. 修复人工审核节点产物查询逻辑，确保正确关联 taskId
2. 完善产物类型过滤，只展示与审核相关的产物类型
3. 优化前端 ArtifactsTab 组件，正确渲染人工审核场景的产物列表
4. 确保产物版本历史和关系链接在审核场景下正常工作
5. 添加必要的错误处理和空状态提示

## 影响范围

### 受影响的文件

| 路径 | 变更类型 | 说明 |
|------|---------|------|
| `packages/api/src/routes/artifacts.ts` | MODIFIED | 修复产物查询逻辑，支持人工审核场景 |
| `packages/web/src/components/kanban/TaskDetail/ArtifactsTab.tsx` | MODIFIED | 优化产物展示组件，处理审核场景 |
| `packages/web/src/components/kanban/TaskDetail/SpecArtifactViewer.tsx` | MODIFIED | 增强产物查看器，支持审核模式 |

### 受影响的 Packages

- `@workgear/api` - API 层产物查询逻辑
- `@workgear/web` - 前端看板产物展示组件

### 数据库影响

- 无 schema 变更
- 仅涉及现有 `artifacts`、`artifact_versions`、`artifact_links` 表的查询优化

## 非目标

- 不修改产物管理的核心数据模型
- 不引入新的产物类型
- 不改变工作流引擎的人工审核节点执行逻辑
- 不涉及产物权限控制（假设审核人员有权查看所有关联产物）
- 不优化产物上传和版本创建流程
