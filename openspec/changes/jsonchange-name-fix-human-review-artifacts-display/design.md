# Design: 修复人工审核节点产物展示问题

## 技术方案概述

本次修复聚焦于人工审核（HumanReview）节点的产物展示链路，涉及 API 层查询优化和前端组件增强。核心思路是：

1. **API 层**：扩展产物查询接口，支持类型过滤、版本信息、内容字段返回
2. **前端层**：优化 ArtifactsTab 组件，增加加载状态、空状态、错误处理和类型过滤

## 数据流图

```
┌─────────────────────────────────────────────────────────────────┐
│ User: 打开 HumanReview 任务详情 → 点击 Artifacts Tab              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ ArtifactsTab.tsx                                                 │
│ - useState: loading, artifacts, error, typeFilter               │
│ - useEffect: fetch artifacts on mount                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                   GET /api/artifacts?taskId={taskId}
                   (optional: &types=prd,spec,code)
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Fastify Route: /api/artifacts (GET)                             │
│ - Validate taskId (required)                                    │
│ - Parse types query param (optional)                            │
│ - Query database with filters                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Drizzle ORM Query                                                │
│ SELECT id, taskId, type, title, content, createdAt, createdBy   │
│ FROM artifacts                                                   │
│ WHERE taskId = ? [AND type IN (?)]                              │
│ ORDER BY createdAt DESC                                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Response: 200 with artifacts array                               │
│ [{ id, taskId, type, title, content, createdAt, createdBy }]    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ ArtifactsTab.tsx: Render                                         │
│ - Loading: Skeleton UI                                          │
│ - Empty: "No artifacts to review" message                       │
│ - Success: List of artifacts with type badges                   │
│ - Error: Error message + Retry button                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                   User clicks artifact → Open SpecArtifactViewer
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ SpecArtifactViewer.tsx                                           │
│ - Render content with syntax highlighting (Monaco/Markdown)     │
│ - Show "Version History" button                                 │
│ - Show "Relationships" button                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 文件变更清单

### 1. API 层修改

#### `packages/api/src/routes/artifacts.ts`

**变更内容**：
- 扩展 GET /api/artifacts 查询逻辑
- 添加 `types` 查询参数支持（逗号分隔的类型列表）
- 添加 `includeVersions` 查询参数支持（可选）
- 确保返回字段包含 `content` 和 `createdBy`
- 优化错误处理：taskId 不存在时返回空数组而非 404

**关键代码逻辑**：
```typescript
// 解析 types 参数
const typesParam = request.query.types as string | undefined;
const allowedTypes = typesParam ? typesParam.split(',').map(t => t.trim()) : undefined;

// 构建查询条件
let query = db.select({
  id: artifacts.id,
  taskId: artifacts.taskId,
  type: artifacts.type,
  title: artifacts.title,
  content: artifacts.content,
  createdAt: artifacts.createdAt,
  createdBy: artifacts.createdBy,
}).from(artifacts).where(eq(artifacts.taskId, taskId));

if (allowedTypes && allowedTypes.length > 0) {
  query = query.where(inArray(artifacts.type, allowedTypes));
}

query = query.orderBy(desc(artifacts.createdAt));
```

**依赖**：
- Drizzle ORM: `eq`, `inArray`, `desc` 操作符
- Schema: `artifacts` 表定义

---

### 2. 前端组件修改

#### `packages/web/src/components/kanban/TaskDetail/ArtifactsTab.tsx`

**变更内容**：
- 添加状态管理：`loading`, `error`, `typeFilter`
- 实现加载骨架屏（Skeleton UI）
- 实现空状态 UI（Empty State）
- 实现错误处理和重试机制
- 添加类型过滤器（可选功能）
- 优化移动端响应式布局

**关键代码逻辑**：
```typescript
const [loading, setLoading] = useState(true);
const [artifacts, setArtifacts] = useState<Artifact[]>([]);
const [error, setError] = useState<string | null>(null);
const [typeFilter, setTypeFilter] = useState<string[]>([]);

