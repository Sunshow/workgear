import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { Plus, FileCode, Trash2, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import type { Project, Workflow, WorkflowTemplate } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreateWorkflowDialog } from './create-workflow-dialog'

export function WorkflowsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    if (projectId) loadData()
  }, [projectId])

  async function loadData() {
    try {
      const [projectData, workflowsData, templatesData] = await Promise.all([
        api.get(`projects/${projectId}`).json<Project>(),
        api.get('workflows', { searchParams: { projectId: projectId! } }).json<Workflow[]>(),
        api.get('workflow-templates').json<WorkflowTemplate[]>(),
      ])
      setProject(projectData)
      setWorkflows(workflowsData)
      setTemplates(templatesData)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定要删除这个流程吗？')) return
    try {
      await api.delete(`workflows/${id}`)
      setWorkflows((prev) => prev.filter((w) => w.id !== id))
    } catch (error) {
      console.error('Failed to delete workflow:', error)
    }
  }

  function handleEdit(id: string) {
    navigate(`/projects/${projectId}/workflows/${id}/edit`)
  }

  function handleCreated() {
    setDialogOpen(false)
    loadData()
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{project?.name} - 流程管理</h1>
            <p className="text-sm text-muted-foreground">管理项目的工作流程</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            创建流程
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileCode className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg text-muted-foreground">暂无流程</p>
            <p className="mb-4 text-sm text-muted-foreground">从模板创建你的第一个工作流程</p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              创建流程
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workflows.map((workflow) => {
              const template = templates.find((t) => t.id === workflow.templateId)
              return (
                <Card key={workflow.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold">{workflow.name}</h3>
                      {template && (
                        <Badge variant="secondary" className="mt-1">
                          {template.name}
                        </Badge>
                      )}
                      <p className="mt-2 text-xs text-muted-foreground">
                        创建于 {new Date(workflow.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(workflow.id)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(workflow.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <CreateWorkflowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId!}
        templates={templates}
        onCreated={handleCreated}
      />
    </div>
  )
}
