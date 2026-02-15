import { pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, unique, index } from 'drizzle-orm/pg-core'

// ============================================================
// 用户表
// ============================================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================
// 刷新令牌表
// ============================================================
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_refresh_tokens_user_id').on(table.userId),
])

// ============================================================
// 项目表
// ============================================================
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  gitRepoUrl: varchar('git_repo_url', { length: 500 }),
  gitAccessToken: varchar('git_access_token', { length: 500 }),
  autoMergePr: boolean('auto_merge_pr').default(false).notNull(),
  gitMergeMethod: varchar('git_merge_method', { length: 20 }).default('merge').notNull(),
  visibility: varchar('visibility', { length: 20 }).default('private').notNull(),
  ownerId: uuid('owner_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================
// 项目成员表
// ============================================================
export const projectMembers = pgTable('project_members', {
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('project_members_pk').on(table.projectId, table.userId),
])

// ============================================================
// 看板表
// ============================================================
export const kanbans = pgTable('kanbans', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================
// 看板列
// ============================================================
export const kanbanColumns = pgTable('kanban_columns', {
  id: uuid('id').primaryKey().defaultRandom(),
  kanbanId: uuid('kanban_id').notNull().references(() => kanbans.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('kanban_columns_kanban_id_position_unique').on(table.kanbanId, table.position),
])

// ============================================================
// 任务表
// ============================================================
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  columnId: uuid('column_id').notNull().references(() => kanbanColumns.id),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  position: integer('position').notNull(),
  gitBranch: varchar('git_branch', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_tasks_project_id').on(table.projectId),
  index('idx_tasks_column_id').on(table.columnId),
])

// ============================================================
// 流程模板表
// ============================================================
export const workflowTemplates = pgTable('workflow_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 50 }),
  difficulty: varchar('difficulty', { length: 20 }),
  estimatedTime: varchar('estimated_time', { length: 50 }),
  parameters: jsonb('parameters').default([]),
  template: text('template').notNull(),
  isBuiltin: boolean('is_builtin').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================
// 项目流程表
// ============================================================
export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  templateId: uuid('template_id').references(() => workflowTemplates.id),
  name: varchar('name', { length: 200 }).notNull(),
  dsl: text('dsl').notNull(),
  templateParams: jsonb('template_params'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

// ============================================================
// 流程实例表
// ============================================================
export const flowRuns = pgTable('flow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id),
  status: varchar('status', { length: 50 }).notNull(),
  error: text('error'),
  dslSnapshot: text('dsl_snapshot'),
  variables: jsonb('variables'),
  branchName: varchar('branch_name', { length: 200 }),
  prUrl: varchar('pr_url', { length: 500 }),
  prNumber: integer('pr_number'),
  prMergedAt: timestamp('pr_merged_at', { withTimezone: true }),
  mergeCommitSha: varchar('merge_commit_sha', { length: 100 }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_flow_runs_task_id').on(table.taskId),
])

// ============================================================
// 节点执行表
// ============================================================
export const nodeRuns = pgTable('node_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  flowRunId: uuid('flow_run_id').notNull().references(() => flowRuns.id, { onDelete: 'cascade' }),
  nodeId: varchar('node_id', { length: 100 }).notNull(),
  nodeType: varchar('node_type', { length: 50 }),
  nodeName: varchar('node_name', { length: 200 }),
  status: varchar('status', { length: 50 }).notNull(),
  attempt: integer('attempt').default(1),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  lockedBy: varchar('locked_by', { length: 100 }),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  reviewAction: varchar('review_action', { length: 50 }),
  reviewComment: text('review_comment'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  recoveryCheckpoint: jsonb('recovery_checkpoint'),
  logStream: jsonb('log_stream'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_node_runs_flow_run_id').on(table.flowRunId),
])

// ============================================================
// 节点执行历史表
// ============================================================
export const nodeRunHistory = pgTable('node_run_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeRunId: uuid('node_run_id').notNull().references(() => nodeRuns.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================
// 产物表
// ============================================================
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  flowRunId: uuid('flow_run_id').references(() => flowRuns.id, { onDelete: 'set null' }),
  nodeRunId: uuid('node_run_id').references(() => nodeRuns.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  filePath: text('file_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_artifacts_flow_run').on(table.flowRunId),
  index('idx_artifacts_node_run').on(table.nodeRunId),
])

// ============================================================
// 产物版本表
// ============================================================
export const artifactVersions = pgTable('artifact_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  artifactId: uuid('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  changeSummary: text('change_summary'),
  createdBy: varchar('created_by', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('artifact_versions_artifact_id_version_unique').on(table.artifactId, table.version),
  index('idx_artifact_versions_artifact_id').on(table.artifactId),
])

// ============================================================
// 产物关联表
// ============================================================
export const artifactLinks = pgTable('artifact_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
  linkType: varchar('link_type', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================
// 时间线事件表
// ============================================================
export const timelineEvents = pgTable('timeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  flowRunId: uuid('flow_run_id').references(() => flowRuns.id, { onDelete: 'cascade' }),
  nodeRunId: uuid('node_run_id').references(() => nodeRuns.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  content: jsonb('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_timeline_events_task_id').on(table.taskId),
])

// ============================================================
// Agent Provider 表
// ============================================================
export const agentProviders = pgTable('agent_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentType: varchar('agent_type', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  config: jsonb('config').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('agent_providers_type_name').on(table.agentType, table.name),
  index('idx_agent_providers_type').on(table.agentType),
])

// ============================================================
// Agent Model 表
// ============================================================
export const agentModels = pgTable('agent_models', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerId: uuid('provider_id').notNull().references(() => agentProviders.id, { onDelete: 'cascade' }),
  modelName: varchar('model_name', { length: 100 }).notNull(),
  displayName: varchar('display_name', { length: 200 }),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('agent_models_provider_model').on(table.providerId, table.modelName),
  index('idx_agent_models_provider').on(table.providerId),
])

// ============================================================
// Agent 角色模板表
// ============================================================
export const agentRoles = pgTable('agent_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  agentType: varchar('agent_type', { length: 50 }).notNull().default('claude-code'),
  providerId: uuid('provider_id').references(() => agentProviders.id, { onDelete: 'set null' }),
  modelId: uuid('model_id').references(() => agentModels.id, { onDelete: 'set null' }),
  systemPrompt: text('system_prompt').notNull(),
  isBuiltin: boolean('is_builtin').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
