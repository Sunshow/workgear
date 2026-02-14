import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '@/lib/api'
import type { CreateTaskDto, Task } from '@/lib/types'
import { useKanbanStore } from '@/stores/kanban-store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface CreateTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  columnId: string
  onSuccess?: () => void
}

export function CreateTaskDialog({ open, onOpenChange, projectId, columnId, onSuccess }: CreateTaskDialogProps) {
  const { addTask } = useKanbanStore()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateTaskDto>()

  async function onSubmit(data: CreateTaskDto) {
    setLoading(true)
    try {
      const task = await api.post('tasks', {
        json: {
          ...data,
          projectId,
          columnId,
        },
      }).json<Task>()
      addTask(task)
      reset()
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Failed to create task:', error)
      alert('创建任务失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>创建一个新的任务</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">任务标题 *</Label>
              <Input
                id="title"
                placeholder="任务标题"
                {...register('title', { required: '任务标题不能为空' })}
              />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                placeholder="任务描述（可选）"
                rows={4}
                {...register('description')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
