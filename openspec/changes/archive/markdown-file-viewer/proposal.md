# Proposal: Markdown File Viewer — 产物内容 Markdown 渲染与预览

## 背景（Why）

当前 WorkGear 中有两处展示 Markdown 内容的场景，但都以纯文本形式呈现，用户体验较差：

1. **Artifacts Tab**（`artifacts-tab.tsx`）：任务详情的产物列表仅展示元数据（标题、类型、日期），展开后只显示版本历史摘要，无法查看产物的实际内容。用户需要到外部工具中查看产物文件。
2. **Spec Artifact Viewer**（`spec-artifact-viewer.tsx`）：OpenSpec 文档查看器虽然能加载 Markdown 文件内容，但使用 `<pre>` 标签以纯文本渲染，标题、列表、代码块、表格等 Markdown 语法元素无法正确展示。

### 用户痛点

- 产物内容（PRD、Proposal、Design、Spec 等）均为 Markdown 格式，纯文本展示可读性极差
- Artifacts Tab 无法查看产物内容，只能看到标题和版本号
- OpenSpec 文档中的 Gherkin 代码块、表格、层级标题在纯文本模式下难以阅读
- 用户需要复制内容到外部 Markdown 编辑器才能正常阅读，打断工作流

### 根因分析

项目前端（`@workgear/web`）未引入任何 Markdown 渲染库。`spec-artifact-viewer.tsx` 直接使用 `<pre>` 标签输出原始文本。`artifacts-tab.tsx` 的版本展开区域只展示 `changeSummary` 元数据，未调用 API 获取版本的 `content` 字段进行展示。

## 目标（What）

引入 Markdown 渲染能力，让产物内容和 OpenSpec 文档以富文本格式展示：

| 元素 | 当前状态 | 目标状态 |
|------|----------|----------|
| Spec Artifact Viewer | `<pre>` 纯文本 | Markdown 富文本渲染（标题、列表、表格、代码高亮） |
| Artifacts Tab 版本内容 | 不显示内容 | 点击版本可展开查看 Markdown 渲染后的内容 |
| 代码块 | 无语法高亮 | Gherkin / TypeScript / Go 等语法高亮 |
| 查看/编辑切换 | 编辑时 Textarea | 保留 Textarea 编辑，查看时 Markdown 渲染 |

### 具体方案

1. 引入 `react-markdown` + `remark-gfm`（支持 GFM 表格、任务列表、删除线）
2. 引入 `rehype-highlight`（代码块语法高亮）
3. 创建通用 `<MarkdownRenderer>` 组件，封装渲染逻辑和样式
4. 改造 `spec-artifact-viewer.tsx`：将 `<pre>` 替换为 `<MarkdownRenderer>`
5. 改造 `artifacts-tab.tsx`：版本展开区域增加「查看内容」按钮，点击后加载并渲染 Markdown 内容
6. API 层新增 `GET /artifacts/:id/versions/:versionId/content` 端点，返回版本内容

## 影响范围（Scope）

### 涉及模块

| 模块 | 影响 | 说明 |
|------|------|------|
| kanban (Artifacts Tab) | 代码变更 | `artifacts-tab.tsx` 增加内容查看功能 |
| kanban (Spec Viewer) | 代码变更 | `spec-artifact-viewer.tsx` 替换为 Markdown 渲染 |
| api (Artifacts) | 代码变更 | `artifacts.ts` 新增版本内容端点 |
| web (Components) | 新增文件 | 新增 `<MarkdownRenderer>` 通用组件 |
| web (Dependencies) | 依赖变更 | 新增 `react-markdown`、`remark-gfm`、`rehype-highlight` |

### 涉及文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/package.json` | MODIFY | 新增 Markdown 渲染依赖 |
| `packages/web/src/components/markdown-renderer.tsx` | ADD | 通用 Markdown 渲染组件 |
| `packages/web/src/components/spec-artifact-viewer.tsx` | MODIFY | `<pre>` → `<MarkdownRenderer>` |
| `packages/web/src/pages/kanban/task-detail/artifacts-tab.tsx` | MODIFY | 增加版本内容查看 |
| `packages/api/src/routes/artifacts.ts` | MODIFY | 新增版本内容 API 端点 |

### 不涉及

- 数据库 schema 无变更（`artifact_versions.content` 已存储完整内容）
- 不新增 Markdown 编辑器（编辑仍使用 Textarea，保持简单）
- 不实现实时协同编辑
- Orchestrator / Go 服务无变更

## 非目标

- 不实现 WYSIWYG Markdown 编辑器（如 Milkdown、Tiptap），当前阶段仅做渲染
- 不实现 Markdown 文件的导出/下载功能
- 不实现 Markdown 内图片上传和托管
- 不实现 Mermaid 图表渲染（后续迭代考虑）
- 不替换 Monaco Editor 的 YAML 编辑功能

## 风险评估

- **风险等级：低** — 变更集中在前端 UI 渲染层，不影响数据模型和核心流程
- `react-markdown` 是成熟的 React Markdown 渲染库（npm 周下载量 > 2M），生态稳定
- Bundle 体积增量预估：`react-markdown` ~30KB + `remark-gfm` ~10KB + `rehype-highlight` ~15KB（gzip 后），可接受
- 向后兼容：纯渲染层变更，不影响已有数据
