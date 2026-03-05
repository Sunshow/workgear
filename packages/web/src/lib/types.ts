// Project types
export type GitMergeMethod = 'merge' | 'squash' | 'rebase'
export type GitProviderType = 'github' | 'gitlab' | 'generic'

export interface Project {
  id: string
  name: string
  description: string | null
  gitRepoUrl: string | null
  gitProviderType: GitProviderType
  gitBaseUrl: string | null
  gitAccessToken: string | null
  gitUsername: string | null
  gitPassword: string | null
  autoMergePr: boolean
  gitMergeMethod: GitMergeMethod
  visibility: 'private' | 'public'
  ownerId: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateProjectDto {
  name: string
  description?: string
  gitRepoUrl?: string
  gitProviderType?: GitProviderType
  gitBaseUrl?: string
  gitAccessToken?: string
  gitUsername?: string
  gitPassword?: string
  autoMergePr?: boolean
  gitMergeMethod?: GitMergeMethod
  visibility?: 'private' | 'public'
}

// Kanban types
export interface Kanban {
  id: string
  projectId: string
  name: string
  createdAt: string
}

export interface KanbanColumn {
  id: string
  kanbanId: string
  name: string
  position: number
  createdAt: string
}

// Task types
export interface Task {
  id: string
  projectId: string
  columnId: string
  title: string
  description: string | null
  position: number
  gitBranch: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTaskDto {
  projectId: string
  columnId: string
  title: string
  description?: string
}

export interface UpdateTaskDto {
  title?: string
  description?: string
  columnId?: string
  position?: number
  gitBranch?: string
}

// Timeline types
export interface TimelineEvent {
  id: string
  taskId: string
  flowRunId: string | null
  nodeRunId: string | null
  eventType: string
  content: string | Record<string, any>
  createdAt: string
}

// Workflow types
export interface WorkflowTemplate {
  id: string
  slug: string
  name: string
  description: string | null
  category: string | null
  difficulty: string | null
  estimatedTime: string | null
  parameters: TemplateParameter[]
  template: string
  isBuiltin: boolean
  createdAt: string
}

export interface AgentPoolItem {
  role: string
  description: string
}

export interface TemplateParameter {
  name: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'agent_pool'
  label: string
  default?: any
  options?: string[]
  min?: number
  max?: number
  required?: boolean
}

export interface Workflow {
  id: string
  projectId: string
  templateId: string | null
  name: string
  dsl: string
  templateParams: Record<string, any> | null
  createdAt: string
  updatedAt: string
}

export interface CreateWorkflowDto {
  projectId: string
  templateId?: string
  name: string
  dsl: string
  templateParams?: Record<string, any>
}

export interface UpdateWorkflowDto {
  name?: string
  dsl?: string
  templateParams?: Record<string, any>
}

export interface ValidateDslResponse {
  valid: boolean
  errors: string[]
  parsed?: any
}

// FlowRun types
export interface FlowRun {
  id: string
  taskId: string
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  error: string | null
  dslSnapshot: string | null
  variables: Record<string, any> | null
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  prMergedAt: string | null
  mergeCommitSha: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface TransientArtifact {
  type: 'markdown' | 'json' | 'text'
  content: string
  editedBy?: string
  editedAt?: string
}

export interface NodeRun {
  id: string
  flowRunId: string
  nodeId: string
  nodeType: string | null
  nodeName: string | null
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'rejected' | 'waiting_human' | 'cancelled'
  attempt: number
  config: Record<string, any> | null
  input: Record<string, any> | null
  output: Record<string, any> | null
  error: string | null
  reviewAction: string | null
  reviewComment: string | null
  reviewedAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  transientArtifacts?: Record<string, TransientArtifact> | null
}

// Artifact types
export interface Artifact {
  id: string
  taskId: string
  flowRunId: string | null
  nodeRunId: string | null
  type: string
  title: string
  filePath: string | null
  createdAt: string
}

export interface ArtifactVersion {
  id: string
  artifactId: string
  version: number
  content: string
  changeSummary: string | null
  createdBy: string | null
  createdAt: string
}

export interface Story {
  id: string
  title: string
  priority?: string
  storyPoints?: number
  content: string
}

export interface CreateTaskFromArtifactDto {
  projectId: string
  columnId: string
  artifactId: string
  selectedStories: Story[]
  taskTitle: string
  flowType: 'simple' | 'full'
  artifactContent?: string
}

// Agent Type 定义（系统固化）
export interface ProviderField {
  key: string
  label: string
  type: 'string' | 'secret' | 'select'
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface AgentTypeDefinition {
  name: string
  description: string
  providerFields: ProviderField[]
}

// Agent Provider
export interface AgentProvider {
  id: string
  agentType: string
  name: string
  config: Record<string, any>
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

// Agent Model
export interface AgentModel {
  id: string
  providerId: string
  modelName: string
  displayName: string | null
  isDefault: boolean
  createdAt: string
}

// Agent Role types
export interface AgentRole {
  id: string
  slug: string
  name: string
  description: string | null
  agentType: string
  providerId: string | null
  modelId: string | null
  systemPrompt: string
  skillIds: string[]
  isBuiltin: boolean
  createdAt: string
  updatedAt: string
  providerName?: string | null
  modelName?: string | null
}

// Skill types
export interface Skill {
  id: string
  name: string
  description: string | null
  prompt: string
  sourceUrl: string | null
  createdAt: string
  updatedAt: string
}
