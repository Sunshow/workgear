# Design: Markdown File Viewer — 产物内容 Markdown 渲染与预览

## 技术方案

### 方案概述

引入 `react-markdown` 生态库，创建通用 `<MarkdownRenderer>` 组件，改造 Spec Artifact Viewer 和 Artifacts Tab 的内容展示，将纯文本替换为 Markdown 富文本渲染。同时在 API 层新增版本内容端点。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Markdown 渲染库 | `react-markdown` | React 生态最成熟的 Markdown 渲染库，周下载量 > 2M，支持 remark/rehype 插件体系 |
| GFM 支持 | `remark-gfm` 插件 | 项目中大量使用 GFM 表格和任务列表，需要原生支持 |
| 代码高亮 | `rehype-highlight` | 基于 highlight.js，轻量且支持 Gherkin 语法，无需额外配置 |
| 组件封装 | 通用 `<MarkdownRenderer>` | 两处使用场景（Spec Viewer + Artifacts Tab），抽取通用组件避免重复 |
| 编辑模式 | 保持 Textarea | 不引入 WYSIWYG 编辑器，保持简单，降低复杂度 |
| 内容获取 | 新增 API 端点 | Artifacts Tab 的版本列表 API 不返回 content（避免大量数据），按需加载 |

### 备选方案（已排除）

- **Monaco Editor Markdown Preview**：使用 Monaco 的 Markdown 预览模式。排除原因：Monaco 已用于 YAML 编辑，Markdown 预览需要额外配置，且渲染效果不如 react-markdown。
- **marked + DOMPurify**：使用 marked 库生成 HTML 后用 DOMPurify 清洗。排除原因：需要手动处理 XSS，react-markdown 基于 AST 渲染天然安全，无需 dangerouslySetInnerHTML。
- **MDX**：使用 MDX 支持在 Markdown 中嵌入 React 组件。排除原因：过度设计，当前场景只需渲染静态 Markdown 内容。

---

## 数据流

### Spec Artifact Viewer — Markdown 渲染

```
用户打开 Spec Artifact Viewer
    │
    ▼
fetchArtifacts() 获取 OpenSpec 文档列表
    │  GET /api/projects/:projectId/openspec/changes/:changeName
    │
    ▼
artifacts[] 包含 { path, relativePath, content }
    │
    ▼
ArtifactContent 组件渲染
    │
    ├── isEditing = false（查看模式）
    │   │
    │   ▼
    │   <MarkdownRenderer content={artifact.content} />
    │   │  react-markdown 解析 Markdown AST
    │   │  remark-gfm 处理 GFM 扩展
    │   │  rehype-highlight 添加代码高亮
    │   │
    │   ▼
    │   渲染为 HTML（标题、表格、代码块、列表）
    │
    └── isEditing = true（编辑模式）
        │
        ▼
        <Textarea>（保持当前行为不变）
```

### Artifacts Tab — 版本内容预览

```
用户在 Artifacts Tab 展开产物版本历史
    │
    ▼
版本列表已加载（不含 content）
    │
    ▼
用户点击某版本的「查看」按钮
    │
    ▼
调用 GET /api/artifacts/:id/versions/:versionId/content
    │
    ├── 加载中 → 显示 "加载内容..."
    │
    ├── 成功 → { content: "# Markdown..." }
    │   │
    │   ▼
    │   <MarkdownRenderer content={content} />
    │   │
    │   ▼
    │   在版本条目下方展开渲染后的内容
    │
    └── 失败 → 显示 "内容加载失败" + 重试按钮
```

---

## 文件变更清单

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `packages/web/src/components/markdown-renderer.tsx` | 通用 Markdown 渲染组件 |

### 修改文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/package.json` | MODIFY | 新增 react-markdown、remark-gfm、rehype-highlight 依赖 |
| `packages/web/src/components/spec-artifact-viewer.tsx` | MODIFY | `<pre>` → `<MarkdownRenderer>` |
| `packages/web/src/pages/kanban/task-detail/artifacts-tab.tsx` | MODIFY | 增加版本内容查看功能 |
| `packages/api/src/routes/artifacts.ts` | MODIFY | 新增 GET /:id/versions/:versionId/content 端点 |

