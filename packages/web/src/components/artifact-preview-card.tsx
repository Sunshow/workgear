import { useState } from 'react'
import { api } from '@/lib/api'
import type { Artifact, ArtifactVersion } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { ChevronDown, ChevronRight, Pencil, Loader2 } from 'lucide-react'

interface ArtifactPreviewCardProps {
  artifact: Artifact
  onEdit?: (artifact: Artifact, latestContent: string, latestVersion: number) => void
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

export function ArtifactPreviewCard({ artifact, onEdit }: ArtifactPreviewCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')
  const [latestVersion, setLatestVersion] = useState<ArtifactVersion | null>(null)

  async function toggleExpand() {
    if (expanded) {
      setExpanded(false)
      return
    }

    setExpanded(true)
    if (content) return // already loaded

    setLoading(true)
    try {
      const versions = await api
        .get(`artifacts/${artifact.id}/versions`)
        .json<ArtifactVersion[]>()
      if (versions.length > 0) {
        const latest = versions[0] // sorted desc by version
        setLatestVersion(latest)
        const data = await api
          .get(`artifacts/${artifact.id}/versions/${latest.id}/content`)
          .json<{ content: string }>()
        setContent(data.content)
      }
    } catch (error) {
      console.error('Failed to load artifact content:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleEdit() {
    if (onEdit && latestVersion) {
      onEdit(artifact, content, latestVersion.version)
    }
  }

  return (
    <div className="rounded border bg-muted/20">
      <button
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors"
        onClick={toggleExpand}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
          {typeLabels[artifact.type] || artifact.type}
        </Badge>
        <span className="flex-1 text-xs truncate">{artifact.title}</span>
      </button>

      {expanded && (
        <div className="border-t px-2.5 py-2">
          {loading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          ) : content ? (
            <div className="space-y-2">
              <div className="max-h-[300px] overflow-y-auto rounded bg-background p-2">
                <MarkdownRenderer content={content} />
              </div>
              {onEdit && latestVersion && (
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleEdit}>
                    <Pencil className="mr-1 h-3 w-3" />
                    编辑
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-1">暂无内容</p>
          )}
        </div>
      )}
    </div>
  )
}
