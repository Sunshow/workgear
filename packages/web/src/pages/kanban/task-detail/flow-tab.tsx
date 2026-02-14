import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { FlowRun, NodeRun } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useFlowRunEvents } from '@/hooks/use-websocket'
import { XCircle, CheckCircle, RotateCcw, Clock, Play, AlertCircle, Pencil, Loader2 } from 'lucide-react'

interface FlowTabProps {
  taskId: string
  refreshKey?: number
}

const statusLabels: Record<string, string> = {
  pending: '待执行',
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  rejected: '已拒绝',
  waiting_human: '等待人工',
}

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  queued: 'outline',
  running: 'default',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
  rejected: 'destructive',
  waiting_human: 'default',
}

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  queued: <Clock className="h-4 w-4 text-blue-500" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <AlertCircle className="h-4 w-4 text-red-500" />,
  cancelled: <XCircle className="h-4 w-4 text-muted-foreground" />,
  rejected: <RotateCcw className="h-4 w-4 text-orange-500" />,
  waiting_human: <Pencil className="h-4 w-4 text-yellow-500" />,
}

export function FlowTab({ taskId, refreshKey }: FlowTabProps) {
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([])
  const [nodeRuns, setNodeRuns] = useState<NodeRun[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)

  const latestFlow = flowRuns[0] || null

  // Load data
  const loadFlowRuns = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get(`flow-runs?taskId=${taskId}`).json<FlowRun[]>()
      setFlowRuns(data)
      if (data.length > 0) {
        const nodes = await api.get(`flow-runs/${data[0].id}/nodes`).json<NodeRun[]>()
        setNodeRuns(nodes)
      }
    } catch (error) {
      console.error('Failed to load flow runs:', error)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    loadFlowRuns()
  }, [loadFlowRuns, refreshKey])

  // Real-time updates via WebSocket
  useFlowRunEvents(latestFlow?.id, {
    onNodeStarted: () => refreshNodeRuns(),
    onNodeCompleted: () => refreshNodeRuns(),
    onNodeWaitingHuman: () => refreshNodeRuns(),
    onNodeFailed: () => refreshNodeRuns(),
    onNodeRejected: () => refreshNodeRuns(),
    onFlowCompleted: () => loadFlowRuns(),
    onFlowFailed: () => loadFlowRuns(),
    onFlowCancelled: () => loadFlowRuns(),
  })

  async function refreshNodeRuns() {
    if (!latestFlow) return
    try {
      const nodes = await api.get(`flow-runs/${latestFlow.id}/nodes`).json<NodeRun[]>()
      setNodeRuns(nodes)
      // Also refresh flow status
      const flow = await api.get(`flow-runs/${latestFlow.id}`).json<FlowRun>()
      setFlowRuns(prev => [flow, ...prev.slice(1)])
    } catch (error) {
      console.error('Failed to refresh:', error)
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

  // Deduplicate node runs: for each nodeId, show only the latest attempt
  const latestNodeRuns = deduplicateNodeRuns(nodeRuns)

  return (
    <div className="space-y-4">
      {/* Flow status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">流程状态：</span>
          <Badge variant={statusColors[latestFlow.status] || 'outline'}>
            {statusLabels[latestFlow.status] || latestFlow.status}
          </Badge>
        </div>
        {(latestFlow.status === 'pending' || latestFlow.status === 'running') && (
          <Button variant="outline" size="sm" onClick={() => handleCancel(latestFlow.id)} disabled={cancelling}>
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

      {/* Node execution progress */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">节点执行进度</h4>
        <div className="space-y-1">
          {latestNodeRuns.map((node) => (
            <NodeRunItem
              key={node.id}
              nodeRun={node}
              onActionComplete={refreshNodeRuns}
            />
          ))}
        </div>
      </div>

      {flowRuns.length > 1 && (
        <p className="pt-2 text-xs text-muted-foreground">共 {flowRuns.length} 次执行记录</p>
      )}
    </div>
  )
}

// ─── NodeRunItem with inline review panel ───

function NodeRunItem({ nodeRun, onActionComplete }: { nodeRun: NodeRun; onActionComplete: () => void }) {
  const [expanded, setExpanded] = useState(nodeRun.status === 'waiting_human')
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Auto-expand when waiting for human
  useEffect(() => {
    if (nodeRun.status === 'waiting_human') {
      setExpanded(true)
    }
  }, [nodeRun.status])

  async function handleReview(action: 'approve' | 'reject' | 'edit_and_approve') {
    setSubmitting(true)
    try {
      await api.post(`node-runs/${nodeRun.id}/review`, {
        json: {
          action,
          feedback: action === 'reject' ? feedback : undefined,
        },
      })
      setFeedback('')
      onActionComplete()
    } catch (error: any) {
      alert(`操作失败: ${error.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRetry() {
    setSubmitting(true)
    try {
      await api.post(`node-runs/${nodeRun.id}/retry`)
      onActionComplete()
    } catch (error: any) {
      alert(`重试失败: ${error.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const displayName = nodeRun.nodeName || nodeRun.nodeId
  const isClickable = nodeRun.status === 'waiting_human' || nodeRun.status === 'completed' || nodeRun.status === 'failed'

  return (
    <div className="rounded-md border">
      {/* Node header */}
      <div
        className={`flex items-center gap-3 px-3 py-2 ${isClickable ? 'cursor-pointer hover:bg-muted/50' : ''}`}
        onClick={() => isClickable && setExpanded(!expanded)}
      >
        {statusIcons[nodeRun.status] || <Clock className="h-4 w-4" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm truncate">{displayName}</span>
            {nodeRun.nodeType && (
              <span className="text-xs text-muted-foreground">({nodeRun.nodeType})</span>
            )}
            {nodeRun.attempt > 1 && (
              <span className="text-xs text-orange-500">第{nodeRun.attempt}次</span>
            )}
          </div>
        </div>
        <Badge variant={statusColors[nodeRun.status] || 'outline'} className="text-xs shrink-0">
          {statusLabels[nodeRun.status] || nodeRun.status}
        </Badge>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-3 py-3 space-y-3">
          {/* Show output for completed nodes */}
          {nodeRun.output && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">执行结果</p>
              <pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-48">
                {JSON.stringify(filterInternalFields(nodeRun.output), null, 2)}
              </pre>
            </div>
          )}

          {/* Show artifact link if present */}
          {nodeRun.output?._artifact_id && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">产物</p>
              <a 
                href={`/artifacts/${nodeRun.output._artifact_id}`} 
                className="text-xs text-blue-500 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                查看产物详情 →
              </a>
            </div>
          )}

          {/* Show input for waiting_human nodes */}
          {nodeRun.status === 'waiting_human' && nodeRun.input && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">待审核内容</p>
              <pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-48">
                {JSON.stringify(nodeRun.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Review actions for waiting_human */}
          {nodeRun.status === 'waiting_human' && nodeRun.nodeType === 'human_review' && (
            <div className="space-y-2">
              <Textarea
                placeholder="输入反馈（拒绝时必填）..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleReview('approve')} disabled={submitting}>
                  <CheckCircle className="mr-1 h-3 w-3" />
                  通过
                </Button>
                <Button size="sm" variant="destructive" onClick={() => handleReview('reject')} disabled={submitting || !feedback.trim()}>
                  <RotateCcw className="mr-1 h-3 w-3" />
                  打回
                </Button>
              </div>
            </div>
          )}

          {/* Submit for human_input */}
          {nodeRun.status === 'waiting_human' && nodeRun.nodeType === 'human_input' && (
            <HumanInputForm nodeRun={nodeRun} onSubmit={async (data) => {
              setSubmitting(true)
              try {
                await api.post(`node-runs/${nodeRun.id}/submit`, {
                  json: data,
                })
                onActionComplete()
              } catch (error: any) {
                alert(`提交失败: ${error.message}`)
              } finally {
                setSubmitting(false)
              }
            }} submitting={submitting} />
          )}

          {/* Retry for failed nodes */}
          {nodeRun.status === 'failed' && (
            <div className="space-y-2">
              {nodeRun.error && (
                <p className="text-xs text-destructive">{nodeRun.error}</p>
              )}
              <Button size="sm" variant="outline" onClick={handleRetry} disabled={submitting}>
                <RotateCcw className="mr-1 h-3 w-3" />
                重试
              </Button>
            </div>
          )}

          {/* Review info for reviewed nodes */}
          {nodeRun.reviewAction && (
            <div className="text-xs text-muted-foreground">
              <span>审核结果：{nodeRun.reviewAction}</span>
              {nodeRun.reviewComment && <span> — {nodeRun.reviewComment}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ───

function deduplicateNodeRuns(nodeRuns: NodeRun[]): NodeRun[] {
  // Group by nodeId, keep the latest attempt
  const map = new Map<string, NodeRun>()
  for (const nr of nodeRuns) {
    const existing = map.get(nr.nodeId)
    if (!existing || nr.attempt > existing.attempt) {
      map.set(nr.nodeId, nr)
    }
  }
  // Preserve original order
  const seen = new Set<string>()
  const result: NodeRun[] = []
  for (const nr of nodeRuns) {
    if (!seen.has(nr.nodeId)) {
      seen.add(nr.nodeId)
      result.push(map.get(nr.nodeId)!)
    }
  }
  return result
}

function filterInternalFields(output: any): any {
  if (!output || typeof output !== 'object') return output
  const { _artifact_id, _feedback, _role, raw, ...rest } = output
  return rest
}

// ─── Dynamic Human Input Form ───

interface FormFieldDef {
  field: string
  type: 'text' | 'textarea' | 'select' | 'number'
  label: string
  required?: boolean
  options?: string[]
}

function HumanInputForm({ nodeRun, onSubmit, submitting }: {
  nodeRun: NodeRun
  onSubmit: (data: Record<string, string>) => void
  submitting: boolean
}) {
  // Try to extract form definition from input (set by WebSocket event)
  const formFields: FormFieldDef[] = nodeRun.input?.form || []
  const [formData, setFormData] = useState<Record<string, string>>({})

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const isValid = formFields.length > 0
    ? formFields.filter(f => f.required).every(f => formData[f.field]?.trim())
    : formData._text?.trim()

  // Fallback: single textarea if no form definition
  if (formFields.length === 0) {
    return (
      <div className="space-y-2">
        <Textarea
          placeholder="输入内容..."
          value={formData._text || ''}
          onChange={(e) => updateField('_text', e.target.value)}
          rows={3}
          className="text-sm"
        />
        <Button size="sm" onClick={() => onSubmit({ text: formData._text || '' })} disabled={submitting || !isValid}>
          <Play className="mr-1 h-3 w-3" />
          提交
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {formFields.map((field) => (
        <div key={field.field} className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </label>
          {field.type === 'textarea' ? (
            <Textarea
              placeholder={field.label}
              value={formData[field.field] || ''}
              onChange={(e) => updateField(field.field, e.target.value)}
              rows={3}
              className="text-sm"
            />
          ) : field.type === 'select' && field.options ? (
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={formData[field.field] || ''}
              onChange={(e) => updateField(field.field, e.target.value)}
            >
              <option value="">请选择...</option>
              {field.options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <Input
              type={field.type === 'number' ? 'number' : 'text'}
              placeholder={field.label}
              value={formData[field.field] || ''}
              onChange={(e) => updateField(field.field, e.target.value)}
              className="text-sm"
            />
          )}
        </div>
      ))}
      <Button size="sm" onClick={() => onSubmit(formData)} disabled={submitting || !isValid}>
        <Play className="mr-1 h-3 w-3" />
        提交
      </Button>
    </div>
  )
}
