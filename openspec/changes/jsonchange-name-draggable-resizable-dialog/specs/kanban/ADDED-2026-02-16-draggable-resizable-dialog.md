# Delta Spec: UI 基础组件新增 DraggableResizableDialog

> **Type:** ADDED
> **Module:** kanban
> **Date:** 2026-02-16
> **Change:** jsonchange-name-draggable-resizable-dialog

## 概述

在 UI 基础组件层新增 `<DraggableResizableDialog>` 组件，基于 Radix UI Dialog + react-rnd 封装，提供可拖拽移动、可调整大小的 Dialog 能力，作为标准 Dialog 的增强替代方案。该组件归属于看板模块的 UI 基础设施，因为首个应用场景为看板任务详情中的 Artifact Editor。

---

## 场景

### Scenario 1: 组件导出与引用

```gherkin
Given 开发者需要在任意页面使用可拖拽可调整大小的 Dialog
When 从 '@/components/ui/draggable-resizable-dialog' 导入组件
Then 可以获取 DraggableResizableDialog、DraggableResizableDialogHeader、DraggableResizableDialogTitle、DraggableResizableDialogFooter 等子组件
  And 组件 API 风格与现有 Shadcn Dialog 保持一致（open / onOpenChange 受控模式）
```

### Scenario 2: 默认居中渲染

```gherkin
Given 开发者使用 DraggableResizableDialog 且未指定初始位置
  And 传入 defaultWidth=600 和 defaultHeight=400
When Dialog 打开（open=true）
Then Dialog 窗口在视口中水平和垂直居中
  And 窗口宽度为 600px，高度为 400px
  And 显示半透明遮罩层
```

### Scenario 3: 响应式默认居中

```gherkin
Given Dialog 处于打开状态且位于视口居中
When 浏览器窗口大小发生变化（resize 事件）
Then Dialog 保持当前位置不变（不自动重新居中）
  And 如果 Dialog 被拖出可视区域，不自动修正位置
```

### Scenario 4: 标题栏渲染拖拽手柄样式

```gherkin
Given DraggableResizableDialog 打开
  And 使用 DraggableResizableDialogHeader 渲染标题栏
When 用户将鼠标悬停在标题栏区域
Then 鼠标光标变为 move（移动）样式
  And 标题栏视觉上与标准 Dialog 标题栏一致（无额外装饰）
```

### Scenario 5: 与标准 Dialog 共存

```gherkin
Given 项目中同时使用标准 Shadcn Dialog 和 DraggableResizableDialog
When 两种 Dialog 分别在不同场景中使用
Then 标准 Dialog 行为不受影响（固定居中，不可拖拽）
  And DraggableResizableDialog 独立工作
  And 两者共享相同的设计语言（圆角、阴影、遮罩样式一致）
```

---

## UI 规格

### 组件层次结构

| 组件 | 说明 |
|------|------|
| `DraggableResizableDialog` | 根组件，管理 open/onOpenChange 状态 |
| `DraggableResizableDialogContent` | 内容容器，封装 react-rnd + Radix Dialog |
| `DraggableResizableDialogHeader` | 标题栏，同时作为拖拽手柄 |
| `DraggableResizableDialogTitle` | 标题文字 |
| `DraggableResizableDialogFooter` | 底部操作栏 |

### 样式规格

| 属性 | 值 |
|------|-----|
| 背景色 | `bg-background`（与标准 Dialog 一致） |
| 边框 | `border border-border` |
| 圆角 | `rounded-lg` |
| 阴影 | `shadow-lg` |
| 内边距 | `p-6`（与标准 Dialog 一致） |
| 遮罩层 | `bg-black/80`（与标准 Dialog 一致） |
| z-index | `z-50`（与标准 Dialog 一致） |
| 关闭按钮 | 右上角 X 图标，样式与标准 Dialog 一致 |