### 删除文件

无

---

## 具体代码变更

### 1. `packages/web/src/components/markdown-renderer.tsx`（新增）

```tsx
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('prose prose-sm max-w-none dark:prose-invert', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
```

说明：
- 使用 Tailwind CSS 的 `prose` 类提供排版样式（需确认是否已安装 `@tailwindcss/typography`，若未安装则手写基础样式）
- `max-w-none` 防止 prose 默认的 max-width 限制
- 支持 dark mode（`dark:prose-invert`）

### 2. `packages/web/src/components/spec-artifact-viewer.tsx`（修改）

将 ArtifactContent 组件中的查看模式从：

```tsx
<div className="rounded-md border bg-gray-50 p-4">
  <pre className="whitespace-pre-wrap text-sm">{artifact.content}</pre>
</div>
```

替换为：

```tsx
<div className="rounded-md border bg-background p-4 max-h-[600px] overflow-y-auto">
  <MarkdownRenderer content={artifact.content} />
</div>
```

### 3. `packages/web/src/pages/kanban/task-detail/artifacts-tab.tsx`（修改）

在版本条目中增加内容查看功能：

```tsx
// 新增 state
const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
const [versionContent, setVersionContent] = useState<string>('')
const [contentLoading, setContentLoading] = useState(false)

// 加载版本内容
async function loadVersionContent(artifactId: string, versionId: string) {
  if (viewingVersionId === versionId) {
    setViewingVersionId(null)
    return
  }
  setViewingVersionId(versionId)
  setContentLoading(true)
  try {
    const data = await api
      .get(`artifacts/${artifactId}/versions/${versionId}/content`)
      .json<{ content: string }>()
    setVersionContent(data.content)
  } catch {
    setVersionContent('')
  } finally {
    setContentLoading(false)
  }
}
```

### 4. `packages/api/src/routes/artifacts.ts`（修改）

新增端点：

```typescript
// 获取产物版本内容
app.get<{ Params: { id: string; versionId: string } }>(
  '/:id/versions/:versionId/content',
  async (request, reply) => {
    const { id, versionId } = request.params

    const [version] = await db
      .select({ content: artifactVersions.content })
      .from(artifactVersions)
      .where(eq(artifactVersions.id, versionId))

    if (!version) {
      return reply.status(404).send({ error: 'Version not found' })
    }

    return { content: version.content || '' }
  }
)
```

---

## 样式方案

### 方案 A：使用 @tailwindcss/typography（推荐）

如果项目已安装或可以安装 `@tailwindcss/typography`，直接使用 `prose` 类：

```tsx
<div className="prose prose-sm max-w-none">
  <ReactMarkdown>{content}</ReactMarkdown>
</div>
```

### 方案 B：手写基础样式

如果不想引入额外依赖，在 MarkdownRenderer 中通过 CSS 类手写基础排版：

```css
.markdown-body h1 { font-size: 1.5em; font-weight: 700; margin: 1em 0 0.5em; }
.markdown-body h2 { font-size: 1.25em; font-weight: 600; margin: 0.8em 0 0.4em; }
.markdown-body table { border-collapse: collapse; width: 100%; }
.markdown-body td, .markdown-body th { border: 1px solid #e5e7eb; padding: 0.5em; }
.markdown-body pre { background: #f3f4f6; padding: 1em; border-radius: 0.375rem; overflow-x: auto; }
.markdown-body code { font-size: 0.875em; }
```

建议优先尝试方案 A，Tailwind CSS 4 的 `@tailwindcss/typography` 插件与现有技术栈兼容。

---

## 测试策略

- 手动验证：Spec Artifact Viewer 打开 proposal.md → 确认标题、表格、代码块正确渲染
- 手动验证：Spec Artifact Viewer 打开 delta spec → 确认 Gherkin 代码块有语法高亮
- 手动验证：Spec Artifact Viewer 编辑模式 → 确认切换为 Textarea，保存后切回渲染
- 手动验证：Artifacts Tab 展开版本 → 点击查看 → 确认内容以 Markdown 渲染
- 手动验证：Artifacts Tab 版本内容为空 → 确认显示占位提示
- 手动验证：断网时点击查看 → 确认显示错误提示
