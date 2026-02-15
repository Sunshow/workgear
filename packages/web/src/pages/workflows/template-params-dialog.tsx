import { useState, useEffect } from 'react'
import type { TemplateParameter } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface TemplateParamsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  parameters: TemplateParameter[]
  values: Record<string, any>
  onSave: (values: Record<string, any>) => void
}

export function TemplateParamsDialog({
  open,
  onOpenChange,
  parameters,
  values,
  onSave,
}: TemplateParamsDialogProps) {
  const [localValues, setLocalValues] = useState<Record<string, any>>({})

  useEffect(() => {
    if (open) {
      setLocalValues({ ...values })
    }
  }, [open, values])

  function handleChange(name: string, value: any) {
    setLocalValues((prev) => ({ ...prev, [name]: value }))
  }

  function handleSave() {
    onSave(localValues)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>模板参数配置</DialogTitle>
          <DialogDescription>
            修改流程模板的参数，保存后需点击页面"保存"按钮生效
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {parameters.map((param) => (
            <div key={param.name}>
              <Label htmlFor={`param-${param.name}`}>
                {param.label}
                {param.required && <span className="ml-1 text-destructive">*</span>}
              </Label>
              {param.type === 'select' && param.options ? (
                <Select
                  value={String(localValues[param.name] ?? '')}
                  onValueChange={(value) => handleChange(param.name, value)}
                >
                  <SelectTrigger id={`param-${param.name}`} className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {param.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : param.type === 'number' ? (
                <Input
                  id={`param-${param.name}`}
                  type="number"
                  value={localValues[param.name] ?? ''}
                  onChange={(e) => handleChange(param.name, Number(e.target.value))}
                  min={param.min}
                  max={param.max}
                  className="mt-1"
                />
              ) : param.type === 'textarea' ? (
                <Textarea
                  id={`param-${param.name}`}
                  value={localValues[param.name] ?? ''}
                  onChange={(e) => handleChange(param.name, e.target.value)}
                  className="mt-1"
                  rows={3}
                />
              ) : (
                <Input
                  id={`param-${param.name}`}
                  value={localValues[param.name] ?? ''}
                  onChange={(e) => handleChange(param.name, e.target.value)}
                  className="mt-1"
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
