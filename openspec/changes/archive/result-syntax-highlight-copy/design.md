# Design: Result Syntax Highlight & Copy — 结果区域代码高亮与一键复制

## 技术方案

### 方案概述

新建通用 `<CodeBlock>` 组件，封装 highlight.js 语法高亮 + Clipboard API 一键复制功能。改造 `<MarkdownRenderer>` 通过 `components.pre` 注入复制按钮，改造 `flow-tab.tsx` 和 `node-log-dialog.tsx` 将纯文本 `<pre>` 替换为 `<CodeBlock>`。

### 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 高亮方案 | highlight.js（直接调用） | 项目已通过 rehype-highlight 间接依赖 highlight.js，直接调用避免新增依赖 |
| 复制方案 | `navigator.clipboard.writeText` | 浏览器原生 API，无需第三方库，现代浏览器全面支持 |
| 组件拆分 | 通用 `<CodeBlock>` | 4 处使用场景（MarkdownRenderer、FlowTab、NodeLogDialog × 2），抽取通用组件避免重复 |
| Markdown 集成 | `components.pre` 自定义渲染器 | react-markdown 支持通过 components prop 覆盖 HTML 元素渲染，无需修改 rehype 插件链 |
| 复制反馈 | 图标切换 Copy → Check | 轻量视觉反馈，无需 toast 通知，与主流代码展示工具（GitHub、VS Code）体验一致 |
| 非 Markdown 场景高亮 | highlight.js `highlightElement` | 对 FlowTab/NodeLogDialog 中的 JSON 内容，使用 highlight.js 手动高亮 |

### 备选方案（已排除）

- **Shiki**：基于 VS Code 的语法高亮引擎，效果更好但体积大（~2MB WASM），且项目已使用 highlight.js，切换成本高。
- **Prism.js**：另一个流行的高亮库，但与现有 rehype-highlight 生态不兼容，需要替换整个高亮方案。
- **react-copy-to-clipboard**：第三方复制库，但仅封装了 `document.execCommand('copy')`（已废弃），不如直接使用 Clipboard API。

---

## 数据流

### CodeBlock 组件渲染流程

```
<CodeBlock code={string} language?={string} />
    │
    ├── useRef → <code> DOM 元素引用
    │
    ├── useEffect → highlight.js highlightElement(codeEl)
    │   │  仅在 language 存在时执行高亮
    │   │  JSON 内容自动检测（language="json"）
    │   │
    │   ▼
    │   <pre> + <code class="hljs language-xxx"> 带高亮标记
    │
    └── CopyButton（绝对定位右上角）
        │
        ├── onClick → navigator.clipboard.writeText(code)
        │   │
        │   ├── 成功 → setCopied(true) → 2s 后 setCopied(false)
        │   │
        │   └── 失败 → 静默忽略
        │
        └── 渲染 → copied ? <Check /> : <Copy />
```

### MarkdownRenderer 集成流程

```
<MarkdownRenderer content={markdown} />
    │
    ▼
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight]}
  components={{ pre: PreWithCopy }}    ← 新增
>
    │
    ▼
rehype-highlight 处理代码块 → <pre><code class="hljs language-xxx">...</code></pre>
    │
    ▼
PreWithCopy 拦截 <pre> 渲染
    │
    ├── 提取子元素 <code> 的 textContent
    │
    └── 渲染为:
        <div className="relative group">
          <pre>{children}</pre>          ← 保留 rehype-highlight 的高亮结果
          <CopyButton text={textContent} />  ← 注入复制按钮
        </div>
```

### FlowTab / NodeLogDialog 集成流程

```
nodeRun.output (JSON object)
    │
    ▼
JSON.stringify(output, null, 2) → 格式化 JSON 字符串
    │
    ▼
<CodeBlock code={jsonString} language="json" maxHeight="12rem" />
    │
    ├── highlight.js 高亮 JSON 语法
    │
    └── 右上角复制按钮 → 复制 JSON 文本
```

---

## 文件变更清单

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `packages/web/src/components/code-block.tsx` | 通用代码块组件（语法高亮 + 复制按钮） |

### 修改文件

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `packages/web/src/components/markdown-renderer.tsx` | MODIFY | 添加 `components.pre` 自定义渲染器，注入复制按钮 |
| `packages/web/src/pages/kanban/task-detail/flow-tab.tsx` | MODIFY | 执行结果/待审核内容 `<pre>` → `<CodeBlock>` |
| `packages/web/src/components/node-log-dialog.tsx` | MODIFY | 工具调用输入/输出/fallback `<pre>` → `<CodeBlock>` |

### 删除文件

无

---

## 具体代码变更

### 1. `packages/web/src/components/code-block.tsx`（新增）

