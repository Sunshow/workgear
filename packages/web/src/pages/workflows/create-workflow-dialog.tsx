import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/lib/api'
import type { WorkflowTemplate } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CreateWorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  templates: WorkflowTemplate[]
  onCreated: () => void
}

const categoryLabels: Record<string, string> = {
  development: '开发',
  analysis: '分析',
  review: '审查',
  bugfix: '修复',
}

const difficultyColors: Record<string, string> = {
  beginner: 'bg-green-100 text-green-800',
  intermediate: 'bg-yellow-100 text-yellow-800',
  advanced: 'bg-red-100 text-red-800',
}

export function CreateWorkflowDialog({
  open,
  onOpenChange,
  projectId,
  templates,
  onCreated,
}: CreateWorkflowDialogProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'select' | 'params'>('select')
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null)
  const [workflowName, setWorkflowName] = useState('')
  const [params, setParams] = useState<Record<string, any>>({})
  const [creating, setCreating] = useState(false)

  function handleSelectTemplate(template: WorkflowTemplate) {
    setSelectedTemplate(template)
    setWorkflowName(template.name)
    // Initialize params with defaults
    const defaults: Record<string, any> = {}
    const parameters = template.parameters as WorkflowTemplate['parameters']
    for (const param of parameters) {
      if (param.default !== undefined) {
        defaults[param.name] = param.default
      }
    }
    setParams(defaults)
    setStep('params')
  }

  function handleParamChange(name: string, value: any) {
    setParams((prev) => ({ ...prev, [name]: value }))
  }

  async function handleCreate() {
    if (!selectedTemplate) return
    setCreating(true)
    try {
      const workflow = await api
        .post('workflows', {
          json: {
            projectId,
            templateId: selectedTemplate.id,
            name: workflowName,
            dsl: selectedTemplate.template,
            templateParams: params,
          },
        })
        .json<{ id: string }>()

      onCreated()
      // Navigate to editor
      navigate(`/projects/${projectId}/workflows/${workflow.id}/edit`)
    } catch (error) {
      console.error('Failed to create workflow:', error)
      alert('创建流程失败')
    } finally {
      setCreating(false)
    }
  }

  function handleClose(open: boolean) {
    if (!open) {
      setStep('select')
      setSelectedTemplate(null)
      setWorkflowName('')
      setParams({})
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === 'select' ? '选择流程模板' : '配置流程参数'}</DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? '选择一个内置模板开始创建工作流程'
              : '配置流程参数，然后进入编辑器微调'}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="grid gap-3 mt-4">
            {templates.map((template) => {
              const parameters = template.parameters as WorkflowTemplate['parameters']
              return (
                <Card
                  key={template.id}
                  className="cursor-pointer p-4 transition-colors hover:bg-accent"
                  onClick={() => handleSelectTemplate(template)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{template.name}</h3>
                        {template.category && (
                          <Badge variant="outline">
                            {categoryLabels[template.category] || template.category}
                          </Badge>
                        )}
                        {template.difficulty && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${difficultyColors[template.difficulty] || ''}`}
                          >
                            {template.difficulty}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
                      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                        {template.estimatedTime && <span>⏱ {template.estimatedTime}</span>}
                        <span>📋 {parameters.length} 个参数</span>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {step === 'params' && selectedTemplate && (
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="workflow-name">流程名称</Label>
              <Input
                id="workflow-name"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="border-t pt-4">
              <h4 className="mb-3 text-sm font-medium">模板参数</h4>
              <div className="space-y-3">
                {(selectedTemplate.parameters as WorkflowTemplate['parameters']).map((param) => (
                  <div key={param.name}>
                    <Label htmlFor={`param-${param.name}`}>
                      {param.label}
                      {param.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    {param.type === 'select' && param.options ? (
                      <Select
                        value={String(params[param.name] || '')}
                        onValueChange={(value) => handleParamChange(param.name, value)}
                      >
                        <SelectTrigger id={`param-${param.name}`} className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {param.options.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : param.type === 'number' ? (
                      <Input
                        id={`param-${param.name}`}
                        type="number"
                        value={params[param.name] ?? ''}
                        onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                        min={param.min}
                        max={param.max}
                        className="mt-1"
                      />
                    ) : (
                      <Input
                        id={`param-${param.name}`}
                        value={params[param.name] ?? ''}
                        onChange={(e) => handleParamChange(param.name, e.target.value)}
                        className="mt-1"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep('select')}>
                返回
              </Button>
              <Button onClick={handleCreate} disabled={creating || !workflowName.trim()}>
                {creating ? '创建中...' : '创建并编辑'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
