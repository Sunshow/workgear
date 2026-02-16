# Proposal: Draggable & Resizable Dialog — 可拖拽可调整大小的 Dialog 组件

## 背景（Why）

当前 WorkGear 中所有 Dialog 均使用 Shadcn/Radix UI 的标准 Dialog 组件，固定居中定位（`left-[50%] top-[50%] translate`），尺寸由 `max-w-*` 和 `max-h-*` 限定：

1. **Artifact Editor Dialog**（`artifact-editor-dialog.tsx`）：`max-w-2xl max-h-[85vh]`，编辑长文档时空间不足，无法调整大小。
2. **Markdown Fullscreen Preview**（`markdown-fullscreen-preview.tsx`）：虽然是全屏 Overlay，但完全遮挡底层内容，无法同时参考其他信息。
3. **Node Log Dialog / Flow Error Dialog / Create Workflow Dialog** 等：均为固定尺寸居中弹窗，无法移动或调整。

### 用户痛点

- 用户在编辑 Artifact 时需要参考底层页面的其他信息（如看板任务详情、DAG 节点数据），但 Dialog 固定居中遮挡了底层内容，无法拖动到一侧查看
- 用户在查看 Node Log 或 Flow Error 时，Dialog 尺寸固定，长日志内容需要在狭小窗口中反复滚动
- 不同使用场景对 Dialog 尺寸需求不同：查看简短错误信息时希望小窗口，查看长日志时希望大窗口，当前无法灵活调整
- 多个 Dialog 场景中用户无法自由安排窗口位置，影响多任务并行操作效率

### 根因分析

Shadcn Dialog 组件基于 Radix UI，使用 CSS `fixed` 定位 + `translate(-50%, -50%)` 居中，不支持拖拽和调整大小。项目中缺少一个通用的可拖拽、可调整大小的 Dialog 基础组件。

## 目标（What）

创建通用的 `<DraggableResizableDialog>` 组件，在保留 Radix UI Dialog 的无障碍能力（焦点管理、ESC 关闭、ARIA 属性）的基础上，增加拖拽移动和边缘拖拽调整大小的能力：

| 元素 | 当前状态 | 目标状态 |
|------|----------|----------|
| Dialog 定位 | 固定居中，不可移动 | 默认居中，可通过拖拽标题栏移动位置 |
| Dialog 尺寸 | 固定 max-w / max-h | 可通过拖拽边缘/角落调整大小，支持设置最小/最大尺寸 |
| UI 基础组件 | 仅有标准 Dialog | 新增 DraggableResizableDialog 通用组件 |
| Artifact Editor | 固定 max-w-2xl | 改用 DraggableResizableDialog，可拖拽可调整 |
| 其他 Dialog | 固定居中 | 保持不变（后续按需迁移） |

### 具体方案

1. 引入 `react-rnd` 库（基于 `react-draggable` + `react-resizable`），提供成熟的拖拽 + 调整大小能力
2. 创建通用 `<DraggableResizableDialog>` 组件，基于 Radix Dialog + react-rnd 封装
3. 标题栏作为拖拽手柄（drag handle），四边和四角支持调整大小
4. 首个应用场景：将 `<ArtifactEditorDialog>` 改造为使用 `<DraggableResizableDialog>`
5. 保留原有 Shadcn Dialog 组件不变，新组件作为增量能力供按需使用

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| UI 基础组件 (ui/) | 新增文件 | 新增 `<DraggableResizableDialog>` 通用组件 |
| artifact (Components) | 代码变更 | `artifact-editor-dialog.tsx` 改用新组件 |
| 依赖管理 | 新增依赖 | 安装 `react-rnd` npm 包 |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/package.json` | MODIFY | 新增 `react-rnd` 依赖 |
| `packages/web/src/components/ui/draggable-resizable-dialog.tsx` | ADD | 通用可拖拽可调整大小 Dialog 组件 |
| `packages/web/src/components/artifact-editor-dialog.tsx` | MODIFY | 改用 DraggableResizableDialog |

### 不涉及

- 数据库 schema 无变更
- API 层无变更
- 现有 Shadcn Dialog 组件（`ui/dialog.tsx`）不修改，保持向后兼容
- Markdown Fullscreen Preview 不修改（全屏场景不需要拖拽）
- Orchestrator / Go 服务无变更
- 其他 Dialog（Node Log、Flow Error、Create Workflow 等）暂不迁移，后续按需改造

## 非目标

- 不实现多 Dialog 窗口管理（z-index 层叠、窗口切换）
- 不实现 Dialog 最小化/最大化按钮
- 不实现 Dialog 位置/尺寸的持久化存储（关闭后重新打开恢复默认位置）
- 不实现 Dialog 吸附/对齐辅助线
- 不修改现有 Shadcn Dialog 组件的行为
- 不迁移所有现有 Dialog 到新组件（仅迁移 Artifact Editor 作为首个场景）

## 风险评估

- **风险等级：低** — 新增独立组件，不修改现有 Dialog 基础组件，向后兼容
- `react-rnd` 是成熟的开源库（GitHub 3.8k+ stars），API 稳定，与 React 19 兼容
- 新组件仅在 Artifact Editor 中首先应用，影响范围可控
- 拖拽和调整大小的交互不影响 Dialog 内部的表单逻辑和数据流
- 需要注意：拖拽区域不能与 Dialog 内部的可交互元素（Textarea、Input）冲突，通过限定 drag handle 为标题栏解决
