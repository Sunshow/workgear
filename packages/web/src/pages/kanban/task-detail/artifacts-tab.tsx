import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Artifact, FlowRun, NodeRun } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { ArtifactPreviewCard } from '@/components/artifact-preview-card'
import { ArtifactEditorDialog } from '@/components/artifact-editor-dialog'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface ArtifactsTabProps {
  taskId: string
}

const statusLabels: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'default',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
}

export function ArtifactsTab({ taskId }: ArtifactsTabProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([])
  const [nodeRunsMap, setNodeRunsMap] = useState<Map<string, NodeRun[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [expandedFlowId, setExpandedFlowId] = useState<string | null>(null)
  // Artifact editor state
  const [editingArtifact, setEditingArtifact] = useState<Artifact | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [editingVersion, setEditingVersion] = useState(0)

  useEffect(() => {
    loadArtifacts()
  }, [taskId])

  async function loadArtifacts() {
    setLoading(true)
    try {
      const [artifactsData, flowRunsData] = await Promise.all([
        api.get(`artifacts?taskId=${taskId}`).json<Artifact[]>(),
        api.get(`flow-runs?taskId=${taskId}`).json<FlowRun[]>(),
      ])
      setArtifacts(artifactsData)
      setFlowRuns(flowRunsData)

      // Load node runs for flow runs that have artifacts
      const flowIdsWithArtifacts = new Set(
        artifactsData.map((a) => a.flowRunId).filter((id): id is string => id !== null)
      )
      const nodeRunEntries = await Promise.all(
        [...flowIdsWithArtifacts].map(async (flowRunId) => {
          const nodes = await api.get(`flow-runs/${flowRunId}/nodes`).json<NodeRun[]>()
          return [flowRunId, nodes] as const
        })
      )
      setNodeRunsMap(new Map(nodeRunEntries))

      // Auto-expand the latest flow if it has artifacts
      if (flowRunsData.length > 0) {
        const latestFlowId = flowRunsData[0].id
        const hasArtifacts = artifactsData.some((a) => a.flowRunId === latestFlowId)
        if (hasArtifacts) {
          setExpandedFlowId(latestFlowId)
        }
      }
    } catch (error) {
      console.error('Failed to load artifacts:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleEditArtifact(artifact: Artifact, content: string, version: number) {
    setEditingArtifact(artifact)
    setEditingContent(content)
    setEditingVersion(version)
  }

  if (loading) {
    return <p className="py-4 text-center text-sm text-muted-foreground">加载中...</p>
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">暂无产物</p>
        <p className="mt-1 text-xs text-muted-foreground">流程执行后，产物将在此显示</p>
      </div>
    )
  }

  // Group artifacts by flow_run_id
  const artifactsByFlow = new Map<string | null, Artifact[]>()
  for (const artifact of artifacts) {
    const key = artifact.flowRunId
    if (!artifactsByFlow.has(key)) {
      artifactsByFlow.set(key, [])
    }
    artifactsByFlow.get(key)!.push(artifact)
  }

  // Separate unlinked artifacts (no flowRunId)
  const unlinkedArtifacts = artifactsByFlow.get(null) || []
  artifactsByFlow.delete(null)

  // Flow runs that have artifacts, newest first
  const sortedFlowRuns = flowRuns.filter((fr) => artifactsByFlow.has(fr.id))

  return (
    <div className="space-y-3">
      {/* Flow-grouped artifacts */}
      {sortedFlowRuns.map((flowRun) => {
        const flowArtifacts = artifactsByFlow.get(flowRun.id) || []
        const isExpanded = expandedFlowId === flowRun.id
        const nodeRuns = nodeRunsMap.get(flowRun.id) || []

        return (
          <div key={flowRun.id} className="rounded-md border">
            <button
              className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50"
              onClick={() => setExpandedFlowId(isExpanded ? null : flowRun.id)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">流程执行</span>
              <Badge variant={statusColors[flowRun.status] || 'outline'} className="text-xs">
                {statusLabels[flowRun.status] || flowRun.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(flowRun.createdAt).toLocaleString('zh-CN')}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {flowArtifacts.length} 个产物
              </span>
            </button>

            {isExpanded && (
              <div className="border-t px-3 py-2 space-y-2">
                <FlowArtifactsByNode
                  artifacts={flowArtifacts}
                  nodeRuns={nodeRuns}
                  onEdit={handleEditArtifact}
                />
              </div>
            )}
          </div>
        )
      })}

      {/* Unlinked artifacts */}
      {unlinkedArtifacts.length > 0 && (
        <div className="rounded-md border">
          <div className="p-3 border-b bg-muted/30">
            <span className="text-sm font-medium text-muted-foreground">其他产物</span>
          </div>
          <div className="px-3 py-2 space-y-1">
            {unlinkedArtifacts.map((artifact) => (
              <ArtifactPreviewCard
                key={artifact.id}
                artifact={artifact}
                onEdit={handleEditArtifact}
              />
            ))}
          </div>
        </div>
      )}

      {/* Artifact editor dialog */}
      <ArtifactEditorDialog
        artifact={editingArtifact}
        initialContent={editingContent}
        currentVersion={editingVersion}
        open={!!editingArtifact}
        onOpenChange={(open) => { if (!open) setEditingArtifact(null) }}
        onSaved={loadArtifacts}
      />
    </div>
  )
}

// ─── Helpers ───

function deduplicateNodeRuns(nodeRuns: NodeRun[]): NodeRun[] {
  const map = new Map<string, NodeRun>()
  for (const nr of nodeRuns) {
    const existing = map.get(nr.nodeId)
    if (!existing || nr.attempt > existing.attempt) {
      map.set(nr.nodeId, nr)
    }
  }
  const seen = new Set<string>()
  const result: NodeRun[] = []
  for (const nr of nodeRuns) {
    if (!seen.has(nr.nodeId)) {
      seen.add(nr.nodeId)
      result.push(map.get(nr.nodeId)!)
    }
  }
  return result
}// ─── Sub-component: group artifacts by node within a flow run ───

function FlowArtifactsByNode({
  artifacts,
  nodeRuns,
  onEdit,
}: {
  artifacts: Artifact[]
  nodeRuns: NodeRun[]
  onEdit: (artifact: Artifact, content: string, version: number) => void
}) {
  // Build nodeRun lookup by id
  const nodeRunById = new Map(nodeRuns.map((nr) => [nr.id, nr]))

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

  // Use deduplicated nodeRuns order (DSL definition order) to sort node groups
  const orderedNodeRuns = deduplicateNodeRuns(nodeRuns)
  const nodeOrderMap = new Map(orderedNodeRuns.map((nr, i) => [nr.id, i]))

  const sortedNodeIds = [...byNode.keys()].sort((a, b) => {
    return (nodeOrderMap.get(a!) ?? 999) - (nodeOrderMap.get(b!) ?? 999)
  })

  return (
    <div className="space-y-2">
      {sortedNodeIds.map((nodeRunId) => {
        const nodeArtifacts = byNode.get(nodeRunId)!
        const nodeRun = nodeRunById.get(nodeRunId!)
        const nodeName = nodeRun?.nodeName || nodeRun?.nodeId || '未知节点'
        const nodeType = nodeRun?.nodeType

        return (
          <div key={nodeRunId} className="space-y-1">
            <div className="flex items-center gap-1.5 py-1">
              <span className="text-xs font-medium">{nodeName}</span>
              {nodeType && (
                <span className="text-[10px] text-muted-foreground">({nodeType})</span>
              )}
            </div>
            <div className="pl-2 space-y-1">
              {nodeArtifacts.map((artifact) => (
                <ArtifactPreviewCard
                  key={artifact.id}
                  artifact={artifact}
                  onEdit={onEdit}
                />
              ))}
            </div>
          </div>
        )
      })}

      {noNodeArtifacts.length > 0 && (
        <div className="space-y-1">
          <div className="py-1">
            <span className="text-xs font-medium text-muted-foreground">其他产物</span>
          </div>
          <div className="pl-2 space-y-1">
            {noNodeArtifacts.map((artifact) => (
              <ArtifactPreviewCard
                key={artifact.id}
                artifact={artifact}
                onEdit={onEdit}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
