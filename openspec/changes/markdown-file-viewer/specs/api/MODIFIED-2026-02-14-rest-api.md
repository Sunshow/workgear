# Delta Spec: REST API 新增产物版本内容端点

> **Type:** MODIFIED
> **Module:** api
> **Date:** 2026-02-14
> **Change:** markdown-file-viewer

## 概述

修改 REST API 模块，新增获取产物版本内容的端点，供前端 Artifacts Tab 加载并渲染 Markdown 内容。

---

## 场景

### Scenario 1: 获取指定版本的内容

```gherkin
Given 产物版本 versionId 存在于 artifact_versions 表
  And 该版本的 content 字段不为空
When 客户端请求 GET /api/artifacts/:artifactId/versions/:versionId/content
Then 响应状态码为 200
  And 响应体为 { content: "..." }
  And content 为该版本的完整 Markdown 文本
```

### Scenario 2: 版本不存在时返回 404

```gherkin
Given versionId 在 artifact_versions 表中不存在
When 客户端请求 GET /api/artifacts/:artifactId/versions/:versionId/content
Then 响应状态码为 404
  And 响应体为 { error: "Version not found" }
```

### Scenario 3: 版本内容为空时返回空字符串

```gherkin
Given 产物版本存在但 content 字段为 NULL 或空字符串
When 客户端请求 GET /api/artifacts/:artifactId/versions/:versionId/content
Then 响应状态码为 200
  And 响应体为 { content: "" }
```

### Scenario 4: 需要认证才能访问

```gherkin
Given 用户未登录（无有效 token）
When 客户端请求 GET /api/artifacts/:artifactId/versions/:versionId/content
Then 响应状态码为 401
  And 响应体为 { error: "Unauthorized" }
```

---

## API 规格

### GET /api/artifacts/:artifactId/versions/:versionId/content

| 属性 | 值 |
|------|-----|
| Method | GET |
| Path | `/artifacts/:artifactId/versions/:versionId/content` |
| Auth | Required（Bearer token） |
| Response 200 | `{ content: string }` |
| Response 404 | `{ error: "Version not found" }` |
| Response 401 | `{ error: "Unauthorized" }` |
