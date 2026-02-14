import { useState } from 'react'
import { Copy, Check, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GitTabProps {
  gitBranch: string | null
}

export function GitTab({ gitBranch }: GitTabProps) {
  const [copied, setCopied] = useState(false)

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

  if (!gitBranch) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">暂无 Git 信息</p>
        <p className="mt-1 text-xs text-muted-foreground">启动流程后，Git 分支信息将在此显示</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">分支</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <code className="flex-1 text-sm">{gitBranch}</code>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyBranch}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  )
}
