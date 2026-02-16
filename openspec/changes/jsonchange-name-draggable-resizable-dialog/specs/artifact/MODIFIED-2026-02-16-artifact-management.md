# Delta Spec: DraggableResizableDialog 通用组件 & Artifact Editor Dialog 改造

> **Type:** MODIFIED
> **Module:** artifact
> **Date:** 2026-02-16
> **Change:** jsonchange-name-draggable-resizable-dialog

## 概述

修改产物管理模块，新增通用 `<DraggableResizableDialog>` 可拖拽可调整大小的 Dialog 组件，并将 `<ArtifactEditorDialog>` 改造为使用该新组件，让用户可以自由移动和调整编辑窗口的位置与大小。

---

## 场景

### Scenario 1: 新增 DraggableResizableDialog 通用组件

```gherkin
Given 开发者需要一个可拖拽、可调整大小的 Dialog
  And 传入 open（布尔值）、onOpenChange（回调）props
  And 可选传入 defaultWidth、defaultHeight、minWidth、minHeight、maxWidth、maxHeight props
When 组件渲染且 open 为 true
Then 显示一个 Dialog Overlay，Dialog 窗口默认居中于视口
  And Dialog 窗口具有指定的默认宽高（若未指定则使用组件默认值）
  And Dialog 保留 Radix UI 的无障碍能力（ARIA 属性、焦点管理）
```

### Scenario 2: 拖拽移动 Dialog

```gherkin
Given DraggableResizableDialog 处于打开状态
  And Dialog 标题栏区域作为拖拽手柄（drag handle）
When 用户在标题栏区域按下鼠标并拖动
Then Dialog 窗口跟随鼠标移动
  And 拖拽过程中显示 cursor: move 光标样式
  And Dialog 不能被拖出视口边界（限制在 viewport 范围内）
  And 释放鼠标后 Dialog 停留在新位置
```

### Scenario 3: 拖拽调整 Dialog 大小

```gherkin
Given DraggableResizableDialog 处于打开状态
When 用户将鼠标移动到 Dialog 的四边或四角边缘
Then 显示对应方向的 resize 光标（n-resize、s-resize、e-resize、w-resize、nw-resize 等）
When 用户在边缘按下鼠标并拖动
Then Dialog 窗口大小跟随鼠标调整
  And 宽度不小于 minWidth，不大于 maxWidth
  And 高度不小于 minHeight，不大于 maxHeight
  And 释放鼠标后 Dialog 保持新的大小
```

### Scenario 4: 关闭 DraggableResizableDialog

```gherkin
Given DraggableResizableDialog 处于打开状态
When 用户按下 ESC 键
  Or 用户点击 Dialog 右上角的关闭按钮（X 图标）
  Or 用户点击 Dialog 外部的遮罩层
Then Dialog 关闭
  And 调用 onOpenChange(false) 回调
  And 下次打开时 Dialog 恢复默认居中位置和默认大小
```

### Scenario 5: 重新打开时恢复默认状态

```gherkin
Given 用户之前拖拽移动或调整了 Dialog 的位置和大小
  And 用户关闭了 Dialog
When 用户重新打开 Dialog
Then Dialog 恢复到默认居中位置
  And Dialog 恢复到默认宽高
  And 不保留上次的位置和大小状态
```

### Scenario 6: 拖拽手柄区域限定

```gherkin
Given DraggableResizableDialog 打开
  And Dialog 内部包含可交互元素（Input、Textarea、Button 等）
When 用户在 Dialog 内部的可交互元素上操作（输入文字、点击按钮）
Then 不触发拖拽行为
  And 可交互元素正常响应用户操作
  And 仅标题栏区域可触发拖拽
```

### Scenario 7: Artifact Editor Dialog 改用 DraggableResizableDialog

```gherkin
Given 用户打开 Artifact Editor Dialog 编辑产物内容
When Dialog 渲染
Then Dialog 默认居中显示，默认宽度约 672px（对应原 max-w-2xl）
  And 用户可以拖拽标题栏移动 Dialog 位置
  And 用户可以拖拽边缘调整 Dialog 大小
  And Dialog 内部的 Textarea、Input、Button 等元素正常工作
  And 保存/取消等功能行为不变
```

### Scenario 8: Artifact Editor Dialog 拖拽后查看底层内容

```gherkin
Given 用户打开 Artifact Editor Dialog
  And 底层页面显示看板任务详情或 DAG 节点信息
When 用户拖拽 Dialog 标题栏将 Dialog 移动到视口一侧
Then 底层页面的被遮挡区域变为可见
  And 用户可以参考底层内容进行编辑
  And Dialog 遮罩层允许看到底层内容（半透明或无遮罩）
```

---

## UI 规格

### DraggableResizableDialog

| 属性 | 值 |
|------|-----|
| 容器 | Radix Dialog + react-rnd 封装 |
| 默认位置 | 视口居中 |
| 默认宽度 | 由调用方指定（defaultWidth prop） |
| 默认高度 | 由调用方指定（defaultHeight prop） |
| 最小宽度 | 320px（可通过 minWidth prop 覆盖） |
| 最小高度 | 200px（可通过 minHeight prop 覆盖） |
| 拖拽手柄 | 标题栏区域（通过 CSS class `drag-handle` 标识） |
| 调整大小 | 四边 + 四角均可拖拽调整 |
| 边界限制 | 不可拖出 viewport |
| 关闭方式 | ESC 键 / 关闭按钮 / 点击遮罩 |
| 遮罩层 | 半透明黑色遮罩（与标准 Dialog 一致） |
| 圆角 | `rounded-lg`（与标准 Dialog 一致） |
| 阴影 | `shadow-lg`（与标准 Dialog 一致） |

### Artifact Editor Dialog（改造后）

| 属性 | 值 |
|------|-----|
| 默认宽度 | 672px（等同原 max-w-2xl） |
| 默认高度 | 85vh |
| 最小宽度 | 480px |
| 最小高度 | 400px |
| 最大宽度 | 90vw |
| 最大高度 | 95vh |
