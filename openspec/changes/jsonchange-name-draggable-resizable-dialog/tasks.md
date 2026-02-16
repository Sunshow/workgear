# Tasks: Draggable & Resizable Dialog — 可拖拽可调整大小的 Dialog 组件

## 模块：依赖管理 (packages/web)

### 安装 react-rnd 依赖

- [ ] 在 `packages/web/` 下执行 `pnpm add react-rnd` 安装依赖 **[S]**
- [ ] 确认 `package.json` 中 `react-rnd` 版本正确写入 **[S]**
- [ ] 确认 `pnpm install` 无冲突，lock 文件正常更新 **[S]**

## 模块：UI 基础组件 (packages/web/src/components/ui)

### 创建 DraggableResizableDialog 组件

- [ ] 新建 `draggable-resizable-dialog.tsx` 文件 **[S]**
- [ ] 实现 `DraggableResizableDialog` 根组件（复用 Radix Dialog.Root） **[S]**
- [ ] 实现 `DraggableResizableDialogOverlay` 遮罩层组件（与标准 Dialog 一致） **[S]**
- [ ] 实现 `DraggableResizableDialogContent` 内容容器，封装 react-rnd **[M]**
  - 接收 defaultWidth、defaultHeight、minWidth、minHeight、maxWidth、maxHeight props
  - 打开时动态计算居中位置
  - 关闭后重置位置和大小
  - 使用 `DialogPrimitive.Content asChild` 保留 Radix 无障碍属性
- [ ] 实现 `DraggableResizableDialogHeader` 标题栏组件，添加 `drag-handle` class 和 `cursor-move` 样式 **[S]**
- [ ] 实现 `DraggableResizableDialogTitle` 标题文字组件 **[S]**
- [ ] 实现 `DraggableResizableDialogFooter` 底部操作栏组件 **[S]**
- [ ] 导出所有子组件 **[S]**
- [ ] 确认拖拽手柄仅限标题栏区域，内部可交互元素不触发拖拽 **[S]**
- [ ] 确认 `bounds="window"` 限制 Dialog 不超出视口 **[S]**

## 模块：Artifact Editor (packages/web/src/components)

### 改造 ArtifactEditorDialog 使用新组件

- [ ] 修改 `artifact-editor-dialog.tsx` 的 import，从标准 Dialog 切换到 DraggableResizableDialog **[S]**
- [ ] 替换 JSX 中的 Dialog → DraggableResizableDialog **[S]**
- [ ] 替换 DialogContent → DraggableResizableDialogContent，配置 defaultWidth=672、minWidth=480、minHeight=400 **[S]**
- [ ] 替换 DialogHeader → DraggableResizableDialogHeader **[S]**
- [ ] 替换 DialogTitle → DraggableResizableDialogTitle **[S]**
- [ ] 替换 DialogFooter → DraggableResizableDialogFooter **[S]**
- [ ] 移除原有的 `max-w-2xl max-h-[85vh]` 固定尺寸 class（由 react-rnd 控制） **[S]**
- [ ] 确认 Textarea、Input、Button 等内部元素正常工作 **[S]**
- [ ] 确认保存/取消功能行为不变 **[S]**

## 测试验证

### 端到端验证

- [ ] 打开 Artifact Editor Dialog → 确认默认居中显示，宽度约 672px **[S]**
- [ ] 拖拽标题栏 → 确认 Dialog 跟随移动 **[S]**
- [ ] 拖拽到视口边缘 → 确认不超出视口 **[S]**
- [ ] 拖拽 Dialog 右边缘 → 确认可水平调整宽度 **[S]**
- [ ] 拖拽 Dialog 下边缘 → 确认可垂直调整高度 **[S]**
- [ ] 拖拽 Dialog 右下角 → 确认可同时调整宽高 **[S]**
- [ ] 调整到最小尺寸 → 确认受 minWidth/minHeight 约束 **[S]**
- [ ] Dialog 内 Textarea 输入文字 → 确认不触发拖拽 **[S]**
- [ ] Dialog 内 Button 点击 → 确认正常响应 **[S]**
- [ ] 按 ESC → 确认 Dialog 关闭 **[S]**
- [ ] 点击遮罩层 → 确认 Dialog 关闭 **[S]**
- [ ] 点击关闭按钮（X） → 确认 Dialog 关闭 **[S]**
- [ ] 拖拽移动后关闭，重新打开 → 确认恢复默认居中位置 **[S]**
- [ ] 调整大小后关闭，重新打开 → 确认恢复默认大小 **[S]**
- [ ] 保存产物版本 → 确认功能正常，与改造前行为一致 **[S]**
- [ ] Dark mode → 确认 Dialog 样式正确适配 **[S]**

## 模块：OpenSpec 文档

- [ ] 归档完成后更新 `openspec/specs/artifact/2026-02-16-artifact-management.md` **[S]**
- [ ] 归档完成后新增 `openspec/specs/kanban/2026-02-16-draggable-resizable-dialog.md` **[S]**
