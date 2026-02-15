import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'

interface FlowErrorDialogProps {
  error: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FlowErrorDialog({ error, open, onOpenChange }: FlowErrorDialogProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(error)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* silent */ }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>流程执行错误详情</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            readOnly
            value={error}
            rows={20}
            className="text-xs font-mono resize-none"
          />
          <Button size="sm" variant="outline" onClick={handleCopy}>
            {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
            {copied ? '已复制' : '复制错误信息'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
