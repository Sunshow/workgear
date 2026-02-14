import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Artifact, ArtifactVersion } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface ArtifactsTabProps {
  taskId: string
}

const typeLabels: Record<string, string> = {
  requirement: '需求',
  prd: 'PRD',
  user_story: 'User Story',
  code: '代码',
  proposal: 'Proposal',
  design: 'Design',
  tasks: 'Tasks',
  spec: 'Spec',
}

export function ArtifactsTab({ taskId }: ArtifactsTabProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [versions, setVersions] = useState<ArtifactVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  useEffect(() => {
    loadArtifacts()
  }, [taskId])

  async function loadArtifacts() {
    setLoading(true)
    try {
      const data = await api.get(`artifacts?taskId=${taskId}`).json<Artifact[]>()
      setArtifacts(data)
    } catch (error) {
      console.error('Failed to load artifacts:', error)
    } finally {
      setLoading(false)
    }
  }

  async function toggleExpand(artifactId: string) {
    if (expandedId === artifactId) {
      setExpandedId(null)
      setVersions([])
      return
    }

    setExpandedId(artifactId)
    setVersionsLoading(true)
    try {
      const data = await api
        .get(`artifacts/${artifactId}/versions`)
        .json<ArtifactVersion[]>()
      setVersions(data)
    } catch (error) {
      console.error('Failed to load versions:', error)
    } finally {
      setVersionsLoading(false)
    }
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

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-md border">
          <button
            className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50"
            onClick={() => toggleExpand(artifact.id)}
          >
            {expandedId === artifact.id ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Badge variant="outline" className="text-xs">
              {typeLabels[artifact.type] || artifact.type}
            </Badge>
            <span className="flex-1 text-sm">{artifact.title}</span>
            {artifact.filePath && (
              <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={artifact.filePath}>
                {artifact.filePath.split('/').pop()}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(artifact.createdAt).toLocaleDateString('zh-CN')}
            </span>
          </button>

          {expandedId === artifact.id && (
            <div className="border-t px-3 py-2">
              {versionsLoading ? (
                <p className="text-xs text-muted-foreground">加载版本历史...</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无版本记录</p>
              ) : (
                <div className="space-y-2">
                  {versions.map((version) => (
                    <div key={version.id} className="rounded bg-muted/30 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">v{version.version}</span>
                        <span className="text-xs text-muted-foreground">
                          {version.createdBy || '系统'} ·{' '}
                          {new Date(version.createdAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      {version.changeSummary && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {version.changeSummary}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
