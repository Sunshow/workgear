import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { FlowRun, NodeRun } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { XCircle } from 'lucide-react'

interface FlowTabProps {
  taskId: string
  refreshKey?: number
}

const statusLabels: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  rejected: '已拒绝',
  waiting_human: '等待人工',
}

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'default',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
  rejected: 'destructive',
  waiting_human: 'default',
}

export function FlowTab({ taskId, refreshKey }: FlowTabProps) {
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([])
  const [nodeRuns, setNodeRuns] = useState<NodeRun[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    loadFlowRuns()
  }, [taskId, refreshKey])

  async function loadFlowRuns() {
    setLoading(true)
    try {
      const data = await api.get(`flow-runs?taskId=${taskId}`).json<FlowRun[]>()
      setFlowRuns(data)
      if (data.length > 0) {
        await loadNodeRuns(data[0].id)
      }
    } catch (error) {
      console.error('Failed to load flow runs:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadNodeRuns(flowRunId: string) {
    try {
      const data = await api.get(`flow-runs/${flowRunId}/nodes`).json<NodeRun[]>()
      setNodeRuns(data)
    } catch (error) {
      console.error('Failed to load node runs:', error)
    }
  }

  async function handleCancel(flowRunId: string) {
    if (!confirm('确定要取消此流程吗？')) return
    setCancelling(true)
    try {
      await api.put(`flow-runs/${flowRunId}/cancel`)
      await loadFlowRuns()
    } catch (error) {
      console.error('Failed to cancel flow:', error)
      alert('取消流程失败')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return <p className="py-4 text-center text-sm text-muted-foreground">加载中...</p>
  }

  if (flowRuns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">暂无流程信息</p>
        <p className="mt-1 text-xs text-muted-foreground">点击"启动流程"按钮开始执行</p>
      </div>
    )
  }

  const latestFlow = flowRuns[0]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">流程状态：</span>
          <Badge variant={statusColors[latestFlow.status] || 'outline'}>
            {statusLabels[latestFlow.status] || latestFlow.status}
          </Badge>
        </div>
        {(latestFlow.status === 'pending' || latestFlow.status === 'running') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCancel(latestFlow.id)}
            disabled={cancelling}
          >
            <XCircle className="mr-1 h-4 w-4" />
            取消流程
          </Button>
        )}
      </div>

      {latestFlow.error && (
        <div className="rounded-md bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{latestFlow.error}</p>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium">节点执行进度</h4>
        <div className="space-y-2">
          {nodeRuns.map((node, index) => (
            <div key={node.id} className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-xs font-medium">
                {index + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{node.nodeId}</span>
                  <Badge variant={statusColors[node.status] || 'outline'} className="text-xs">
                    {statusLabels[node.status] || node.status}
                  </Badge>
                </div>
                {node.error && (
                  <p className="mt-1 text-xs text-destructive">{node.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {flowRuns.length > 1 && (
        <div className="pt-4">
          <p className="text-xs text-muted-foreground">
            共 {flowRuns.length} 次执行记录
          </p>
        </div>
      )}
    </div>
  )
}
