import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Artifact, ArtifactVersion } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { ChevronDown, ChevronRight, Eye, EyeOff, Loader2 } from 'lucide-react'

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
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null)
  const [versionContent, setVersionContent] = useState<string>('')
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)

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
      setViewingVersionId(null)
      setVersionContent('')
      setContentError(null)
      return
    }

    setExpandedId(artifactId)
    setViewingVersionId(null)
    setVersionContent('')
    setContentError(null)
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

  async function fetchVersionContent(artifactId: string, versionId: string) {
    setContentLoading(true)
    setContentError(null)
    try {
      const data = await api
        .get(`artifacts/${artifactId}/versions/${versionId}/content`)
        .json<{ content: string }>()
      setVersionContent(data.content)
    } catch {
      setContentError('内容加载失败')
      setVersionContent('')
    } finally {
      setContentLoading(false)
    }
  }

  async function loadVersionContent(artifactId: string, versionId: string) {
    if (viewingVersionId === versionId) {
      setViewingVersionId(null)
      setVersionContent('')
      setContentError(null)
      return
    }

    setViewingVersionId(versionId)
    await fetchVersionContent(artifactId, versionId)
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
                    <div key={version.id}>
                      <div className="rounded bg-muted/30 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">v{version.version}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {version.createdBy || '系统'} ·{' '}
                              {new Date(version.createdAt).toLocaleString('zh-CN')}
                            </span>
                            <button
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                              onClick={() => loadVersionContent(artifact.id, version.id)}
                              title={viewingVersionId === version.id ? '收起' : '查看内容'}
                            >
                              {viewingVersionId === version.id ? (
                                <>
                                  <EyeOff className="h-3 w-3" />
                                  收起
                                </>
                              ) : (
                                <>
                                  <Eye className="h-3 w-3" />
                                  查看
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                        {version.changeSummary && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {version.changeSummary}
                          </p>
                        )}
                      </div>

                      {viewingVersionId === version.id && (
                        <div className="mt-1 rounded border bg-background p-3 max-h-[400px] overflow-y-auto">
                          {contentLoading ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              加载内容...
                            </div>
                          ) : contentError ? (
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-destructive">{contentError}</p>
                              <button
                                className="text-xs text-primary hover:underline"
                                onClick={() => fetchVersionContent(artifact.id, version.id)}
                              >
                                重试
                              </button>
                            </div>
                          ) : versionContent ? (
                            <MarkdownRenderer content={versionContent} />
                          ) : (
                            <p className="text-xs text-muted-foreground">该版本暂无内容</p>
                          )}
                        </div>
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
