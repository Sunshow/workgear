import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { TimelineEvent } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

interface TimelineTabProps {
  taskId: string
}

const eventTypeLabels: Record<string, string> = {
  agent_message: 'Agent 消息',
  human_message: '人工消息',
  status_change: '状态变更',
  review_action: 'Review 操作',
  git_event: 'Git 事件',
  system_event: '系统事件',
}

const eventTypeColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  agent_message: 'default',
  human_message: 'secondary',
  status_change: 'outline',
  review_action: 'destructive',
  git_event: 'secondary',
  system_event: 'outline',
}

export function TimelineTab({ taskId }: TimelineTabProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadTimeline()
  }, [taskId])

  async function loadTimeline() {
    try {
      const data = await api.get(`tasks/${taskId}/timeline`).json<TimelineEvent[]>()
      setEvents(data)
    } catch (error) {
      console.error('Failed to load timeline:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <p className="py-4 text-center text-sm text-muted-foreground">加载中...</p>
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">暂无时间线事件</p>
        <p className="mt-1 text-xs text-muted-foreground">启动流程后，事件将在此显示</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {events.map((event) => (
        <div key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <div className="flex-1 border-l border-border" />
          </div>
          <div className="flex-1 pb-4">
            <div className="flex items-center gap-2">
              <Badge variant={eventTypeColors[event.eventType] || 'outline'}>
                {eventTypeLabels[event.eventType] || event.eventType}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString('zh-CN')}
              </span>
            </div>
            <div className="mt-1 text-sm">
              {typeof event.content === 'string'
                ? event.content
                : JSON.stringify(event.content, null, 2)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
