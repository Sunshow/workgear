// Project types
export interface Project {
  id: string
  name: string
  description: string | null
  gitRepoUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateProjectDto {
  name: string
  description?: string
  gitRepoUrl?: string
}

// Board types
export interface Board {
  id: string
  projectId: string
  name: string
  createdAt: string
}

export interface BoardColumn {
  id: string
  boardId: string
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