```tsx
import { useRef, useEffect, useState } from 'react'
import hljs from 'highlight.js/lib/core'
import json from 'highlight.js/lib/languages/json'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

hljs.registerLanguage('json', json)

interface CodeBlockProps {
  code: string
  language?: string
  maxHeight?: string
  className?: string
}

export function CodeBlock({ code, language, maxHeight = '12rem', className }: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (codeRef.current && language) {
      codeRef.current.removeAttribute('data-highlighted')
      hljs.highlightElement(codeRef.current)
    }
  }, [code, language])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 静默失败
    }
  }

  return (
    <div className={cn('relative group', className)}>
      <pre className={cn('rounded bg-muted p-2 text-xs overflow-auto', maxHeight && `max-h-[${maxHeight}]`)}>
        <code ref={codeRef} className={language ? `language-${language}` : ''}>
          {code}
        </code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground
                   hover:bg-muted-foreground/20 hover:text-foreground transition-colors"
        title="复制"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
```

说明：
- 使用 highlight.js core + 按需注册语言，避免加载全部语言包
- JSON 为默认注册语言（最常用场景），其他语言通过 rehype-highlight 在 Markdown 中处理
- `maxHeight` 支持自定义最大高度，默认 12rem（约 192px）
- 复制按钮始终可见，hover 时增强视觉反馈

### 2. `packages/web/src/components/markdown-renderer.tsx`（修改）

在 ReactMarkdown 的 `components` prop 中添加 `pre` 自定义渲染器：

```tsx
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// 在 MarkdownRenderer 组件内部添加 PreWithCopy
function PreWithCopy({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false)

  function getTextContent(node: React.ReactNode): string {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(getTextContent).join('')
    if (node && typeof node === 'object' && 'props' in node) {
      return getTextContent((node as React.ReactElement).props.children)
    }
    return ''
  }

  async function handleCopy() {
    try {
      const text = getTextContent(children)
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="relative group">
      <pre {...props}>{children}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 rounded p-1 text-muted-foreground
                   hover:bg-muted-foreground/20 hover:text-foreground transition-colors"
        title="复制"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

// ReactMarkdown 添加 components prop
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight]}
  components={{ pre: PreWithCopy }}
>
```

### 3. `packages/web/src/pages/kanban/task-detail/flow-tab.tsx`（修改）

将节点执行结果和待审核内容的 `<pre>` 替换为 `<CodeBlock>`：

```tsx
// 导入
import { CodeBlock } from '@/components/code-block'

// 执行结果（约 L322）
// 替换前:
<pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-48">
  {JSON.stringify(filterInternalFields(nodeRun.output), null, 2)}
</pre>

// 替换后:
<CodeBlock
  code={JSON.stringify(filterInternalFields(nodeRun.output), null, 2)}
  language="json"
  maxHeight="12rem"
/>

// 待审核内容（约 L348）同理替换
```

### 4. `packages/web/src/components/node-log-dialog.tsx`（修改）

将工具调用输入、工具结果、默认事件的 `<pre>` 替换为 `<CodeBlock>`：

```tsx
// 导入
import { CodeBlock } from '@/components/code-block'

// tool_use 事件的 tool_input（约 L125）
// 替换前:
<pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs">
  {JSON.stringify(event.tool_input, null, 2)}
</pre>

// 替换后:
<CodeBlock
  code={JSON.stringify(event.tool_input, null, 2)}
  language="json"
  className="mt-2"
/>

// default 事件（约 L159）同理替换
```

---

## 样式方案

### 复制按钮样式

复制按钮使用 Tailwind 工具类实现，无需额外 CSS：

```
absolute top-1.5 right-1.5    → 绝对定位右上角
rounded p-1                    → 圆角 + 内边距
text-muted-foreground          → 默认灰色
hover:bg-muted-foreground/20   → hover 时半透明背景
hover:text-foreground          → hover 时文字变深
transition-colors              → 颜色过渡动画
```

### Dark Mode 兼容

- CodeBlock 使用 `bg-muted` 背景色，自动适配 dark mode（通过 CSS 变量）
- 复制按钮使用 `text-muted-foreground` / `text-foreground`，自动适配
- highlight.js 高亮样式已有 `.dark .hljs` 覆盖（在 index.css 中）

---

## 测试策略

- 手动验证：Flow Tab → 展开已完成节点 → 确认 JSON 有语法高亮 + 复制按钮可用
- 手动验证：Node Log Dialog → 查看工具调用日志 → 确认 tool_input JSON 有高亮 + 复制
- 手动验证：MarkdownRenderer → 查看含代码块的 Markdown → 确认代码块有复制按钮
- 手动验证：点击复制按钮 → 粘贴到文本编辑器 → 确认内容正确
- 手动验证：Dark mode 下所有场景的高亮和按钮样式正确
