# Design: 流程管理页面返回看板导航

## 技术方案

### 方案概述

在流程管理页面（WorkflowsPage）的 header 区域添加返回按钮，复用工作流编辑器中已有的返回按钮模式。这是一个纯前端 UI 变更，无需后端配合。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 导航方式 | `useNavigate()` 编程式导航 | 与项目中现有模式一致（workflow-editor.tsx） |
| 按钮样式 | `variant="ghost" size="icon"` | 与工作流编辑器返回按钮风格统一 |
| 图标 | `ArrowLeft` from lucide-react | 项目已有依赖，编辑器页面已使用 |
| 目标路由 | `/projects/${projectId}/kanban` | 固定路由，不依赖浏览器 history |

### 备选方案（已排除）

- **浏览器 history.back()**：不可靠，用户可能从其他路径进入流程管理页面
- **面包屑导航**：过度设计，当前项目无面包屑组件，仅为解决单一导航问题不值得引入
- **在 Sidebar 中添加子导航**：改动范围过大，偏离最小变更原则

---

## 数据流

```
用户点击返回按钮
    │
    ▼
Button onClick handler
    │
    ▼
navigate(`/projects/${projectId}/kanban`)
    │
    ▼
React Router 路由匹配
    │
    ▼
KanbanPage 组件渲染
    │
    ▼
kanban-store 加载项目看板数据
```

无新增 API 调用，无状态变更，纯客户端路由跳转。

---

## 文件变更清单

### 修改文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/src/pages/workflows/index.tsx` | MODIFY | 在 header 添加返回看板按钮 |

### 新增文件

无

### 删除文件

无

---

## 具体代码变更

### `packages/web/src/pages/workflows/index.tsx`

在页面 header 的项目名称左侧插入返回按钮：

```tsx
// 新增 import
import { ArrowLeft } from 'lucide-react'

// 在 header 区域添加
<Button
  variant="ghost"
  size="icon"
  onClick={() => navigate(`/projects/${projectId}/kanban`)}
>
  <ArrowLeft className="h-4 w-4" />
</Button>
```

参考实现：`packages/web/src/pages/workflows/workflow-editor.tsx` 中的返回按钮。

---

## 导航层级结构（变更后）

```
项目列表 (/projects)
  └── 看板 (/projects/:projectId/kanban)
        └── 流程管理 (/projects/:projectId/workflows)  ← 添加返回按钮
              └── 工作流编辑器 (/projects/:projectId/workflows/:workflowId/edit)  ← 已有返回按钮
```

变更后，每一层级都有明确的返回上一级的导航入口。

---

## 测试策略

- 手动验证：从看板进入流程管理，点击返回按钮回到看板
- 手动验证：直接访问流程管理 URL，返回按钮仍可正常工作
- 手动验证：从编辑器返回流程管理后，再返回看板，链路完整
