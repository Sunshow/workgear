# Tasks: 流程管理页面返回看板导航

## 模块：Web 前端 (packages/web)

### 页面修改

- [x] 在 `packages/web/src/pages/workflows/index.tsx` 中导入 `ArrowLeft` 图标
- [x] 在流程管理页面 header 左侧添加返回按钮，点击导航到 `/projects/${projectId}/kanban`
- [x] 确保按钮样式与工作流编辑器返回按钮一致（`variant="ghost" size="icon"`）

### 测试验证

- [x] 验证从看板页面进入流程管理后，点击返回按钮可回到看板
- [x] 验证直接通过 URL 访问流程管理页面，返回按钮仍可正常工作
- [x] 验证从工作流编辑器 → 流程管理 → 看板的完整导航链路

## 模块：OpenSpec 文档

- [x] 更新 `openspec/specs/kanban/2026-02-14-kanban-board.md`，补充流程管理页面返回导航的场景描述
