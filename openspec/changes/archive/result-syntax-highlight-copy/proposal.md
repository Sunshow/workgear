# Proposal: Result Syntax Highlight & Copy — 结果区域代码高亮与一键复制

## 背景（Why）

当前 WorkGear 平台中有多处展示代码/JSON 内容的场景，但均以纯文本 `<pre>` 标签渲染，缺乏语法高亮和复制功能：

1. **Flow Tab 执行结果**（`flow-tab.tsx`）：节点执行完成后，`nodeRun.output` 以 `JSON.stringify` 纯文本展示在 `<pre>` 标签中，无语法高亮，无法一键复制。
2. **Node Log Dialog 日志内容**（`node-log-dialog.tsx`）：工具调用的 `tool_input`（JSON）和 `tool_result`（文本）以纯文本展示，无语法高亮，无法一键复制。
3. **MarkdownRenderer 代码块**（`markdown-renderer.tsx`）：虽然已有 `rehype-highlight` 语法高亮，但代码块缺少「复制」按钮，用户需要手动选中文本复制。

### 用户痛点

- 节点执行结果（JSON）无语法高亮，大段 JSON 可读性差
- 工具调用日志中的 JSON 输入/输出无高亮，调试时难以快速定位关键字段
- 所有代码块/JSON 块均无「复制到剪贴板」按钮，用户需手动选中 → 复制，操作繁琐
- Markdown 渲染的代码块虽有高亮但无复制按钮，与主流 Markdown 渲染器（GitHub、VS Code）体验不一致

### 根因分析

- `flow-tab.tsx` 和 `node-log-dialog.tsx` 中的 `<pre>` 标签直接输出纯文本，未接入任何语法高亮库
- `markdown-renderer.tsx` 使用 `rehype-highlight` 实现了代码高亮，但未通过 `components` 自定义 `<pre>` 渲染器来注入复制按钮
- 项目中尚无通用的「代码块 + 高亮 + 复制」组件

## 目标（What）

创建通用的 `<CodeBlock>` 组件，统一所有代码/JSON 展示场景的语法高亮和一键复制能力：

| 场景 | 当前状态 | 目标状态 |
|------|----------|----------|
| Flow Tab 执行结果 | `<pre>` 纯文本 JSON | 语法高亮 JSON + 复制按钮 |
| Node Log Dialog 工具输入 | `<pre>` 纯文本 JSON | 语法高亮 JSON + 复制按钮 |
| Node Log Dialog 工具结果 | 纯文本 | 保持纯文本 + 复制按钮 |
| MarkdownRenderer 代码块 | 语法高亮，无复制 | 语法高亮 + 复制按钮 |
| ArtifactPreviewCard 内容 | 通过 MarkdownRenderer 渲染 | 继承 MarkdownRenderer 的增强 |

### 具体方案

1. 新建通用 `<CodeBlock>` 组件，封装语法高亮（highlight.js）+ 复制到剪贴板功能
2. 改造 `<MarkdownRenderer>`：通过 `components.pre` 自定义渲染器注入复制按钮
3. 改造 `flow-tab.tsx`：节点执行结果使用 `<CodeBlock>` 替换 `<pre>`
4. 改造 `node-log-dialog.tsx`：工具调用输入/输出使用 `<CodeBlock>` 替换 `<pre>`
5. 添加复制成功的视觉反馈（图标切换 Copy → Check）

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| artifact (MarkdownRenderer) | 代码变更 | 注入 `components.pre` 自定义渲染器，代码块增加复制按钮 |
| kanban (Flow Tab) | 代码变更 | 节点执行结果 `<pre>` → `<CodeBlock>` |
| kanban (Node Log Dialog) | 代码变更 | 工具调用日志 `<pre>` → `<CodeBlock>` |
| web (Components) | 新增文件 | 新增 `<CodeBlock>` 通用组件 |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/src/components/code-block.tsx` | ADD | 通用代码块组件（高亮 + 复制） |
| `packages/web/src/components/markdown-renderer.tsx` | MODIFY | 注入 `components.pre` 自定义渲染器 |
| `packages/web/src/pages/kanban/task-detail/flow-tab.tsx` | MODIFY | 执行结果使用 `<CodeBlock>` |
| `packages/web/src/components/node-log-dialog.tsx` | MODIFY | 工具日志使用 `<CodeBlock>` |

### 不涉及

- 数据库 schema 无变更
- API 端点无变更
- Orchestrator / Go 服务无变更
- 不新增任何 npm 依赖（highlight.js 已安装，Clipboard API 为浏览器原生）

## 非目标

- 不实现代码行号显示（后续迭代考虑）
- 不实现代码折叠/展开功能
- 不实现代码编辑能力（仅只读展示）
- 不替换 Monaco Editor 的代码编辑功能
- 不实现代码块的语言自动检测（依赖显式标注或 JSON 推断）

## 风险评估

- **风险等级：低** — 变更集中在前端 UI 渲染层，不影响数据模型和核心流程
- highlight.js 已在项目中使用（通过 rehype-highlight），无需新增依赖
- Clipboard API（`navigator.clipboard.writeText`）在所有现代浏览器中均已支持
- 向后兼容：纯渲染层变更，不影响已有数据
