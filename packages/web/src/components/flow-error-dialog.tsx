import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Copy } from 'lucide-react'

interface FlowErrorDialogProps {
  error: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FlowErrorDialog({ error, open, onOpenChange }: FlowErrorDialogProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(error)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>流程执行错误详情</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
            {error}
          </pre>
          <Button size="sm" variant="outline" onClick={handleCopy}>
            <Copy className="mr-1 h-3 w-3" />
            复制错误信息
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
