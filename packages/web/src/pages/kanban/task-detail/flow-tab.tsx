import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { FlowRun, NodeRun, Artifact } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useFlowRunEvents } from '@/hooks/use-websocket'
import { XCircle, CheckCircle, RotateCcw, Clock, Play, AlertCircle, Pencil, Loader2, FileText } from 'lucide-react'
import { NodeLogDialog } from '@/components/node-log-dialog'
import { CodeBlock } from '@/components/code-block'
import { ArtifactPreviewCard } from '@/components/artifact-preview-card'
import { ArtifactEditorDialog } from '@/components/artifact-editor-dialog'
import { FlowErrorDialog } from '@/components/flow-error-dialog'

interface FlowTabProps {
  taskId: string
  refreshKey?: number
  onFullscreen?: (title: string, content: string) => void
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

export function FlowTab({ taskId, refreshKey, onFullscreen }: FlowTabProps) {
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([])
  const [nodeRuns, setNodeRuns] = useState<NodeRun[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [logDialogNode, setLogDialogNode] = useState<NodeRun | null>(null)
  // Artifact editor state
  const [errorDialogOpen, setErrorDialogOpen] = useState(false)
  const [editingArtifact, setEditingArtifact] = useState<Artifact | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [editingVersion, setEditingVersion] = useState(0)
  const [artifactRefreshKey, setArtifactRefreshKey] = useState(0)

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
    onNodeCancelled: () => refreshNodeRuns(),
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
        <div className="rounded-md bg-destructive/10 p-3 space-y-2">
          <p className="text-sm text-destructive line-clamp-3">{latestFlow.error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setErrorDialogOpen(true)}
            className="h-7 text-xs"
          >
            查看详情
          </Button>
        </div>
      )}

      {/* Node execution progress */}
      <div className="space-y-4 md:space-y-2">
        <h4 className="text-sm font-medium">节点执行进度</h4>
        <div className="space-y-3 md:space-y-1">
          {latestNodeRuns.map((node) => (
            <NodeRunItem
              key={node.id}
              nodeRun={node}
              flowStatus={latestFlow.status}
              onActionComplete={refreshNodeRuns}
              onViewLogs={() => setLogDialogNode(node)}
              artifactRefreshKey={artifactRefreshKey}
              onEditArtifact={(artifact, content, version) => {
                setEditingArtifact(artifact)
                setEditingContent(content)
                setEditingVersion(version)
              }}
              onFullscreen={onFullscreen}
            />
          ))}
        </div>
      </div>

      {flowRuns.length > 1 && (
        <p className="pt-2 text-xs text-muted-foreground">共 {flowRuns.length} 次执行记录</p>
      )}

      {/* Log dialog */}
      <NodeLogDialog nodeRun={logDialogNode} open={!!logDialogNode} onClose={() => setLogDialogNode(null)} />

      {/* Error dialog */}
      <FlowErrorDialog
        error={latestFlow?.error || ''}
        open={errorDialogOpen}
        onOpenChange={setErrorDialogOpen}
      />

      {/* Artifact editor dialog */}
      <ArtifactEditorDialog
        artifact={editingArtifact}
        initialContent={editingContent}
        currentVersion={editingVersion}
        open={!!editingArtifact}
        onOpenChange={(open) => { if (!open) setEditingArtifact(null) }}
        onSaved={() => setArtifactRefreshKey((k) => k + 1)}
      />
    </div>
  )
}

// ─── Helper functions for artifact scope ───

function getArtifactScope(nodeRun: NodeRun): 'predecessor' | 'flow' | 'self' {
  const config = nodeRun.config as { artifact_scope?: string; artifactScope?: string } | null | undefined
  const scope = config?.artifact_scope || config?.artifactScope || 'predecessor'
  
  if (!['predecessor', 'flow', 'self'].includes(scope)) {
    console.warn(`Invalid artifactScope: ${scope}, fallback to "predecessor"`)
    return 'predecessor'
  }
  
  return scope as 'predecessor' | 'flow' | 'self'
}

