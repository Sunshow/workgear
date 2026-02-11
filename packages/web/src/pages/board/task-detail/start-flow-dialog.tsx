import { useState, useEffect } from 'react'
import { Play } from 'lucide-react'
import { api } from '@/lib/api'
import type { Workflow } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface StartFlowDialogProps {
  taskId: string
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function StartFlowDialog({
  taskId,
  projectId,
  open,
  onOpenChange,
  onSuccess,
}: StartFlowDialogProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      loadWorkflows()
    }
  }, [open, projectId])

  async function loadWorkflows() {
    setLoading(true)
    try {
      const data = await api
        .get(`workflows?projectId=${projectId}`)
        .json<Workflow[]>()
      setWorkflows(data)
      if (data.length > 0) {
        setSelectedWorkflowId(data[0].id)
      }
    } catch (error) {
      console.error('Failed to load workflows:', error)
      alert('加载流程列表失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleStart() {
    if (!selectedWorkflowId) {
      alert('请选择一个流程')
      return
    }

    setSubmitting(true)
    try {
      await api.post('flow-runs', {
        json: {
          taskId,
          workflowId: selectedWorkflowId,
        },
      })
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Failed to start flow:', error)
      alert('启动流程失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>启动任务流程</DialogTitle>
          <DialogDescription>
            选择一个流程模板来启动此任务
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : workflows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              暂无可用流程，请先在项目中创建流程
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="workflow">选择流程</Label>
              <Select
                value={selectedWorkflowId}
                onValueChange={setSelectedWorkflowId}
              >
                <SelectTrigger id="workflow">
                  <SelectValue placeholder="选择流程" />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleStart}
            disabled={!selectedWorkflowId || submitting || loading}
          >
            <Play className="mr-2 h-4 w-4" />
            {submitting ? '启动中...' : '启动'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
