import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, GitBranch, GitPullRequest, GitCommit, FileText, ExternalLink, GitMerge, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import type { FlowRun, TimelineEvent } from '@/lib/types'

interface GitTabProps {
  taskId: string
  gitBranch: string | null
}

interface CommitInfo {
  hash: string
  message: string
  branch: string
}

interface ChangedFileDetail {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

// SHA256 hash using Web Crypto API (for GitHub PR diff anchor)
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// StatusBadge: renders A/M/D/R single-letter badge with color
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { letter: string; className: string }> = {
    added:    { letter: 'A', className: 'bg-green-100 text-green-700 border-green-200' },
    modified: { letter: 'M', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    deleted:  { letter: 'D', className: 'bg-red-100 text-red-700 border-red-200' },
    renamed:  { letter: 'R', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  }
  const c = config[status]
  if (!c) return null
  return (
    <Badge variant="outline" className={`px-1 py-0 text-[10px] font-mono leading-tight w-5 justify-center shrink-0 ${c.className}`}>
      {c.letter}
    </Badge>
  )
}

export function GitTab({ taskId, gitBranch }: GitTabProps) {
  const [copied, setCopied] = useState(false)
  const [flowRun, setFlowRun] = useState<FlowRun | null>(null)
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [changedFiles, setChangedFiles] = useState<string[]>([])
  const [fileDetails, setFileDetails] = useState<Map<string, string>>(new Map())
  const [repoUrl, setRepoUrl] = useState<string>('')
  const [fileDiffHashes, setFileDiffHashes] = useState<Map<string, string>>(new Map())
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load latest flow run
      const flowRuns = await api.get(`flow-runs?taskId=${taskId}`).json<FlowRun[]>()
      const latest = flowRuns[0] || null
      setFlowRun(latest)

      // Load git timeline events for commits and changed files
      const events = await api.get(`tasks/${taskId}/timeline`).json<TimelineEvent[]>()
      const gitPushEvents = events.filter(e => e.eventType === 'git_pushed')

      const commitList: CommitInfo[] = []
      const allFiles = new Set<string>()
      const allFileDetails = new Map<string, string>() // path → status
      let latestRepoUrl = ''

      for (const evt of gitPushEvents) {
        const c = evt.content
        if (c.commit) {
          commitList.push({
            hash: c.commit,
            message: c.commit_message || '',
            branch: c.branch || '',
          })
        }
        if (Array.isArray(c.changed_files)) {
          c.changed_files.forEach((f: string) => allFiles.add(f))
        }
        // Parse changed_files_detail (new field)
        if (Array.isArray(c.changed_files_detail)) {
          for (const f of c.changed_files_detail as ChangedFileDetail[]) {
            allFiles.add(f.path)
            allFileDetails.set(f.path, f.status)
          }
        }
        // Extract repo_url (use latest non-empty value)
        if (c.repo_url && typeof c.repo_url === 'string') {
          latestRepoUrl = c.repo_url
        }
      }

      setCommits(commitList)
      setChangedFiles(Array.from(allFiles))
      setFileDetails(allFileDetails)
      setRepoUrl(latestRepoUrl)

      // Pre-compute SHA256 hashes for all files (for PR diff anchors)
      const hashes = new Map<string, string>()
      for (const file of allFiles) {
        hashes.set(file, await sha256(file))
      }
      setFileDiffHashes(hashes)
    } catch (error) {
      console.error('Failed to load git data:', error)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function copyBranch() {
    if (!gitBranch) return
    try {
      await navigator.clipboard.writeText(gitBranch)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  async function handleMergePR() {
    if (!flowRun) return
    setMerging(true)
    setMergeError(null)
    try {
      await api.put(`flow-runs/${flowRun.id}/merge-pr`)
      await loadData()
    } catch (error: any) {
      const body = await error.response?.json?.().catch(() => null)
      setMergeError(body?.error || error.message || 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  // Build diff URL for a changed file
  function buildFileDiffUrl(filePath: string): string | null {
    const prUrl = flowRun?.prUrl
    if (prUrl) {
      // PR diff: {prUrl}/files#diff-{sha256(filePath)}
      const hash = fileDiffHashes.get(filePath)
      if (hash) {
        return `${prUrl}/files#diff-${hash}`
      }
    }
    // Fallback: commit page
    if (repoUrl && commits.length > 0) {
      return `${repoUrl}/commit/${commits[0].hash}`
    }
    return null
  }

  // Build commit URL
  function buildCommitUrl(fullHash: string): string | null {
    if (repoUrl) {
      return `${repoUrl}/commit/${fullHash}`
    }
    return null
  }

  if (loading) {
    return <p className="py-4 text-center text-sm text-muted-foreground">加载中...</p>
  }

  const hasAnyGitInfo = gitBranch || flowRun?.prNumber || commits.length > 0

  if (!hasAnyGitInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">暂无 Git 信息</p>
        <p className="mt-1 text-xs text-muted-foreground">启动流程后，Git 信息将在此显示</p>
      </div>
    )
  }

  const prMerged = !!flowRun?.prMergedAt
  const canMerge = flowRun?.prNumber && !prMerged && flowRun.status === 'completed'

  return (
    <div className="space-y-5 py-2">
      {/* PR Section */}
      {flowRun?.prNumber && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Pull Request</span>
          </div>
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">#{flowRun.prNumber}</span>
                  {prMerged ? (
                    <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs">
                      <GitMerge className="mr-1 h-3 w-3" />
                      已合并
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      待合并
                    </Badge>
                  )}
                </div>
                {prMerged && flowRun.prMergedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(flowRun.prMergedAt).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>
              {flowRun.prUrl && (
                <a
                  href={flowRun.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  <Button variant="ghost" size="icon" className="h-7 w-7">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              )}
            </div>

            {/* Merge button */}
            {canMerge && (
              <div className="pt-1">
                <Button size="sm" onClick={handleMergePR} disabled={merging}>
                  {merging ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <GitMerge className="mr-1 h-3 w-3" />
                  )}
                  Merge PR
                </Button>
              </div>
            )}

            {/* Merge error */}
            {mergeError && (
              <div className="rounded bg-destructive/10 px-2 py-1.5">
                <p className="text-xs text-destructive">{mergeError}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Branch Section */}
      {gitBranch && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">分支</span>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <code className="flex-1 text-sm truncate">{gitBranch}</code>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copyBranch}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Commits Section */}
      {commits.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <GitCommit className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">提交记录</span>
            <span className="text-xs text-muted-foreground">({commits.length})</span>
          </div>
          <div className="rounded-md border divide-y">
            {commits.map((commit, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2">
                {buildCommitUrl(commit.hash) ? (
                  <a
                    href={buildCommitUrl(commit.hash)!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <code className="text-xs text-blue-600 hover:underline shrink-0">{commit.hash.slice(0, 7)}</code>
                  </a>
                ) : (
                  <code className="text-xs text-muted-foreground shrink-0">{commit.hash.slice(0, 7)}</code>
                )}
                <span className="text-sm truncate">{commit.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Changed Files Section */}
      {changedFiles.length > 0 && (
        <div className="space-y-2">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setFilesExpanded(!filesExpanded)}
          >
            {filesExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">变更文件</span>
            <span className="text-xs text-muted-foreground">({changedFiles.length})</span>
          </div>
          {filesExpanded && (
            <div className="rounded-md border divide-y max-h-48 overflow-auto">
              {changedFiles.map((file, i) => {
                const diffUrl = buildFileDiffUrl(file)
                const status = fileDetails.get(file)
                return (
                  <div key={i} className="px-3 py-1.5 flex items-center gap-2">
                    {status && <StatusBadge status={status} />}
                    <code className="text-xs text-muted-foreground flex-1 truncate">{file}</code>
                    {diffUrl && (
                      <a href={diffUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-blue-500" />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
