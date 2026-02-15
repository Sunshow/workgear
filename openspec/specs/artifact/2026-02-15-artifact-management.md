# Delta Spec: MarkdownRenderer 代码块复制按钮 & CodeBlock 通用组件

> **Type:** MODIFIED
> **Module:** artifact
> **Date:** 2026-02-15
> **Change:** result-syntax-highlight-copy

## 概述

修改产物管理模块中的 MarkdownRenderer 组件，为 Markdown 渲染的代码块注入复制按钮。同时新增通用 `<CodeBlock>` 组件，供 MarkdownRenderer 和其他场景复用。

---

## 场景

### Scenario 1: Markdown 代码块显示复制按钮

```gherkin
Given 用户查看包含代码块的 Markdown 内容（通过 MarkdownRenderer 渲染）
  And 代码块使用 ``` 语法标记（如 ```typescript、```json、```gherkin）
When 代码块渲染完成
Then 代码块右上角显示一个「复制」按钮（Copy 图标）
  And 代码块保持原有的语法高亮效果（rehype-highlight）
  And 复制按钮不遮挡代码内容
```

### Scenario 2: 点击复制按钮复制代码内容

```gherkin
Given Markdown 代码块右上角显示复制按钮
When 用户点击复制按钮
Then 代码块的纯文本内容（不含 HTML 标签）复制到系统剪贴板
  And 按钮图标从 Copy 切换为 Check（✓）表示复制成功
  And 2 秒后图标自动恢复为 Copy
```

### Scenario 3: 复制失败的降级处理

```gherkin
Given 浏览器不支持 Clipboard API 或用户拒绝了剪贴板权限
When 用户点击复制按钮
Then 复制操作静默失败
  And 按钮不切换为 Check 图标
  And 不弹出错误提示（避免干扰用户）
```

### Scenario 4: 行内代码不显示复制按钮

```gherkin
Given Markdown 内容包含行内代码（`code`）
When 行内代码渲染
Then 行内代码保持原有样式
  And 不显示复制按钮（仅代码块显示）
```

### Scenario 5: CodeBlock 组件独立使用

```gherkin
Given 开发者在非 Markdown 场景中使用 <CodeBlock> 组件
  And 传入 code（字符串）和 language（可选）props
When 组件渲染
Then 代码以指定语言的语法高亮展示
  And 右上角显示复制按钮
  And 点击复制可将 code 文本复制到剪贴板
```

### Scenario 6: CodeBlock 支持 dark mode

```gherkin
Given 用户切换到 dark mode
When CodeBlock 组件渲染
Then 代码高亮使用 dark 主题配色（与现有 .dark .hljs 样式一致）
  And 复制按钮颜色适配 dark mode
  And 代码块背景色适配 dark mode
```
