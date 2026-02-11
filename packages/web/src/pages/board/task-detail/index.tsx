import { useState } from 'react'
import { Pencil, Trash2, Play } from 'lucide-react'
import { api } from '@/lib/api'
import type { Task } from '@/lib/types'
import { useBoardStore } from '@/stores/board-store'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TimelineTab } from './timeline-tab'
import { FlowTab } from './flow-tab'
import { ArtifactsTab } from './artifacts-tab'
import { GitTab } from './git-tab'
import { StartFlowDialog } from './start-flow-dialog'

interface TaskDetailProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}

export function TaskDetail({ task, open, onOpenChange, onDeleted }: TaskDetailProps) {
  const { updateTask, removeTask } = useBoardStore()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startFlowOpen, setStartFlowOpen] = useState(false)
  const [flowRefreshKey, setFlowRefreshKey] = useState(0)

  function startEditing() {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description || '')
    setEditing(true)
  }

  async function saveEdit() {
    if (!task) return
    try {
      await api.put(`tasks/${task.id}`, {
        json: { title, description },
      })
      updateTask(task.id, { title, description })
      setEditing(false)
    } catch (error) {
      console.error('Failed to update task:', error)
      alert('更新任务失败')
    }
  }

  async function handleDelete() {
    if (!task) return
    if (!confirm('确定要删除这个任务吗？')) return
    try {
      await api.delete(`tasks/${task.id}`)
      removeTask(task.id)
      onOpenChange(false)
      onDeleted?.()
    } catch (error) {
      console.error('Failed to delete task:', error)
      alert('删除任务失败')
    }
  }

  if (!task) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          {editing ? (
            <div className="space-y-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg font-semibold"
              />
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="任务描述"
                rows={3}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit}>保存</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>取消</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <SheetTitle className="text-xl">{task.title}</SheetTitle>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => setStartFlowOpen(true)}>
                    <Play className="mr-1 h-4 w-4" />
                    启动流程
                  </Button>
                  <Button variant="ghost" size="icon" onClick={startEditing}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleDelete}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <SheetDescription>{task.description || '暂无描述'}</SheetDescription>
            </>
          )}
        </SheetHeader>

        <div className="mt-6">
          <Tabs defaultValue="timeline">
            <TabsList className="w-full">
              <TabsTrigger value="timeline" className="flex-1">时间线</TabsTrigger>
              <TabsTrigger value="flow" className="flex-1">流程</TabsTrigger>
              <TabsTrigger value="artifacts" className="flex-1">产物</TabsTrigger>
              <TabsTrigger value="git" className="flex-1">Git</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline">
              <TimelineTab taskId={task.id} />
            </TabsContent>
            <TabsContent value="flow">
              <FlowTab taskId={task.id} refreshKey={flowRefreshKey} />
            </TabsContent>
            <TabsContent value="artifacts">
              <ArtifactsTab taskId={task.id} />
            </TabsContent>
            <TabsContent value="git">
              <GitTab gitBranch={task.gitBranch} />
            </TabsContent>
          </Tabs>
        </div>

        <StartFlowDialog
          taskId={task.id}
          projectId={task.projectId}
          open={startFlowOpen}
          onOpenChange={setStartFlowOpen}
          onSuccess={() => setFlowRefreshKey((k) => k + 1)}
        />
      </SheetContent>
    </Sheet>
  )
}
