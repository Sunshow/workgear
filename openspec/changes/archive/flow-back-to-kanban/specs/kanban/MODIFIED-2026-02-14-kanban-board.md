# Delta Spec: 看板与流程管理页面导航增强

> **Type:** MODIFIED
> **Module:** kanban
> **Date:** 2026-02-14
> **Change:** flow-back-to-kanban

## 概述

修改看板模块的导航行为规格，补充流程管理页面到看板页面的返回导航场景。

---

## 场景

### Scenario 1: 用户从流程管理页面返回看板

```gherkin
Given 用户当前在流程管理页面 /projects/:projectId/workflows
When 用户点击页面头部左侧的"返回看板"按钮（ArrowLeft 图标）
Then 页面导航到 /projects/:projectId/kanban
And 看板页面正常加载，显示该项目的看板数据
```

### Scenario 2: 返回按钮在流程管理页面始终可见

```gherkin
Given 用户通过任意路径进入流程管理页面 /projects/:projectId/workflows
When 页面加载完成
Then 页面 header 左侧显示一个 ArrowLeft 图标按钮
And 按钮可点击，hover 时有视觉反馈
```

### Scenario 3: 流程管理页面导航链路完整性

```gherkin
Given 用户在看板页面 /projects/:projectId/kanban
When 用户点击"流程管理"按钮进入流程管理页面
And 用户点击"返回看板"按钮
Then 用户回到看板页面 /projects/:projectId/kanban
And 整个导航过程无需依赖浏览器后退按钮
```

### Scenario 4: 从工作流编辑器逐级返回到看板

```gherkin
Given 用户在工作流编辑器页面 /projects/:projectId/workflows/:workflowId/edit
When 用户点击编辑器的返回按钮回到流程管理页面
And 用户再点击流程管理页面的"返回看板"按钮
Then 用户回到看板页面 /projects/:projectId/kanban
And 导航层级清晰：看板 → 流程管理 → 工作流编辑器
```

---

## UI 规格

### 返回按钮

| 属性 | 值 |
|------|-----|
| 组件 | `<Button variant="ghost" size="icon">` |
| 图标 | `<ArrowLeft className="h-4 w-4" />` |
| 位置 | 页面 header 左侧，项目名称之前 |
| 行为 | `navigate(/projects/${projectId}/kanban)` |

### 设计参考

与工作流编辑器页面（`workflow-editor.tsx`）的返回按钮保持一致的交互模式和视觉风格。