useEffect(() => {
  const fetchArtifacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ taskId });
      if (typeFilter.length > 0) {
        params.append('types', typeFilter.join(','));
      }
      const response = await fetch(`/api/artifacts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch artifacts');
      const data = await response.json();
      setArtifacts(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  fetchArtifacts();
}, [taskId, typeFilter]);

// Render logic
if (loading) return <SkeletonLoader />;
if (error) return <ErrorState message={error} onRetry={fetchArtifacts} />;
if (artifacts.length === 0) return <EmptyState />;
return <ArtifactsList artifacts={artifacts} />;
```

**依赖**：
- React hooks: `useState`, `useEffect`
- UI 组件: Shadcn/ui (Button, Badge, Skeleton)

---

#### `packages/web/src/components/kanban/TaskDetail/SpecArtifactViewer.tsx`

**变更内容**：
- 确保支持所有产物类型的渲染（markdown, code, text）
- 添加"Version History"按钮和版本切换功能
- 添加"Relationships"按钮和关系图展示
- 优化移动端全屏对话框体验

**关键代码逻辑**：
```typescript
const renderContent = (artifact: Artifact) => {
  if (artifact.type === 'code') {
    return <MonacoEditor value={artifact.content} language="typescript" readOnly />;
  }
  if (artifact.type === 'prd' || artifact.type === 'spec') {
    return <MarkdownRenderer content={artifact.content} />;
  }
  return <pre className="whitespace-pre-wrap">{artifact.content}</pre>;
};

const fetchVersionHistory = async (artifactId: string) => {
  const response = await fetch(`/api/artifacts/${artifactId}/versions`);
  return response.json();
};

const fetchRelationships = async (artifactId: string) => {
  const response = await fetch(`/api/artifacts/${artifactId}/links`);
  return response.json();
};
```

**依赖**：
- Monaco Editor: 代码语法高亮
- Markdown 渲染库: react-markdown 或类似
- Shadcn/ui: Dialog, Tabs 组件

---

## 技术选型理由

### 1. 为什么在 API 层添加 types 过滤而非仅前端过滤？

- **性能优化**：减少网络传输数据量，特别是当产物数量较多时
- **灵活性**：支持未来的高级过滤需求（如分页、搜索）
- **一致性**：与现有 API 设计模式保持一致

### 2. 为什么返回空数组而非 404？

- **用户体验**：空状态是正常业务场景（任务刚创建，尚无产物）
- **前端简化**：统一处理逻辑，无需区分"任务不存在"和"无产物"
- **RESTful 最佳实践**：200 + 空数组表示"查询成功但无结果"

### 3. 为什么使用客户端状态管理而非全局状态？

- **局部性**：产物数据仅在 TaskDetail 面板中使用
- **简单性**：避免引入 Zustand store 的额外复杂度
- **性能**：减少不必要的全局状态更新和重渲染

---

## 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| taskId 不存在 | API 返回 200 + 空数组，前端显示空状态 |
| 网络请求失败 | 显示错误消息 + 重试按钮 |
| 产物内容过大 | 前端使用虚拟滚动或分页加载 |
| 产物类型未知 | 降级为纯文本显示 |
| 移动端小屏幕 | 产物查看器全屏显示 |

---

## 测试策略

### API 层测试
- 单元测试：验证 types 参数解析和过滤逻辑
- 集成测试：验证数据库查询结果正确性
- 边界测试：空 taskId、无效 types、空结果集

### 前端组件测试
- 单元测试：验证加载、错误、空状态渲染
- 集成测试：验证 API 调用和数据展示
- E2E 测试：验证完整的用户交互流程（打开任务 → 查看产物 → 查看版本历史）

---

## 性能考虑

- **数据库索引**：确保 `artifacts.taskId` 和 `artifacts.type` 有索引
- **查询优化**：使用 Drizzle ORM 的 select 指定字段，避免 SELECT *
- **前端缓存**：考虑使用 React Query 或 SWR 缓存产物数据（可选）
- **懒加载**：产物内容较大时，考虑分离 content 字段到单独接口

---

## 安全考虑

- **权限验证**：确保用户有权访问指定 taskId 的产物（依赖现有认证中间件）
- **输入验证**：验证 taskId 格式（UUID），防止 SQL 注入
- **XSS 防护**：产物内容渲染时使用安全的 Markdown 渲染器（DOMPurify）
