import { X } from 'lucide-react'
import type { DslNode } from './dsl-parser'
import { getNodeTypeLabel, getNodeTypeColor } from './dsl-parser'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface NodeDetailPanelProps {
  node: DslNode
  onClose: () => void
}

export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const color = getNodeTypeColor(node.type)

  return (
    <div className="absolute bottom-4 right-4 z-10 w-72 rounded-lg border bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-sm">{node.name}</h3>
          <Badge
            className="mt-1 text-[10px]"
            style={{ backgroundColor: color + '20', color, border: `1px solid ${color}` }}
          >
            {getNodeTypeLabel(node.type)}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="mt-3 space-y-2 text-xs">
        <div>
          <span className="font-medium text-gray-500">ID:</span>
          <span className="ml-2 font-mono text-gray-700">{node.id}</span>
        </div>

        {node.agent && (
          <div>
            <span className="font-medium text-gray-500">Agent:</span>
            <span className="ml-2 text-gray-700">
              {typeof node.agent.role === 'string' ? node.agent.role : JSON.stringify(node.agent.role)}
            </span>
            {node.agent.model && (
              <span className="ml-1 text-gray-400">({node.agent.model})</span>
            )}
          </div>
        )}

        {node.config?.mode && (
          <div>
            <span className="font-medium text-gray-500">模式:</span>
            <span className="ml-2 text-gray-700">{node.config.mode}</span>
          </div>
        )}

        {node.config?.actions && (
          <div>
            <span className="font-medium text-gray-500">操作:</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {node.config.actions.map((action: string) => (
                <Badge key={action} variant="outline" className="text-[10px]">
                  {action}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {node.config?.form && (
          <div>
            <span className="font-medium text-gray-500">表单字段:</span>
            <div className="mt-1 space-y-1">
              {node.config.form.map((field: any) => (
                <div key={field.field} className="flex items-center gap-1">
                  <span className="font-mono text-gray-600">{field.field}</span>
                  <span className="text-gray-400">({field.type})</span>
                  {field.required && <span className="text-red-400">*</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {node.config?.timeout && (
          <div>
            <span className="font-medium text-gray-500">超时:</span>
            <span className="ml-2 text-gray-700">{node.config.timeout}</span>
          </div>
        )}

        {node.onReject && (
          <div className="rounded border border-red-200 bg-red-50 p-2">
            <span className="font-medium text-red-600">打回配置:</span>
            <div className="mt-1 text-gray-600">
              <div>
                目标:{' '}
                <span className="font-mono">
                  {typeof node.onReject.goto === 'string'
                    ? node.onReject.goto
                    : node.onReject.goto?.node_id}
                </span>
              </div>
              {node.onReject.max_loops && (
                <div>最大次数: {node.onReject.max_loops}</div>
              )}
            </div>
          </div>
        )}

        {node.children && node.children.length > 0 && (
          <div>
            <span className="font-medium text-gray-500">子节点:</span>
            <div className="mt-1 space-y-1">
              {node.children.map((child) => (
                <div key={child.id} className="flex items-center gap-1">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: getNodeTypeColor(child.type) }}
                  />
                  <span className="text-gray-700">{child.name}</span>
                  <span className="text-gray-400">({getNodeTypeLabel(child.type)})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
