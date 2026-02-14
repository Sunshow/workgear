# Tasks: Markdown File Viewer — 产物内容 Markdown 渲染与预览

## 模块：前端依赖 (packages/web)

### 安装 Markdown 渲染依赖

- [x] 安装 `react-markdown` 依赖 **[S]**
- [x] 安装 `remark-gfm` 插件（GFM 表格、任务列表、删除线） **[S]**
- [x] 安装 `rehype-highlight` 插件（代码块语法高亮） **[S]**
- [x] 安装 `highlight.js` 的 CSS 主题文件（如 github 主题） **[S]**
- [x] 确认是否需要安装 `@tailwindcss/typography`，若需要则安装 **[S]**

## 模块：通用组件 (packages/web/src/components)

### 创建 MarkdownRenderer 组件

- [x] 新建 `markdown-renderer.tsx` 文件 **[S]**
- [x] 实现 `<MarkdownRenderer>` 组件，接收 `content` 和 `className` props **[S]**
- [x] 集成 `react-markdown` + `remark-gfm` + `rehype-highlight` 插件链 **[S]**
- [x] 添加 Markdown 排版样式（prose 类或手写 CSS） **[M]**
- [x] 引入 highlight.js CSS 主题（代码块高亮样式） **[S]**
- [x] 验证 GFM 表格、任务列表、代码块渲染效果 **[S]**

## 模块：Spec Artifact Viewer (packages/web/src/components)

### 替换纯文本渲染为 Markdown 渲染

- [x] 在 `spec-artifact-viewer.tsx` 中导入 `<MarkdownRenderer>` 组件 **[S]**
- [x] 将 ArtifactContent 查看模式的 `<pre>` 替换为 `<MarkdownRenderer>` **[S]**
- [x] 添加内容区域滚动容器（`max-h-[600px] overflow-y-auto`） **[S]**
- [x] 保持编辑模式的 Textarea 不变 **[S]**
- [ ] 验证 proposal.md / design.md / tasks.md / delta specs 渲染效果 **[S]**

## 模块：API 端点 (packages/api/src/routes)

### 新增版本内容端点

- [x] 在 `artifacts.ts` 中新增 `GET /:id/versions/:versionId/content` 路由 **[S]**
- [x] 实现查询 `artifact_versions` 表获取 content 字段 **[S]**
- [x] 版本不存在时返回 404 `{ error: "Version not found" }` **[S]**
- [x] content 为空时返回 `{ content: "" }` **[S]**

## 模块：Artifacts Tab (packages/web/src/pages/kanban/task-detail)

### 增加版本内容查看功能

- [x] 在 `artifacts-tab.tsx` 中新增 `viewingVersionId` / `versionContent` / `contentLoading` state **[S]**
- [x] 实现 `loadVersionContent(artifactId, versionId)` 函数，调用内容 API **[S]**
- [x] 在版本条目右侧添加「查看」/「收起」按钮（Eye / EyeOff 图标） **[S]**
- [x] 点击「查看」时展开内容预览区域，使用 `<MarkdownRenderer>` 渲染 **[M]**
- [x] 加载中显示 loading 指示器 **[S]**
- [x] 加载失败显示错误提示 **[S]**
- [x] 内容为空时显示占位提示 "该版本暂无内容" **[S]**
- [x] 再次点击「收起」时关闭内容预览 **[S]**

## 测试验证

### 端到端验证

- [ ] Spec Artifact Viewer → 打开 proposal.md → 确认标题、表格、列表正确渲染 **[S]**
- [ ] Spec Artifact Viewer → 打开 delta spec → 确认 Gherkin 代码块有语法高亮 **[S]**
- [ ] Spec Artifact Viewer → 编辑模式 → 确认 Textarea 正常，保存后切回渲染 **[S]**
- [ ] Artifacts Tab → 展开版本 → 点击查看 → 确认 Markdown 内容正确渲染 **[S]**
- [ ] Artifacts Tab → 版本内容为空 → 确认显示占位提示 **[S]**
- [ ] Artifacts Tab → 网络异常 → 确认显示错误提示 **[S]**

## 模块：OpenSpec 文档

- [ ] 归档完成后更新 `openspec/specs/kanban/2026-02-14-kanban-board.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/artifact/2026-02-14-artifact-management.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/api/2026-02-14-rest-api.md` **[S]**