function extractPredecessorNodeRunIds(input: any): string[] {
  if (!input) return []
  
  // 优先级 1: predecessorNodeRunIds（数组）
  if (Array.isArray(input.predecessorNodeRunIds)) {
    return input.predecessorNodeRunIds.filter((id: any) => typeof id === 'string')
  }
  
  // 优先级 2: predecessorNodeRunId（单个）
  if (typeof input.predecessorNodeRunId === 'string') {
    return [input.predecessorNodeRunId]
  }
  
  // 优先级 3: upstream.nodeRunId（嵌套）
  if (input.upstream && typeof input.upstream.nodeRunId === 'string') {
    return [input.upstream.nodeRunId]
  }
  
  return []
}

// ─── NodeRunItem with inline review panel ───

function NodeRunItem({ nodeRun, flowStatus, onActionComplete, onViewLogs, artifactRefreshKey, onEditArtifact, onFullscreen }: {
  nodeRun: NodeRun
  flowStatus: string
  onActionComplete: () => void
  onViewLogs: () => void
  artifactRefreshKey: number
  onEditArtifact: (artifact: Artifact, content: string, version: number) => void
  onFullscreen?: (title: string, content: string) => void
}) {
  const [expanded, setExpanded] = useState(nodeRun.status === 'waiting_human')
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [nodeArtifacts, setNodeArtifacts] = useState<Artifact[]>([])
  const [editingTransient, setEditingTransient] = useState(false)
  const [transientContent, setTransientContent] = useState('')
  const [previousOutput, setPreviousOutput] = useState<{ hasPrevious: boolean; output?: any } | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [proceeding, setProceeding] = useState(false)
  const isFlowTerminal = flowStatus === 'cancelled' || flowStatus === 'completed'
  const canSkip = !isFlowTerminal && ['queued', 'waiting_human'].includes(nodeRun.status)
  const isReusePaused = nodeRun.status === 'waiting_human' && nodeRun.nodeType === 'agent_task'

  // Auto-expand when waiting for human
  useEffect(() => {
    if (nodeRun.status === 'waiting_human') {
      setExpanded(true)
    }
    if (nodeRun.status === 'rejected' && flowStatus === 'failed') {
      setExpanded(true)
    }
  }, [nodeRun.status, flowStatus])

  // Check for previous flow output (for artifact reuse)
  useEffect(() => {
    if (!canSkip) {
      setPreviousOutput(null)
      return
    }
    api.get(`node-runs/${nodeRun.id}/previous-output`).json<{ hasPrevious: boolean; output?: any }>()
      .then(setPreviousOutput)
      .catch(() => setPreviousOutput(null))
  }, [nodeRun.id, nodeRun.status, canSkip])

  // Auto-fill feedback for rejected nodes (pre-fill with last review comment)
  useEffect(() => {
    if (nodeRun.status === 'rejected' && nodeRun.reviewComment && !feedback) {
      setFeedback(nodeRun.reviewComment)
    }
  }, [nodeRun.status, nodeRun.reviewComment])

  // Initialize transient content when node has transient artifacts
  useEffect(() => {
    if (nodeRun.transientArtifacts) {
      const firstKey = Object.keys(nodeRun.transientArtifacts)[0]
      if (firstKey && nodeRun.transientArtifacts[firstKey]?.content) {
        setTransientContent(nodeRun.transientArtifacts[firstKey].content)
      }
    }
  }, [nodeRun.transientArtifacts])

  // Load artifacts when expanded
  useEffect(() => {
    if (expanded && nodeRun.id) {
      loadNodeArtifacts()
    }
  }, [expanded, nodeRun.id, artifactRefreshKey])

  async function loadNodeArtifacts() {
    try {
      let artifacts: Artifact[] = []
      
      if (nodeRun.nodeType === 'human_review') {
        const scope = getArtifactScope(nodeRun)
        
        if (scope === 'predecessor') {
          // 模式 1: 查询前驱节点产物
          const predecessorIds = extractPredecessorNodeRunIds(nodeRun.input)
          
          if (predecessorIds.length > 0) {
            // 并行查询所有前驱节点的产物
            const results = await Promise.all(
              predecessorIds.map(id => 
                api.get(`artifacts?nodeRunId=${id}`).json<Artifact[]>()
              )
            )
            
            // 合并并去重
            const artifactMap = new Map<string, Artifact>()
            for (const result of results) {
              for (const artifact of result) {
                artifactMap.set(artifact.id, artifact)
              }
            }
            
            artifacts = Array.from(artifactMap.values()).sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            )
          } else {
            // 降级到 self 模式
            console.warn('No predecessor node IDs found, fallback to self mode')
            const nodeData = await api.get(`artifacts?nodeRunId=${nodeRun.id}`).json<Artifact[]>()
            artifacts = nodeData
          }
        } else if (scope === 'flow') {
          // 模式 2: 查询整个流程产物（保持当前行为）
          const nodeData = await api.get(`artifacts?nodeRunId=${nodeRun.id}`).json<Artifact[]>()
          const flowData = await api.get(`artifacts?flowRunId=${nodeRun.flowRunId}`).json<Artifact[]>()
          
          const artifactMap = new Map<string, Artifact>()
          for (const artifact of flowData) {
            artifactMap.set(artifact.id, artifact)
          }
          for (const artifact of nodeData) {
            artifactMap.set(artifact.id, artifact)
          }
          
          artifacts = Array.from(artifactMap.values()).sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
        } else {
          // 模式 3: 仅查询自身产物
          const nodeData = await api.get(`artifacts?nodeRunId=${nodeRun.id}`).json<Artifact[]>()
          artifacts = nodeData
        }
      } else {
        // 非 human_review 节点，仅查询自身产物
        const nodeData = await api.get(`artifacts?nodeRunId=${nodeRun.id}`).json<Artifact[]>()
        artifacts = nodeData
      }
      
      setNodeArtifacts(artifacts)
    } catch (error) {
      console.error('Failed to load node artifacts:', error)
    }
  }

  async function handleReview(action: 'approve' | 'reject' | 'edit_and_approve', force?: boolean) {
    setSubmitting(true)
    try {
      const body: any = {
        action,
        feedback: action === 'reject' ? feedback : undefined,
        force: force || false,
      }
      
      // If transient artifact was edited, include it in the request
      if (editingTransient && transientContent && nodeRun.transientArtifacts) {
        const key = Object.keys(nodeRun.transientArtifacts)[0]
        if (key) {
          body.output = {
            [key]: transientContent,
            _transient: true,
          }
        }
      }
      
      await api.post(`node-runs/${nodeRun.id}/review`, { json: body })
      setFeedback('')
      setEditingTransient(false)
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

  async function handleRerun() {
    if (!confirm('确定要重跑此节点？后续节点将被重置。')) return
    setSubmitting(true)
    try {
      await api.post(`node-runs/${nodeRun.id}/rerun`)
      onActionComplete()
    } catch (error: any) {
      alert(`重跑失败: ${error.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSkipWithPrevious() {
    if (!previousOutput?.output) return
    if (!confirm('确定要复用上次流程的产物跳过此节点吗？')) return
    setSkipping(true)
    try {
      await api.post(`node-runs/${nodeRun.id}/skip`, {
        json: { outputJson: typeof previousOutput.output === 'string' ? previousOutput.output : JSON.stringify(previousOutput.output) },
      })
      onActionComplete()
    } catch (error: any) {
      alert(`跳过失败: ${error.message}`)
    } finally {
      setSkipping(false)
    }
  }

  async function handleProceed() {
    if (!confirm('确定要重新执行此节点吗？')) return
    setProceeding(true)
    try {
      await api.post(`node-runs/${nodeRun.id}/proceed`)
      onActionComplete()
    } catch (error: any) {
      alert(`继续执行失败: ${error.message}`)
    } finally {
      setProceeding(false)
    }
  }

  const displayName = nodeRun.nodeName || nodeRun.nodeId
  const isClickable = nodeRun.status === 'waiting_human' || nodeRun.status === 'completed' || nodeRun.status === 'failed' || nodeRun.status === 'rejected' || (previousOutput?.hasPrevious && canSkip)

  return (
    <div className="rounded-md border">
      {/* Node header */}
      <div
        className={`flex items-center gap-3 p-4 md:px-3 md:py-2 min-h-[44px] ${isClickable ? 'cursor-pointer hover:bg-muted/50' : ''}`}
        onClick={() => isClickable && setExpanded(!expanded)}
      >
        {statusIcons[nodeRun.status] || <Clock className="h-4 w-4" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base md:text-sm truncate">{displayName}</span>
            {nodeRun.nodeType && (
              <span className="text-xs text-muted-foreground">({nodeRun.nodeType})</span>
            )}
            {nodeRun.attempt > 1 && (
              <span className="text-xs text-orange-500">第{nodeRun.attempt}次</span>
            )}
          </div>
        </div>
        <Badge variant={statusColors[nodeRun.status] || 'outline'} className="text-sm md:text-xs shrink-0">
          {statusLabels[nodeRun.status] || nodeRun.status}
        </Badge>
        {previousOutput?.hasPrevious && canSkip && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 md:h-6 text-xs shrink-0 border-blue-500 text-blue-600 hover:bg-blue-50"
            onClick={(e) => {
              e.stopPropagation()
              handleSkipWithPrevious()
            }}
            disabled={skipping}
          >
            {skipping ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
            复用历史产物
          </Button>
        )}
        {isReusePaused && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 md:h-6 text-xs shrink-0 border-green-500 text-green-600 hover:bg-green-50"
            onClick={(e) => {
              e.stopPropagation()
              handleProceed()
            }}
            disabled={proceeding}
          >
            {proceeding ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            继续执行
          </Button>
        )}
        {nodeRun.nodeType === 'agent_task' && (
          <Button
            size="sm"
            variant="ghost"
            className="h-11 w-11 md:h-6 md:w-6 p-0 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onViewLogs()
            }}
            title="查看日志"
            aria-label="查看日志"
          >
            <FileText className="h-5 w-5 md:h-3.5 md:w-3.5" />
          </Button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t p-4 md:px-3 md:py-3 space-y-3">
          {/* Show transient artifacts (e.g., requirement understanding) */}
          {nodeRun.transientArtifacts && Object.keys(nodeRun.transientArtifacts).length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-muted-foreground">需求理解</p>
                {nodeRun.status === 'waiting_human' && !editingTransient && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => setEditingTransient(true)}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    编辑
                  </Button>
                )}
              </div>
              {editingTransient ? (
                <div className="space-y-2">
                  <Textarea
                    value={transientContent}
                    onChange={(e) => setTransientContent(e.target.value)}
                    rows={12}
                    className="text-sm font-mono"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setEditingTransient(false)}
                    >
                      完成编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const firstKey = Object.keys(nodeRun.transientArtifacts!)[0]
                        if (firstKey && nodeRun.transientArtifacts![firstKey]?.content) {
                          setTransientContent(nodeRun.transientArtifacts![firstKey].content)
                        }
                        setEditingTransient(false)
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none p-3 bg-muted/30 rounded border text-sm whitespace-pre-wrap">
                  {transientContent}
                </div>
              )}
            </div>
          )}

          {/* Show output for completed nodes */}
          {nodeRun.output && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">执行结果</p>
              <CodeBlock
                code={JSON.stringify(filterInternalFields(nodeRun.output), null, 2)}
                language="json"
                maxHeight="12rem"
              />
            </div>
          )}

          {/* Show artifacts grouped by source node */}
          {nodeArtifacts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">产物</p>
              <ArtifactsBySourceNode
                artifacts={nodeArtifacts}
                flowRunId={nodeRun.flowRunId}
                canEdit={nodeRun.status === 'waiting_human' && nodeRun.nodeType === 'human_review'}
                onEdit={onEditArtifact}
                onFullscreen={onFullscreen}
              />
            </div>
          )}

          {/* Show input for waiting_human nodes — 仅在无产物时显示，排除 human_input（其 input 是 form 定义） */}
          {nodeRun.status === 'waiting_human' && nodeRun.nodeType !== 'human_input' && nodeRun.input && nodeArtifacts.length === 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">待审核内容</p>
              <CodeBlock
                code={JSON.stringify(nodeRun.input, null, 2)}
                language="json"
                maxHeight="12rem"
              />
            </div>
          )}

          {/* Review actions for waiting_human */}
          {nodeRun.status === 'waiting_human' && nodeRun.nodeType === 'human_review' && !isFlowTerminal && (
            <div className="space-y-2">
              {/* 自动填入审查意见按钮 */}
              {nodeRun.input && extractReviewContent(nodeRun.input) && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (feedback.trim() && !confirm('当前已有反馈内容，是否覆盖？')) return
                      const content = extractReviewContent(nodeRun.input)
                      if (content) setFeedback(content)
                    }}
                    disabled={submitting}
                    className="text-xs"
                  >
                    <FileText className="mr-1 h-3 w-3" />
                    自动填入审查意见
                  </Button>
                </div>
              )}
              <Textarea
                placeholder="输入反馈（拒绝时必填）..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                className="text-sm"
              />
              <div className="flex flex-col gap-2 md:flex-row md:gap-2">
                <Button size="sm" className="h-11 md:h-auto" onClick={() => handleReview('approve')} disabled={submitting}>
                  <CheckCircle className="mr-1 h-3 w-3" />
                  通过
                </Button>
                <Button size="sm" className="h-11 md:h-auto" variant="destructive" onClick={() => handleReview('reject', false)} disabled={submitting || !feedback.trim()}>
                  <RotateCcw className="mr-1 h-3 w-3" />
                  打回
                </Button>
                <Button
                  size="sm"
                  className="h-11 md:h-auto border-orange-500 text-orange-600 hover:bg-orange-50"
                  variant="outline"
                  onClick={() => {
                    if (!confirm('确定要强制打回吗？这将绕过打回次数限制。')) return
                    handleReview('reject', true)
                  }}
                  disabled={submitting || !feedback.trim()}
                >
                  <AlertCircle className="mr-1 h-3 w-3" />
                  强制打回
                </Button>
              </div>
            </div>
          )}

          {/* Submit for human_input */}
          {nodeRun.status === 'waiting_human' && nodeRun.nodeType === 'human_input' && !isFlowTerminal && (
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

          {/* Flow cancelled hint for waiting_human nodes */}
          {nodeRun.status === 'waiting_human' && isFlowTerminal && (
            <p className="text-xs text-muted-foreground">流程已取消，无法操作</p>
          )}

          {/* Force reject for rejected nodes when flow failed due to max_loops */}
          {nodeRun.status === 'rejected' && nodeRun.nodeType === 'human_review' && flowStatus === 'failed' && (
            <div className="space-y-2">
              <p className="text-xs text-orange-600">流程因打回次数达上限而失败，可使用强制打回继续。</p>
              <Textarea
                placeholder="输入反馈（必填）..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                className="text-sm"
              />
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => {
                  if (!confirm('确定要强制打回吗？这将绕过打回次数限制并恢复流程。')) return
                  handleReview('reject', true)
                }} 
                disabled={submitting || !feedback.trim()}
                className="border-orange-500 text-orange-600 hover:bg-orange-50"
              >
                <AlertCircle className="mr-1 h-3 w-3" />
                强制打回
              </Button>
            </div>
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

          {/* Rerun for completed agent_task nodes (only when flow is still active) */}
          {nodeRun.status === 'completed' && flowStatus !== 'cancelled' && flowStatus !== 'completed' && (
            <Button size="sm" variant="outline" onClick={handleRerun} disabled={submitting}>
              <RotateCcw className="mr-1 h-3 w-3" />
              重跑
            </Button>
          )}

          {/* Review info for reviewed nodes (exclude rejected with force-reject UI) */}
          {nodeRun.reviewAction && !(nodeRun.status === 'rejected' && flowStatus === 'failed') && (
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

// ─── Artifacts grouped by source node ───

function ArtifactsBySourceNode({
  artifacts,
  flowRunId,
  canEdit,
  onEdit,
  onFullscreen,
}: {
  artifacts: Artifact[]
  flowRunId: string
  canEdit: boolean
  onEdit: (artifact: Artifact, content: string, version: number) => void
  onFullscreen?: (title: string, content: string) => void
}) {
  const [nodeRunsMap, setNodeRunsMap] = useState<Map<string, NodeRun>>(new Map())

  // Load node runs for the flow to get node names for group titles
  useEffect(() => {
    if (!flowRunId) return
    api.get(`flow-runs/${flowRunId}/nodes`).json<NodeRun[]>().then((nodes) => {
      const map = new Map<string, NodeRun>()
      for (const nr of nodes) {
        map.set(nr.id, nr)
      }
      setNodeRunsMap(map)
    }).catch((err) => {
      console.error('Failed to load node runs for grouping:', err)
    })
  }, [flowRunId])

  // Group artifacts by nodeRunId
  const byNode = new Map<string | null, Artifact[]>()
  for (const artifact of artifacts) {
    const key = artifact.nodeRunId
    if (!byNode.has(key)) {
      byNode.set(key, [])
    }
    byNode.get(key)!.push(artifact)
  }

  // Artifacts without nodeRunId
  const noNodeArtifacts = byNode.get(null) || []
  byNode.delete(null)

  // Sort groups by node order (use nodeRunsMap order)
  const sortedNodeIds = [...byNode.keys()].sort((a, b) => {
    const nodeA = nodeRunsMap.get(a!)
    const nodeB = nodeRunsMap.get(b!)
    // Sort by createdAt of the node run (earlier nodes first)
    if (nodeA && nodeB) {
      return new Date(nodeA.createdAt).getTime() - new Date(nodeB.createdAt).getTime()
    }
    return 0
  })

  // If only one group and no ungrouped artifacts, skip group headers
  const singleGroup = sortedNodeIds.length === 1 && noNodeArtifacts.length === 0

  return (
    <div className="space-y-2">
      {sortedNodeIds.map((nodeRunId) => {
        const groupArtifacts = byNode.get(nodeRunId)!
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        const nodeRun = nodeRunsMap.get(nodeRunId!)
        const nodeName = nodeRun?.nodeName || nodeRun?.nodeId || '未知节点'
        const nodeType = nodeRun?.nodeType

        return (
          <div key={nodeRunId} className="space-y-1">
            {!singleGroup && (
              <div className="flex items-center gap-1.5 py-1">
                <span className="text-xs font-medium">{nodeName}</span>
                {nodeType && (
                  <span className="text-[10px] text-muted-foreground">({nodeType})</span>
                )}
              </div>
            )}
            <div className={singleGroup ? 'space-y-1' : 'pl-2 space-y-1'}>
              {groupArtifacts.map((artifact) => (
                <ArtifactPreviewCard
                  key={artifact.id}
                  artifact={artifact}
                  onEdit={canEdit ? (a, content, version) => onEdit(a, content, version) : undefined}
                  onFullscreen={onFullscreen}
                />
              ))}
            </div>
          </div>
        )
      })}

      {noNodeArtifacts.length > 0 && (
        <div className="space-y-1">
          {!singleGroup && (
            <div className="py-1">
              <span className="text-xs font-medium text-muted-foreground">其他产物</span>
            </div>
          )}
          <div className={singleGroup ? 'space-y-1' : 'pl-2 space-y-1'}>
            {noNodeArtifacts
              .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
              .map((artifact) => (
                <ArtifactPreviewCard
                  key={artifact.id}
                  artifact={artifact}
                  onEdit={canEdit ? (a, content, version) => onEdit(a, content, version) : undefined}
                  onFullscreen={onFullscreen}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Review Content Extraction ───

const severityLabels: Record<string, string> = {
  high: '🔴 高',
  medium: '🟡 中',
  low: '🔵 低',
}
const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

function extractReviewContent(input: Record<string, any> | null): string {
  if (!input) return ''

  // 从 input 中定位实际的 review 数据源
  const source = input.review_target ?? input
  if (!source || typeof source !== 'object') return ''

  // 优先从 code_review 子字段提取，否则用 source 本身
  const rawData = source.code_review ?? source

  // 解析可能嵌套的 JSON 字符串
  const { parsed, extra } = parseReviewData(rawData)
  if (!parsed) return ''

  const parts: string[] = []

  // 1. 审查结论
  if (typeof parsed.passed === 'boolean') {
    parts.push(`审查结论：${parsed.passed ? '✅ 通过' : '❌ 未通过'}`)
  }

  // 2. 问题列表（按 severity 分级）
  if (Array.isArray(parsed.issues) && parsed.issues.length > 0) {
    const sorted = [...parsed.issues].sort((a, b) =>
      (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99)
    )
    parts.push('\n问题：')
    sorted.forEach((issue, i) => {
      if (typeof issue === 'string') {
        parts.push(`${i + 1}. ${issue}`)
      } else {
        const sev = severityLabels[issue.severity] ?? issue.severity ?? ''
        const loc = issue.file ? ` (${issue.file}${issue.line ? ':' + issue.line : ''})` : ''
        parts.push(`${i + 1}. [${sev}] ${issue.description}${loc}`)
      }
    })
  }

  // 3. 改进建议
  if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
    parts.push('\n改进建议：')
    parsed.suggestions.forEach((s: unknown, i: number) => {
      parts.push(`${i + 1}. ${typeof s === 'string' ? s : JSON.stringify(s)}`)
    })
  }

  // 4. 补充审查说明（result 字符串中 JSON 之后的文本）
  if (extra.trim()) {
    parts.push('\n补充说明：')
    parts.push(extra.trim())
  }

  return parts.join('\n')
}

// 从 raw 数据中解析出结构化 review 对象和额外文本
function parseReviewData(data: any): { parsed: any; extra: string } {
  if (!data) return { parsed: null, extra: '' }

  // 如果已经是解析好的结构（有 passed/issues 字段），直接用
  if (typeof data.passed === 'boolean' || Array.isArray(data.issues)) {
    return { parsed: data, extra: '' }
  }

  // 从 result 字符串中提取 JSON
  const resultStr = typeof data.result === 'string' ? data.result : ''
  if (!resultStr) return { parsed: null, extra: '' }

  // 找到 JSON 对象的结束位置（最后一个 }）
  const lastBrace = resultStr.lastIndexOf('}')
  if (lastBrace === -1) return { parsed: null, extra: resultStr }

  const jsonPart = resultStr.substring(0, lastBrace + 1)
  const extraPart = resultStr.substring(lastBrace + 1)

  try {
    const parsed = JSON.parse(jsonPart)
    return { parsed, extra: extraPart }
  } catch {
    return { parsed: null, extra: resultStr }
  }
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
