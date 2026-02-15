# Tasks: Result Syntax Highlight & Copy — 结果区域代码高亮与一键复制

## 模块：通用组件 (packages/web/src/components)

### 创建 CodeBlock 组件

- [x] 新建 `code-block.tsx` 文件 **[S]**
- [x] 实现 `<CodeBlock>` 组件，接收 `code`、`language`、`maxHeight`、`className` props **[M]**
- [x] 集成 highlight.js core + 按需注册 JSON 语言包 **[S]**
- [x] 实现 `useEffect` 中调用 `hljs.highlightElement` 进行语法高亮 **[S]**
- [x] 实现复制按钮（Copy / Check 图标切换，2s 自动恢复） **[S]**
- [x] 使用 `navigator.clipboard.writeText` 实现剪贴板写入 **[S]**
- [x] 复制失败时静默处理（try/catch 不弹错误） **[S]**
- [x] 验证 dark mode 下高亮样式和按钮颜色正确 **[S]**

## 模块：MarkdownRenderer (packages/web/src/components)

### 为 Markdown 代码块注入复制按钮

- [x] 在 `markdown-renderer.tsx` 中新增 `PreWithCopy` 内部组件 **[S]**
- [x] 实现 `getTextContent` 递归提取 React children 的纯文本 **[S]**
- [x] 在 `ReactMarkdown` 的 `components` prop 中注册 `pre: PreWithCopy` **[S]**
- [x] 验证 rehype-highlight 的语法高亮不受影响 **[S]**
- [x] 验证行内代码（`code`）不显示复制按钮 **[S]**
- [x] 验证 Spec Artifact Viewer 中代码块的复制功能 **[S]**
- [x] 验证 ArtifactPreviewCard 中代码块的复制功能 **[S]**

## 模块：Flow Tab (packages/web/src/pages/kanban/task-detail)

### 节点执行结果使用 CodeBlock

- [x] 在 `flow-tab.tsx` 中导入 `<CodeBlock>` 组件 **[S]**
- [x] 将节点执行结果的 `<pre>` 替换为 `<CodeBlock code={...} language="json">` **[S]**
- [x] 将待审核内容的 `<pre>` 替换为 `<CodeBlock code={...} language="json">` **[S]**
- [x] 验证展开节点后 JSON 有语法高亮 **[S]**
- [x] 验证复制按钮可正常复制 JSON 内容 **[S]**

## 模块：Node Log Dialog (packages/web/src/components)

### 工具日志使用 CodeBlock

- [x] 在 `node-log-dialog.tsx` 中导入 `<CodeBlock>` 组件 **[S]**
- [x] 将 `tool_use` 事件的 `tool_input` `<pre>` 替换为 `<CodeBlock language="json">` **[S]**
- [x] 为 `tool_result` 事件的 content 区域添加复制按钮（使用 CodeBlock，不指定 language） **[S]**
- [x] 将 `default` 事件的 fallback `<pre>` 替换为 `<CodeBlock language="json">` **[S]**
- [x] 验证日志对话框中各类事件的高亮和复制功能 **[S]**

## 测试验证

### 端到端验证

- [ ] Flow Tab → 展开已完成节点 → 确认 JSON 有语法高亮 + 复制按钮可用 **[S]**
- [ ] Flow Tab → 展开 waiting_human 节点 → 确认待审核 JSON 有高亮 + 复制 **[S]**
- [ ] Node Log Dialog → 查看 tool_use 日志 → 确认 tool_input JSON 有高亮 + 复制 **[S]**
- [ ] Node Log Dialog → 查看 tool_result 日志 → 确认文本有复制按钮 **[S]**
- [ ] MarkdownRenderer → 查看含代码块的 Markdown → 确认代码块有复制按钮 **[S]**
- [ ] 点击复制 → 粘贴到文本编辑器 → 确认内容正确（无 HTML 标签） **[S]**
- [ ] Dark mode → 所有场景高亮样式和按钮颜色正确 **[S]**
- [ ] 行内代码（`code`）不显示复制按钮 **[S]**

## 模块：OpenSpec 文档

- [ ] 归档完成后更新 `openspec/specs/kanban/2026-02-14-kanban-board.md` **[S]**
- [ ] 归档完成后更新 `openspec/specs/artifact/2026-02-14-artifact-management.md` **[S]**
