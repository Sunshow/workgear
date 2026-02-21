# CHANGELOG

## [Unreleased]

### Fixed
- 修复人工审核节点产物展示问题：API 查询不再引用 artifacts 表中不存在的 content/createdBy 字段
- 修复 Drizzle ORM 多个 `.where()` 链式调用覆盖问题，改用 `and()` 组合条件

### Added
- API: `GET /api/artifacts` 支持 `types` 查询参数，按产物类型过滤（逗号分隔）
- API: `GET /api/artifacts` 支持 `includeVersions` 查询参数，返回最新版本信息
- 前端: ArtifactsTab 组件新增类型筛选功能
- 前端: SpecArtifactViewer 组件新增"版本历史"按钮和版本切换功能
- 前端: SpecArtifactViewer 组件新增"关联文档"按钮和关系展示
- 数据库: 为 artifacts 表添加 task_id 和 type 索引
- 数据库: 为 artifact_links 表添加 source_id 索引
- 测试: API artifacts 路由单元测试（types 参数解析、查询验证、过滤优先级）
- 测试: ArtifactsTab 组件单元测试（加载、空状态、错误、重试、分组）
- 测试: SpecArtifactViewer 组件单元测试（加载、错误、空状态、编辑、全屏）

### Changed
- API: taskId 不存在时返回 200 + 空数组，而非 404 错误
- 前端: ArtifactsTab 使用 `useMemo` 优化类型过滤性能
