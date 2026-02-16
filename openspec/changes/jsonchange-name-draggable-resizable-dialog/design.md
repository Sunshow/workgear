# Design: Draggable & Resizable Dialog — 可拖拽可调整大小的 Dialog 组件

## 技术方案

### 方案概述

基于 `react-rnd` 库（封装了 `react-draggable` + `react-resizable`）和 Radix UI Dialog 创建通用 `<DraggableResizableDialog>` 组件。react-rnd 提供拖拽和调整大小的核心能力，Radix Dialog 提供无障碍支持（焦点管理、ARIA 属性、ESC 关闭）。首个应用场景为 `<ArtifactEditorDialog>` 的改造。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 拖拽/调整大小库 | `react-rnd` | 成熟稳定（3.8k+ stars），同时提供 drag + resize 能力，API 简洁，与 React 19 兼容 |
| Dialog 基础 | Radix UI Dialog | 保留无障碍能力（焦点陷阱、ARIA、ESC 关闭），与项目现有 Dialog 设计语言一致 |
| 拖拽手柄 | 标题栏区域 | 符合桌面应用的交互惯例，避免与内部可交互元素冲突 |
| 位置计算 | 打开时动态计算居中坐标 | 使用 `window.innerWidth/innerHeight` 计算，确保不同屏幕尺寸下均居中 |
| 状态管理 | 组件内部 state | 位置和大小为临时 UI 状态，无需 Zustand 全局管理，关闭后重置 |
| 组件命名 | `DraggableResizableDialog*` | 明确表达能力，与现有 `Dialog*` 组件区分，避免命名冲突 |
| 遮罩层交互 | 点击遮罩关闭 | 与标准 Dialog 行为一致，保持用户预期 |

### 备选方案（已排除）

- **自行实现拖拽/调整大小**（基于 mousedown/mousemove/mouseup）：排除原因：需要处理大量边界情况（触摸设备、iframe、边界检测），react-rnd 已经解决了这些问题，无需重复造轮子。
- **使用 `@dnd-kit` 实现拖拽**：排除原因：@dnd-kit 专注于列表排序和拖放（drag-and-drop），不提供 resize 能力，且 API 设计不适合 Dialog 定位场景。
- **CSS `resize` 属性**：排除原因：仅支持右下角调整大小，不支持四边和四角，且无法自定义 resize 手柄样式。
- **修改现有 Shadcn Dialog 组件**：排除原因：会影响所有使用 Dialog 的场景，风险过高；新建独立组件更安全。

---

## 数据流

### DraggableResizableDialog 打开流程

```
用户触发 Dialog 打开（如点击「编辑」按钮）
    │
    ▼
onOpenChange(true) → open state = true
    │
    ▼
DraggableResizableDialog 渲染
    │
    ├── Radix Dialog.Root open={true}
    │     ├── DialogOverlay（半透明遮罩）
    │     └── DialogPortal
    │           └── Radix Dialog.Content（无定位样式，作为容器）
    │                 └── react-rnd <Rnd> 组件
    │                       ├── position: { x: 居中X, y: 居中Y }
    │                       ├── size: { width: defaultWidth, height: defaultHeight }
    │                       ├── dragHandleClassName: "drag-handle"
    │                       ├── bounds: "window"
    │                       └── children: Header + Body + Footer
    │
    ▼
计算初始居中位置：
  x = (window.innerWidth - defaultWidth) / 2
  y = (window.innerHeight - defaultHeight) / 2
    │
    ▼
Dialog 渲染在计算出的居中位置
```

### 拖拽移动流程

```
用户在标题栏（.drag-handle）按下鼠标
    │
    ▼
react-rnd 捕获 mousedown 事件
    │
    ▼
用户移动鼠标
    │
    ▼
react-rnd onDragStop 回调
    │
    ▼
更新内部 position state: { x: newX, y: newY }
    │
    ▼
Dialog 移动到新位置（bounds="window" 限制不超出视口）
```

### 调整大小流程

```
用户在 Dialog 边缘/角落按下鼠标
    │
    ▼
react-rnd 捕获 resize 事件
    │
    ▼
用户拖动调整大小
    │
    ▼
react-rnd onResizeStop 回调
    │
    ▼
更新内部 size state: { width: newW, height: newH }
    │  受 minWidth/minHeight/maxWidth/maxHeight 约束
    │
    ▼
Dialog 调整到新的大小
```

### 关闭与重置流程

```
用户关闭 Dialog（ESC / X / 遮罩）
    │
    ▼
onOpenChange(false) → open state = false
    │
    ▼
Dialog 卸载
    │
    ▼
下次打开时：
  position 重新计算居中坐标
  size 恢复为 defaultWidth / defaultHeight
```

---

## 文件变更清单

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `packages/web/src/components/ui/draggable-resizable-dialog.tsx` | 通用可拖拽可调整大小 Dialog 组件 |

### 修改文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/package.json` | MODIFY | 新增 `react-rnd` 依赖 |
| `packages/web/src/components/artifact-editor-dialog.tsx` | MODIFY | 改用 DraggableResizableDialog |

### 删除文件

无

---

## 具体代码变更

### 1. `packages/web/src/components/ui/draggable-resizable-dialog.tsx`（新增）

