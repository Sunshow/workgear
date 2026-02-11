import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { User, Bot, GitBranch, Users, Plug } from 'lucide-react'
import { getNodeTypeColor, getNodeTypeLabel } from './dsl-parser'

interface DagNodeData {
  label: string
  nodeType: string
  selected?: boolean
  hasChildren?: boolean
  isChild?: boolean
  parentId?: string
  [key: string]: unknown
}

const typeIcons: Record<string, React.ReactNode> = {
  human_input: <User className="h-3.5 w-3.5" />,
  human_review: <User className="h-3.5 w-3.5" />,
  agent_task: <Bot className="h-3.5 w-3.5" />,
  parallel_group: <Users className="h-3.5 w-3.5" />,
  integration: <Plug className="h-3.5 w-3.5" />,
}

export const DagNode = memo(function DagNode({ data }: NodeProps) {
  const nodeData = data as DagNodeData
  const color = getNodeTypeColor(nodeData.nodeType)
  const isSelected = nodeData.selected
  const isChild = nodeData.isChild

  return (
    <div
      className={`
        rounded-lg border-2 bg-white px-3 py-2 shadow-sm transition-all
        ${isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : ''}
        ${isChild ? 'opacity-90' : ''}
      `}
      style={{
        borderColor: color,
        minWidth: 180,
        maxWidth: 240,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="flex items-center gap-2">
        <div
          className="flex h-6 w-6 items-center justify-center rounded"
          style={{ backgroundColor: color + '20', color }}
        >
          {typeIcons[nodeData.nodeType] || <GitBranch className="h-3.5 w-3.5" />}
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="truncate text-xs font-semibold text-gray-800">{nodeData.label}</p>
          <p className="text-[10px] text-gray-500">{getNodeTypeLabel(nodeData.nodeType)}</p>
        </div>
      </div>

      {nodeData.hasChildren && (
        <div className="mt-1 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">
          包含子节点
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  )
})
