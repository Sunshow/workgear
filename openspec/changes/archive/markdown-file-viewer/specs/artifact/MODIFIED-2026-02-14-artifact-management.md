# Delta Spec: Spec Artifact Viewer Markdown 渲染增强

> **Type:** MODIFIED
> **Module:** artifact
> **Date:** 2026-02-14
> **Change:** markdown-file-viewer

## 概述

修改产物管理模块中 OpenSpec 文档查看器的渲染方式，将纯文本 `<pre>` 展示替换为 Markdown 富文本渲染。

---

## 场景

### Scenario 1: OpenSpec 文档以 Markdown 格式渲染

```gherkin
Given 用户打开 Spec Artifact Viewer 查看 OpenSpec 文档
  And 文档内容为 Markdown 格式（包含标题、列表、表格、代码块）
When 文档内容加载完成
Then 内容以 Markdown 富文本格式渲染
  And 标题（# ## ###）渲染为对应层级的 HTML 标题
  And 表格渲染为带边框的 HTML 表格
  And 代码块渲染为带语法高亮的 <pre><code> 块
  And Gherkin 代码块（```gherkin）具有语法高亮
```

### Scenario 2: GFM 扩展语法正确渲染

```gherkin
Given 文档内容包含 GFM 扩展语法
When Markdown 渲染器处理内容
Then 任务列表（- [ ] / - [x]）渲染为复选框列表
  And 删除线（~~text~~）渲染为删除线文本
  And 表格对齐（:--- / :---: / ---:）正确应用
```

### Scenario 3: 编辑模式保持 Textarea

```gherkin
Given 用户在 Spec Artifact Viewer 中点击「编辑」按钮
When 进入编辑模式
Then 内容区域切换为 Textarea 编辑器（保持当前行为）
  And Textarea 显示原始 Markdown 文本
  And 用户可以编辑 Markdown 源码
```

### Scenario 4: 保存后切回 Markdown 渲染

```gherkin
Given 用户在编辑模式中修改了内容
When 用户点击「保存」按钮且保存成功
Then 退出编辑模式
  And 内容区域切回 Markdown 富文本渲染
  And 渲染内容反映最新的修改
```

### Scenario 5: 代码块语法高亮

```gherkin
Given 文档内容包含带语言标记的代码块
When Markdown 渲染器处理代码块
Then TypeScript 代码块（```typescript）具有语法高亮
  And Go 代码块（```go）具有语法高亮
  And Gherkin 代码块（```gherkin）具有语法高亮
  And 无语言标记的代码块以默认样式渲染
```
