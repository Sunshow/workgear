# Delta Spec: Artifacts Tab 增加 Markdown 内容预览

> **Type:** MODIFIED
> **Module:** kanban
> **Date:** 2026-02-14
> **Change:** markdown-file-viewer

## 概述

修改看板模块 Artifacts Tab，在版本展开区域增加产物内容的 Markdown 渲染预览功能。

---

## 场景

### Scenario 1: 展开版本后查看 Markdown 渲染内容

```gherkin
Given 用户在 Artifacts Tab 展开了某个产物的版本历史
  And 版本列表已加载完成
When 用户点击某个版本条目的「查看内容」按钮
Then 该版本下方展开内容预览区域
  And 调用 GET /api/artifacts/:id/versions/:versionId/content 获取内容
  And 内容以 Markdown 富文本格式渲染（标题、列表、表格、代码块）
  And 代码块具有语法高亮
```

### Scenario 2: 收起已展开的内容预览

```gherkin
Given 某个版本的内容预览已展开
When 用户再次点击该版本的「查看内容」按钮
Then 内容预览区域收起
  And 按钮文案恢复为「查看内容」
```

### Scenario 3: 内容加载中显示 loading 状态

```gherkin
Given 用户点击了「查看内容」按钮
When API 请求尚未返回
Then 内容区域显示加载指示器（如 "加载内容..."）
  And 按钮处于 disabled 状态
```

### Scenario 4: 内容加载失败优雅降级

```gherkin
Given 用户点击了「查看内容」按钮
When API 请求失败（网络错误或 404）
Then 内容区域显示错误提示（如 "内容加载失败"）
  And 用户可以点击重试
```

### Scenario 5: 产物内容为空时的展示

```gherkin
Given 某个版本的 content 字段为空字符串
When 用户查看该版本内容
Then 显示占位提示 "该版本暂无内容"
  And 不渲染空白的 Markdown 区域
```

---

## UI 规格

### 版本条目 — 查看内容按钮

| 属性 | 值 |
|------|-----|
| 位置 | 版本条目右侧，与版本号同行 |
| 组件 | `<Button variant="ghost" size="sm">` |
| 图标 | `<Eye className="h-3 w-3" />` / `<EyeOff>` 切换 |
| 文案 | "查看" / "收起" |

### 内容预览区域

| 属性 | 值 |
|------|-----|
| 位置 | 版本条目下方 |
| 容器 | `rounded-md border bg-background p-4 max-h-[500px] overflow-y-auto` |
| 渲染 | `<MarkdownRenderer content={content} />` |
