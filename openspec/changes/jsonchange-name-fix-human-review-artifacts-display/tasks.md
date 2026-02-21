# Tasks: 修复人工审核节点产物展示问题

## API 层修改

### packages/api/src/routes/artifacts.ts

- [x] 读取现有 artifacts.ts 路由文件，理解当前实现
- [x] 扩展 GET /api/artifacts 接口，添加 types 查询参数支持
  - [x] 解析 types 参数（逗号分隔字符串）
  - [x] 使用 Drizzle ORM 的 inArray 操作符过滤类型
- [x] 确保查询返回字段包含 content 和 createdBy
- [x] 修改错误处理逻辑：taskId 不存在时返回空数组而非 404
- [x] 添加 includeVersions 查询参数支持（可选功能）
- [ ] 编写单元测试验证 types 过滤逻辑
- [ ] 编写集成测试验证完整查询流程

---

## 前端组件修改

### packages/web/src/components/kanban/TaskDetail/ArtifactsTab.tsx

- [x] 读取现有 ArtifactsTab.tsx 组件，理解当前实现
- [x] 添加状态管理：loading, error, typeFilter
- [x] 实现 useEffect 钩子，在组件挂载时获取产物数据
- [x] 实现加载状态 UI（Skeleton 骨架屏）
  - [x] 使用 Shadcn/ui Skeleton 组件
  - [x] 显示 3-5 个占位符卡片
- [x] 实现空状态 UI
  - [x] 显示"No artifacts to review"消息
  - [x] 添加辅助文本说明
- [x] 实现错误状态 UI
  - [x] 显示错误消息
  - [x] 添加重试按钮
- [ ] 实现类型过滤器（可选功能）
  - [ ] 添加类型选择下拉菜单
  - [ ] 更新 API 请求参数
- [x] 优化移动端响应式布局
  - [x] 使用 Tailwind CSS 响应式类
  - [x] 确保触摸目标 ≥ 44px
- [ ] 编写组件单元测试

### packages/web/src/components/kanban/TaskDetail/SpecArtifactViewer.tsx

- [x] 读取现有 SpecArtifactViewer.tsx 组件，理解当前实现
- [x] 确保支持所有产物类型渲染
  - [x] code 类型：使用 Monaco Editor
  - [x] prd/spec 类型：使用 Markdown 渲染器
  - [x] 其他类型：降级为纯文本
- [ ] 添加"Version History"功能
  - [ ] 添加按钮触发版本历史查询
  - [ ] 实现版本列表 UI
  - [ ] 支持版本切换
- [ ] 添加"Relationships"功能
  - [ ] 添加按钮触发关系查询
  - [ ] 实现关系图或列表 UI
  - [ ] 支持导航到关联产物
- [x] 优化移动端全屏对话框体验
  - [x] 使用 Shadcn/ui Dialog 的 fullscreen 模式
- [ ] 编写组件单元测试

---

## 数据库优化（可选）

- [ ] 检查 artifacts 表索引
  - [ ] 确认 taskId 字段有索引
  - [ ] 确认 type 字段有索引（或复合索引）
- [ ] 如需要，添加数据库迁移脚本

---

## 测试与验证

### 单元测试

- [ ] API 层：测试 types 参数解析和过滤
- [ ] API 层：测试空结果集返回
- [ ] 前端：测试 ArtifactsTab 加载状态
- [ ] 前端：测试 ArtifactsTab 空状态
- [ ] 前端：测试 ArtifactsTab 错误状态
- [ ] 前端：测试 SpecArtifactViewer 内容渲染

### 集成测试

- [ ] 端到端测试：创建 HumanReview 任务 → 添加产物 → 查看产物列表
- [ ] 端到端测试：点击产物 → 查看详情 → 查看版本历史
- [ ] 端到端测试：类型过滤功能验证

### 手动测试

- [ ] 在开发环境启动完整服务（API + Web）
- [ ] 创建包含 HumanReview 节点的工作流
- [ ] 执行工作流，触发人工审核
- [ ] 验证产物列表正确显示
- [ ] 验证产物内容正确渲染
- [ ] 验证移动端响应式布局
- [ ] 验证错误处理和重试机制

---

## 文档更新

- [ ] 更新 API 文档，说明新增的 types 和 includeVersions 参数
- [ ] 更新前端组件文档，说明 ArtifactsTab 的使用方式
- [ ] 在 CHANGELOG.md 中记录本次修复

---

## 部署与发布

- [ ] 代码审查（Code Review）
- [ ] 合并到主分支
- [ ] 部署到测试环境验证
- [ ] 部署到生产环境
- [ ] 监控错误日志和性能指标
