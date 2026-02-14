// Project types
export interface Project {
  id: string
  name: string
  description: string | null
  gitRepoUrl: string | null
  gitAccessToken: string | null
  autoMergePr: boolean
  visibility: 'private' | 'public'
  ownerId: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateProjectDto {
  name: string
  description?: string
  gitRepoUrl?: string
  gitAccessToken?: string
  autoMergePr?: boolean
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
  content: Record<string, any>
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

export interface TemplateParameter {
  name: string
  type: 'text' | 'number' | 'select' | 'textarea'
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
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface NodeRun {
  id: string
  flowRunId: string
  nodeId: string
  nodeType: string | null
  nodeName: string | null
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'rejected' | 'waiting_human' | 'cancelled'
  attempt: number
  input: Record<string, any> | null
  output: Record<string, any> | null
  error: string | null
  reviewAction: string | null
  reviewComment: string | null
  reviewedAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

// Artifact types
export interface Artifact {
  id: string
  taskId: string
  type: string
  title: string
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
