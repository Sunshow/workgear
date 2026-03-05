import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '@/lib/api'
import type { Artifact, Story, CreateTaskFromArtifactDto } from '@/lib/types'
import { useKanbanStore } from '@/stores/kanban-store'
import { DraggableResizableDialog } from '@/components/draggable-resizable-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ReactMarkdown from 'react-markdown'

interface CreateTaskFromArtifactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  columnId: string
  onSuccess?: () => void
}

export function CreateTaskFromArtifactDialog({
  open,
  onOpenChange,
  projectId,
  columnId,
  onSuccess,
}: CreateTaskFromArtifactDialogProps) {
  const isMobile = useIsMobile()
  const { addTask } = useKanbanStore()
  const [loading, setLoading] = useState(false)
  const [loadingArtifacts, setLoadingArtifacts] = useState(false)
  const [error, setError] = useState<string>('')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>('')
  const [artifactContent, setArtifactContent] = useState<string>('')
  const [parsedStories, setParsedStories] = useState<Story[]>([])
  const [selectedStoryIds, setSelectedStoryIds] = useState<Set<string>>(new Set())
  const [flowType, setFlowType] = useState<'simple' | 'full'>('simple')
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<{ taskTitle: string }>()

  // 加载产物列表
  useEffect(() => {
    if (open && projectId) {
      loadArtifacts()
    }
  }, [open, projectId])

  async function loadArtifacts() {
    setLoadingArtifacts(true)
    setError('')
    try {
      const result = await api.get('artifacts', {
        searchParams: { projectId, type: 'user_story' },
      }).json<Artifact[]>()
      setArtifacts(result)
      if (result.length > 0) {
        setSelectedArtifactId(result[0].id)
      } else {
        setError('当前项目没有 User Story 产物。请先运行需求分析流程生成 User Story。')
      }
    } catch (error: any) {
      console.error('Failed to load artifacts:', error)
      setError('加载产物失败：' + (error.message || '未知错误'))
    } finally {
      setLoadingArtifacts(false)
    }
  }

  // 加载产物内容
  useEffect(() => {
    if (selectedArtifactId) {
      loadArtifactContent(selectedArtifactId)
    }
  }, [selectedArtifactId])

  async function loadArtifactContent(artifactId: string) {
    try {
      const result = await api.get(`artifacts/${artifactId}/latest-content`).json<{ content: string }>()
      setArtifactContent(result.content)
      const stories = parseUserStories(result.content)
      setParsedStories(stories)
      // 默认全选
      setSelectedStoryIds(new Set(stories.map(s => s.id)))
    } catch (error) {
      console.error('Failed to load artifact content:', error)
    }
  }

  // 解析 User Stories（兼容多种格式）
  function parseUserStories(content: string): Story[] {
    const stories: Story[] = []
    const lines = content.split('\n')
    let currentStory: Partial<Story> | null = null

    // 支持的格式：
    // #### US-001: 标题 (P0, 5SP)
    // ### US-01: 标题
    // US-01: 标题
    // **US-01: 标题**
    const storyPattern = /^(?:#{2,4}\s+)?(?:\*{0,2})(US-\d+)[：:]\s*(.+?)(?:\*{0,2})(?:\s*[（(]([P0-3])(?:[,，]\s*(\d+)\s*SP)?[)）])?$/

    for (const line of lines) {
      const trimmed = line.trim()
      const match = trimmed.match(storyPattern)
      if (match) {
        if (currentStory && currentStory.id) {
          stories.push(currentStory as Story)
        }
        currentStory = {
          id: match[1],
          title: match[2].trim(),
          priority: match[3] || undefined,
          storyPoints: match[4] ? parseInt(match[4]) : undefined,
          content: '',
        }
      } else if (currentStory && trimmed) {
        currentStory.content += line + '\n'
      }
    }
    if (currentStory && currentStory.id) {
      stories.push(currentStory as Story)
    }
    return stories
  }

  // 计算总工作量
  const totalStoryPoints = parsedStories
    .filter(s => selectedStoryIds.has(s.id))
    .reduce((sum, s) => sum + (s.storyPoints || 0), 0)

  // 自动生成任务标题
  useEffect(() => {
    if (parsedStories.length > 0 && selectedStoryIds.size > 0) {
      const selectedStories = parsedStories.filter(s => selectedStoryIds.has(s.id))
      if (selectedStories.length === 1) {
        setValue('taskTitle', `实现：${selectedStories[0].title}`)
      } else {
        const firstId = selectedStories[0].id
        const lastId = selectedStories[selectedStories.length - 1].id
        setValue('taskTitle', `实现：${firstId}~${lastId}`)
      }
    } else if (selectedArtifactId && parsedStories.length === 0) {
      const artifact = artifacts.find(a => a.id === selectedArtifactId)
      if (artifact) {
        setValue('taskTitle', `实现：${artifact.title}`)
      }
    }
  }, [selectedStoryIds, parsedStories, selectedArtifactId, artifacts, setValue])

  function toggleStory(storyId: string) {
    const newSet = new Set(selectedStoryIds)
    if (newSet.has(storyId)) {
      newSet.delete(storyId)
    } else {
      newSet.add(storyId)
    }
    setSelectedStoryIds(newSet)
  }

  async function onSubmit(data: { taskTitle: string }) {
    setLoading(true)
    setError('')
    try {
      const selectedStories = parsedStories.length > 0
        ? parsedStories.filter(s => selectedStoryIds.has(s.id))
        : []
      const payload: CreateTaskFromArtifactDto = {
        projectId,
        columnId,
        artifactId: selectedArtifactId,
        selectedStories,
        taskTitle: data.taskTitle,
        flowType,
        artifactContent: selectedStories.length === 0 ? artifactContent : undefined,
      }

      const result = await api.post('tasks/from-artifact', { json: payload }).json<{ task: any; flowRunId: string }>()
      addTask(result.task)
      onOpenChange(false)
      onSuccess?.()
    } catch (error: any) {
      console.error('Failed to create task from artifact:', error)
      const errorMsg = error.response?.error || error.message || '创建任务失败'
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <DraggableResizableDialog
      open={open}
      onOpenChange={onOpenChange}
      title="从产物创建开发任务"
      defaultWidth={680}
      defaultHeight={600}
      minWidth={600}
      minHeight={500}
      footer={
        <div className={isMobile ? 'flex flex-col-reverse gap-2 w-full' : 'flex gap-2'}>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className={isMobile ? 'h-11 text-base w-full' : ''}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="create-task-from-artifact-form"
            disabled={loading || !selectedArtifactId}
            className={isMobile ? 'h-11 text-base w-full' : ''}
          >
            {loading ? '创建中...' : '创建任务'}
          </Button>
        </div>
      }
    >
      <form id="create-task-from-artifact-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* 错误提示 */}
        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
            {error}
          </div>
        )}

        {/* 选择产物 */}
        <div className="space-y-2">
          <Label className={isMobile ? 'text-sm' : ''}>选择产物 *</Label>
          {loadingArtifacts ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : artifacts.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无可用产物</div>
          ) : (
            <Select value={selectedArtifactId} onValueChange={setSelectedArtifactId}>
              <SelectTrigger className={isMobile ? 'h-11 text-base' : ''}>
                <SelectValue placeholder="选择产物" />
              </SelectTrigger>
              <SelectContent>
                {artifacts.map(artifact => (
                  <SelectItem key={artifact.id} value={artifact.id}>
                    {artifact.title} ({new Date(artifact.createdAt).toLocaleString()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* 产物内容预览 */}
        {artifactContent && (
          <div className="space-y-2">
            <Label className={isMobile ? 'text-sm' : ''}>产物内容预览</Label>
            <div className="border rounded-md p-3 max-h-[300px] overflow-y-auto text-sm">
              <ReactMarkdown>{artifactContent}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* 选择 Stories */}
        {parsedStories.length > 0 && (
          <div className="space-y-2">
            <Label className={isMobile ? 'text-sm' : ''}>选择要实现的 Stories *</Label>
            <div className="border rounded-md p-3 max-h-[200px] overflow-y-auto space-y-2">
              {parsedStories.map(story => (
                <div key={story.id} className="flex items-start gap-2">
                  <Checkbox
                    id={story.id}
                    checked={selectedStoryIds.has(story.id)}
                    onCheckedChange={() => toggleStory(story.id)}
                  />
                  <label htmlFor={story.id} className="text-sm cursor-pointer flex-1">
                    {story.id}: {story.title}
                    {story.priority && (
                      <span className="text-muted-foreground ml-2">
                        ({story.priority}{story.storyPoints ? `, ${story.storyPoints}SP` : ''})
                      </span>
                    )}
                  </label>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              已选择 {selectedStoryIds.size} 个 Stories
              {totalStoryPoints > 0 && `，总工作量：${totalStoryPoints} SP`}
            </p>
          </div>
        )}

        {/* 开发流程 */}
        <div className="space-y-2">
          <Label className={isMobile ? 'text-sm' : ''}>开发流程 *</Label>
          <RadioGroup value={flowType} onValueChange={(v: string) => setFlowType(v as 'simple' | 'full')}>
            <div className="flex items-start space-x-2 border rounded-md p-3">
              <RadioGroupItem value="simple" id="simple" />
              <div className="flex-1">
                <label htmlFor="simple" className="text-sm font-medium cursor-pointer">
                  标准流程（生成任务清单）
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  生成 tasks.md 后直接实施<br />
                  适合：技术方案相对明确的任务
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2 border rounded-md p-3">
              <RadioGroupItem value="full" id="full" />
              <div className="flex-1">
                <label htmlFor="full" className="text-sm font-medium cursor-pointer">
                  完整流程（生成完整 OpenSpec）
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  生成技术方案、设计文档、任务清单<br />
                  适合：需要架构设计或多模块协同的复杂任务
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* 任务标题 */}
        <div className="space-y-2">
          <Label htmlFor="taskTitle" className={isMobile ? 'text-sm' : ''}>任务标题</Label>
          <Input
            id="taskTitle"
            placeholder="任务标题"
            className={isMobile ? 'h-11 text-base' : ''}
            {...register('taskTitle', { required: '任务标题不能为空' })}
          />
          {errors.taskTitle && <p className="text-sm text-destructive">{errors.taskTitle.message}</p>}
          <p className="text-xs text-muted-foreground">(自动生成，可编辑)</p>
        </div>
      </form>
    </DraggableResizableDialog>
  )
}