```tsx
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Rnd } from 'react-rnd'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DraggableResizableDialogContentProps {
  children: React.ReactNode
  className?: string
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

// Root: 直接复用 Radix Dialog.Root
const DraggableResizableDialog = DialogPrimitive.Root

// Overlay: 与标准 Dialog 一致
const DraggableResizableDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))

// Content: 封装 react-rnd
function DraggableResizableDialogContent({
  children,
  className,
  defaultWidth = 500,
  defaultHeight = 400,
  minWidth = 320,
  minHeight = 200,
  maxWidth,
  maxHeight,
}: DraggableResizableDialogContentProps) {
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [size, setSize] = React.useState({ width: defaultWidth, height: defaultHeight })

  // 每次打开时重新计算居中位置
  React.useEffect(() => {
    setPosition({
      x: (window.innerWidth - defaultWidth) / 2,
      y: (window.innerHeight - defaultHeight) / 2,
    })
    setSize({ width: defaultWidth, height: defaultHeight })
  }, [defaultWidth, defaultHeight])

  return (
    <DialogPrimitive.Portal>
      <DraggableResizableDialogOverlay />
      <DialogPrimitive.Content asChild>
        <div className="fixed inset-0 z-50 pointer-events-none">
          <Rnd
            position={position}
            size={size}
            onDragStop={(_e, d) => setPosition({ x: d.x, y: d.y })}
            onResizeStop={(_e, _dir, ref, _delta, pos) => {
              setSize({ width: ref.offsetWidth, height: ref.offsetHeight })
              setPosition(pos)
            }}
            dragHandleClassName="drag-handle"
            bounds="window"
            minWidth={minWidth}
            minHeight={minHeight}
            maxWidth={maxWidth}
            maxHeight={maxHeight}
            className={cn(
              'pointer-events-auto border bg-background shadow-lg rounded-lg',
              className
            )}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {children}
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </Rnd>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

// Header: 同时作为拖拽手柄
const DraggableResizableDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'drag-handle flex flex-col space-y-1.5 p-6 pb-0 cursor-move select-none',
      className
    )}
    {...props}
  />
)

// Title
const DraggableResizableDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
))

// Footer
const DraggableResizableDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 p-6 pt-0', className)}
    {...props}
  />
)

export {
  DraggableResizableDialog,
  DraggableResizableDialogContent,
  DraggableResizableDialogHeader,
  DraggableResizableDialogTitle,
  DraggableResizableDialogFooter,
}
```

说明：
- `DraggableResizableDialog` 直接复用 `DialogPrimitive.Root`，保持 API 一致
- `DraggableResizableDialogContent` 使用 `DialogPrimitive.Content asChild` 将 Radix 的无障碍属性传递给自定义容器
- `Rnd` 组件包裹实际内容，提供拖拽和调整大小能力
- `dragHandleClassName="drag-handle"` 限定仅标题栏可拖拽
- `bounds="window"` 限制不超出视口
- `pointer-events-none` + `pointer-events-auto` 确保遮罩层点击穿透正确

### 2. `packages/web/src/components/artifact-editor-dialog.tsx`（修改）

```tsx
// 变更 import：从标准 Dialog 切换到 DraggableResizableDialog
import {
  DraggableResizableDialog,
  DraggableResizableDialogContent,
  DraggableResizableDialogHeader,
  DraggableResizableDialogTitle,
  DraggableResizableDialogFooter,
} from '@/components/ui/draggable-resizable-dialog'

// 替换 JSX 中的组件引用：
// Dialog → DraggableResizableDialog
// DialogContent → DraggableResizableDialogContent（增加 defaultWidth/defaultHeight props）
// DialogHeader → DraggableResizableDialogHeader
// DialogTitle → DraggableResizableDialogTitle
// DialogFooter → DraggableResizableDialogFooter

// DraggableResizableDialogContent props:
//   defaultWidth={672}      (等同原 max-w-2xl)
//   defaultHeight={window.innerHeight * 0.85}  (等同原 max-h-[85vh])
//   minWidth={480}
//   minHeight={400}
//   maxWidth={window.innerWidth * 0.9}
//   maxHeight={window.innerHeight * 0.95}
```

### 3. `packages/web/package.json`（修改）

```json
// dependencies 中新增：
"react-rnd": "^10.4.13"
```

---

## 样式方案

- 新组件复用 Shadcn Dialog 的设计语言：`bg-background`、`border`、`rounded-lg`、`shadow-lg`
- 标题栏增加 `cursor-move` 和 `select-none`，提示用户可拖拽
- 调整大小的手柄使用 react-rnd 默认的透明边缘区域，无需额外样式
- Dark mode：继承 Tailwind CSS 的 dark mode 变量，无需额外处理
- 遮罩层样式与标准 Dialog 完全一致（`bg-black/80`）

---

## 测试策略

- 手动验证：打开 Artifact Editor Dialog → 确认默认居中显示
- 手动验证：拖拽标题栏 → 确认 Dialog 跟随移动，不超出视口
- 手动验证：拖拽 Dialog 边缘 → 确认可调整大小，受 min/max 约束
- 手动验证：Dialog 内部 Textarea 输入 → 确认不触发拖拽
- 手动验证：Dialog 内部 Button 点击 → 确认正常响应
- 手动验证：按 ESC → 确认 Dialog 关闭
- 手动验证：点击遮罩 → 确认 Dialog 关闭
- 手动验证：关闭后重新打开 → 确认恢复默认居中位置和大小
- 手动验证：保存/取消功能 → 确认行为与改造前一致
- 手动验证：Dark mode → 确认样式正确适配
