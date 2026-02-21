import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileText, Edit, Save, X, Maximize2, History, Link2, Loader2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownRenderer } from '@/components/markdown-renderer'

interface Artifact {
  path: string
  relativePath: string
  content: string
}

interface VersionEntry {
  version: number
  changeSummary: string | null
  createdBy: string | null
  createdAt: string
  content?: string
}

interface RelationshipEntry {
  id: string
  targetPath: string
  linkType: string
}

interface SpecArtifactViewerProps {
  projectId: string
  changeName: string
  branch?: string
  editable?: boolean
  onSave?: (path: string, content: string) => Promise<void>
  onFullscreen?: (title: string, content: string) => void
}

export function SpecArtifactViewer({
  projectId,
  changeName,
  branch = 'main',
  editable = false,
  onSave,
  onFullscreen,
}: SpecArtifactViewerProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchArtifacts()
  }, [projectId, changeName, branch])

  const fetchArtifacts = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/openspec/changes/${changeName}?branch=${branch}`
      )
      if (!res.ok) {
        throw new Error(`Failed to fetch artifacts: ${res.statusText}`)
      }
      const data = await res.json()
      setArtifacts(data.artifacts || [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (artifact: Artifact) => {
    setEditingPath(artifact.path)
    setEditContent(artifact.content)
  }

  const handleCancelEdit = () => {
    setEditingPath(null)
    setEditContent('')
  }

  const handleSave = async () => {
    if (!editingPath || !onSave) return
    setSaving(true)
    try {
      await onSave(editingPath, editContent)
      // Update local state
      setArtifacts((prev) =>
        prev.map((a) => (a.path === editingPath ? { ...a, content: editContent } : a))
      )
      setEditingPath(null)
      setEditContent('')
    } catch (err) {
      alert(`保存失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">加载 OpenSpec 文档...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-red-500">加载失败: {error}</p>
        </CardContent>
      </Card>
    )
  }

  if (artifacts.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">未找到 OpenSpec 文档</p>
        </CardContent>
      </Card>
    )
  }

  // Group artifacts by type
  const proposal = artifacts.find((a) => a.relativePath === 'proposal.md')
  const design = artifacts.find((a) => a.relativePath === 'design.md')
  const tasks = artifacts.find((a) => a.relativePath === 'tasks.md')
  const specs = artifacts.filter((a) => a.relativePath.startsWith('specs/'))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          OpenSpec: {changeName}
        </CardTitle>
        <CardDescription>
          查看和编辑 OpenSpec 规划文档（分支: {branch}）
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="proposal" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="proposal">Proposal</TabsTrigger>
            <TabsTrigger value="specs">
              Specs <Badge variant="secondary" className="ml-1">{specs.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
          </TabsList>

          <TabsContent value="proposal" className="space-y-4">
            {proposal ? (
              <ArtifactContent
                artifact={proposal}
                editable={editable}
                isEditing={editingPath === proposal.path}
                editContent={editContent}
                onEdit={() => handleEdit(proposal)}
                onCancelEdit={handleCancelEdit}
                onSave={handleSave}
                onContentChange={setEditContent}
                saving={saving}
                onFullscreen={onFullscreen}
                projectId={projectId}
              />
            ) : (
              <p className="text-gray-500">未找到 proposal.md</p>
            )}
          </TabsContent>

          <TabsContent value="specs" className="space-y-4">
            {specs.length > 0 ? (
              specs.map((spec) => (
                <ArtifactContent
                  key={spec.path}
                  artifact={spec}
                  editable={editable}
                  isEditing={editingPath === spec.path}
                  editContent={editContent}
                  onEdit={() => handleEdit(spec)}
                  onCancelEdit={handleCancelEdit}
                  onSave={handleSave}
                  onContentChange={setEditContent}
                  saving={saving}
                  onFullscreen={onFullscreen}
                  projectId={projectId}
                />
              ))
            ) : (
              <p className="text-gray-500">未找到 specs 文件</p>
            )}
          </TabsContent>

          <TabsContent value="design" className="space-y-4">
            {design ? (
              <ArtifactContent
                artifact={design}
                editable={editable}
                isEditing={editingPath === design.path}
                editContent={editContent}
                onEdit={() => handleEdit(design)}
                onCancelEdit={handleCancelEdit}
                onSave={handleSave}
                onContentChange={setEditContent}
                saving={saving}
                onFullscreen={onFullscreen}
                projectId={projectId}
              />
            ) : (
              <p className="text-gray-500">未找到 design.md</p>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="space-y-4">
            {tasks ? (
              <ArtifactContent
                artifact={tasks}
                editable={editable}
                isEditing={editingPath === tasks.path}
                editContent={editContent}
                onEdit={() => handleEdit(tasks)}
                onCancelEdit={handleCancelEdit}
                onSave={handleSave}
                onContentChange={setEditContent}
                saving={saving}
                onFullscreen={onFullscreen}
                projectId={projectId}
              />
            ) : (
              <p className="text-gray-500">未找到 tasks.md</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

interface ArtifactContentProps {
  artifact: Artifact
  editable: boolean
  isEditing: boolean
  editContent: string
  onEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onContentChange: (content: string) => void
  saving: boolean
  onFullscreen?: (title: string, content: string) => void
  projectId: string
}

function ArtifactContent({
  artifact,
  editable,
  isEditing,
  editContent,
  onEdit,
  onCancelEdit,
  onSave,
  onContentChange,
  saving,
  onFullscreen,
  projectId,
}: ArtifactContentProps) {
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<VersionEntry | null>(null)

  const [showRelationships, setShowRelationships] = useState(false)
  const [relationships, setRelationships] = useState<RelationshipEntry[]>([])
  const [relationshipsLoading, setRelationshipsLoading] = useState(false)

  const fetchVersionHistory = async () => {
    if (showVersions) {
      setShowVersions(false)
      return
    }
    setVersionsLoading(true)
    setShowVersions(true)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/openspec/changes/versions?path=${encodeURIComponent(artifact.path)}`
      )
      if (res.ok) {
        const data = await res.json()
        setVersions(data.versions || [])
      }
    } catch {
      // Silently handle - versions are optional
    } finally {
      setVersionsLoading(false)
    }
  }

  const fetchRelationships = async () => {
    if (showRelationships) {
      setShowRelationships(false)
      return
    }
    setRelationshipsLoading(true)
    setShowRelationships(true)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/openspec/changes/links?path=${encodeURIComponent(artifact.path)}`
      )
      if (res.ok) {
        const data = await res.json()
        setRelationships(data.links || [])
      }
    } catch {
      // Silently handle - relationships are optional
    } finally {
      setRelationshipsLoading(false)
    }
  }

  const displayContent = selectedVersion?.content ?? artifact.content

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-700">{artifact.relativePath}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchVersionHistory}>
            <History className="mr-1 h-3 w-3" />
            版本历史
          </Button>
          <Button variant="outline" size="sm" onClick={fetchRelationships}>
            <Link2 className="mr-1 h-3 w-3" />
            关联
          </Button>
          {!isEditing && onFullscreen && (
            <Button variant="outline" size="sm" onClick={() => onFullscreen(artifact.relativePath, displayContent)}>
              <Maximize2 className="mr-1 h-3 w-3" />
              全屏
            </Button>
          )}
          {editable && !isEditing && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit className="mr-1 h-3 w-3" />
              编辑
            </Button>
          )}
          {isEditing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onCancelEdit} disabled={saving}>
                <X className="mr-1 h-3 w-3" />
                取消
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving}>
                <Save className="mr-1 h-3 w-3" />
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Version History Panel */}
      {showVersions && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">版本历史</h4>
          {versionsLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          ) : versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无版本记录</p>
          ) : (
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {versions.map((v) => (
                <button
                  key={v.version}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted/50 transition-colors ${
                    selectedVersion?.version === v.version ? 'bg-muted' : ''
                  }`}
                  onClick={() => setSelectedVersion(selectedVersion?.version === v.version ? null : v)}
                >
                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                    v{v.version}
                  </Badge>
                  <span className="flex-1 truncate">{v.changeSummary || '无说明'}</span>
                  <span className="text-muted-foreground shrink-0">
                    {v.createdBy || '系统'}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(v.createdAt).toLocaleString('zh-CN')}
                  </span>
                </button>
              ))}
            </div>
          )}
          {selectedVersion && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setSelectedVersion(null)}
            >
              返回最新版本
            </Button>
          )}
        </div>
      )}

      {/* Relationships Panel */}
      {showRelationships && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">关联文档</h4>
          {relationshipsLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          ) : relationships.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无关联文档</p>
          ) : (
            <div className="space-y-1">
              {relationships.map((rel) => (
                <div
                  key={rel.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs bg-background"
                >
                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                    {rel.linkType}
                  </Badge>
                  <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{rel.targetPath}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isEditing ? (
        <Textarea
          value={editContent}
          onChange={(e) => onContentChange(e.target.value)}
          className="min-h-[400px] font-mono text-sm"
          disabled={saving}
        />
      ) : (
        <div className="rounded-md border bg-background p-4 max-h-[600px] overflow-y-auto">
          <MarkdownRenderer content={displayContent} />
        </div>
      )}
    </div>
  )
}
