# Delta Spec: Flow Tab 与 Node Log Dialog 代码高亮与复制

> **Type:** MODIFIED
> **Module:** kanban
> **Date:** 2026-02-15
> **Change:** result-syntax-highlight-copy

## 概述

修改看板模块中 Flow Tab 的节点执行结果展示和 Node Log Dialog 的工具调用日志展示，将纯文本 `<pre>` 替换为带语法高亮和复制按钮的 `<CodeBlock>` 组件。

---

## 场景

### Scenario 1: 节点执行结果以 JSON 语法高亮展示

```gherkin
Given 用户在 Flow Tab 展开一个已完成的节点
  And 该节点有 output 数据（JSON 格式）
When 节点展开区域渲染执行结果
Then output JSON 以语法高亮格式展示（关键字、字符串、数字等有不同颜色）
  And 高亮样式与 Markdown 代码块的 highlight.js 主题一致
  And 支持 dark mode 下的高亮配色
```

### Scenario 2: 节点执行结果支持一键复制

```gherkin
Given 节点执行结果以 JSON 高亮格式展示
When 用户点击代码块右上角的「复制」按钮
Then JSON 文本内容复制到系统剪贴板
  And 按钮图标从 Copy 切换为 Check（✓）
  And 2 秒后图标自动恢复为 Copy
```

### Scenario 3: 工具调用输入以 JSON 语法高亮展示

```gherkin
Given 用户在 Node Log Dialog 查看执行日志
  And 日志中包含 tool_use 类型事件（工具调用）
  And 事件包含 tool_input 数据（JSON 格式）
When 工具调用事件渲染
Then tool_input JSON 以语法高亮格式展示
  And 代码块右上角显示复制按钮
  And 点击复制可将 JSON 文本复制到剪贴板
```

### Scenario 4: 工具结果支持复制

```gherkin
Given 日志中包含 tool_result 类型事件
  And 事件包含 content 文本内容
When 工具结果事件渲染
Then content 以纯文本格式展示（保持当前行为）
  And 文本区域右上角显示复制按钮
  And 点击复制可将文本内容复制到剪贴板
```

### Scenario 5: 待审核内容以 JSON 高亮展示

```gherkin
Given 用户在 Flow Tab 展开一个 waiting_human 状态的节点
  And 该节点有 input 数据（待审核内容，JSON 格式）
When 待审核内容区域渲染
Then input JSON 以语法高亮格式展示
  And 代码块右上角显示复制按钮
```

### Scenario 6: 默认日志事件支持复制

```gherkin
Given Node Log Dialog 中出现未知类型的日志事件
When 事件以 JSON fallback 格式渲染
Then JSON 内容以语法高亮展示
  And 代码块右上角显示复制按钮
```

---

## UI 规格

### CodeBlock 复制按钮

| 属性 | 值 |
|------|-----|
| 位置 | 代码块右上角，绝对定位 |
| 组件 | `<button>` with `Copy` / `Check` icon |
| 图标大小 | `h-3.5 w-3.5` |
| 交互 | 点击复制 → 图标切换为 Check → 2s 后恢复 |
| 可见性 | 始终可见（代码块内容区域） |
