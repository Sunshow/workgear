import { useMemo, useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { DslNode, DslEdge } from './dsl-parser'
import { DagNode } from './dag-node'
import { NodeDetailPanel } from './node-detail-panel'

interface DagPreviewProps {
  nodes: DslNode[]
  edges: DslEdge[]
  errors: string[]
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
}

const nodeTypes: NodeTypes = {
  dslNode: DagNode,
}

// Auto-layout: simple top-to-bottom positioning
function layoutNodes(dslNodes: DslNode[], dslEdges: DslEdge[]): Node[] {
  const NODE_WIDTH = 220
  const NODE_HEIGHT = 70
  const VERTICAL_GAP = 40
  const HORIZONTAL_GAP = 40
  const CHILD_INDENT = 30

  // Build adjacency for topological sort
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const allNodeIds: string[] = []

  for (const node of dslNodes) {
    allNodeIds.push(node.id)
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }
  for (const edge of dslEdges) {
    adjacency.get(edge.from)?.push(edge.to)
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1)
  }

  // Topological sort (Kahn's algorithm)
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)
    for (const neighbor of adjacency.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }

  // If cycle detected, fall back to original order
  if (sorted.length !== allNodeIds.length) {
    sorted.length = 0
    sorted.push(...allNodeIds)
  }

  const nodeMap = new Map<string, DslNode>()
  for (const node of dslNodes) {
    nodeMap.set(node.id, node)
  }

  const result: Node[] = []
  let y = 40

  for (const nodeId of sorted) {
    const dslNode = nodeMap.get(nodeId)
    if (!dslNode) continue

    result.push({
      id: dslNode.id,
      type: 'dslNode',
      position: { x: 60, y },
      data: {
        label: dslNode.name,
        nodeType: dslNode.type,
        hasChildren: !!(dslNode.children && dslNode.children.length > 0),
        config: dslNode.config,
        agent: dslNode.agent,
        onReject: dslNode.onReject,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    })

    y += NODE_HEIGHT + VERTICAL_GAP

    // Layout children for parallel_group
    if (dslNode.children && dslNode.children.length > 0) {
      let childX = 60 + CHILD_INDENT

      for (const child of dslNode.children) {
        result.push({
          id: child.id,
          type: 'dslNode',
          position: { x: childX, y },
          data: {
            label: child.name,
            nodeType: child.type,
            isChild: true,
            parentId: dslNode.id,
            config: child.config,
            agent: child.agent,
            onReject: child.onReject,
          },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        })
        childX += NODE_WIDTH + HORIZONTAL_GAP
      }
      y += NODE_HEIGHT + VERTICAL_GAP
    }
  }

  return result
}

function buildEdges(dslEdges: DslEdge[], dslNodes: DslNode[]): Edge[] {
  const edges: Edge[] = []

  // Main edges
  for (const edge of dslEdges) {
    edges.push({
      id: `${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      type: 'smoothstep',
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
    })
  }

  // Parent-child edges for parallel_group
  for (const node of dslNodes) {
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        edges.push({
          id: `${node.id}-child-${child.id}`,
          source: node.id,
          target: child.id,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '5 5' },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#8b5cf6' },
        })
      }
    }
  }

  // Reject edges (dashed red)
  for (const node of dslNodes) {
    if (node.onReject) {
      const gotoTarget =
        typeof node.onReject.goto === 'string'
          ? node.onReject.goto
          : node.onReject.goto?.node_id
      if (gotoTarget) {
        edges.push({
          id: `reject-${node.id}-${gotoTarget}`,
          source: node.id,
          target: gotoTarget,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '5 5' },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#ef4444' },
          label: '打回',
          labelStyle: { fill: '#ef4444', fontSize: 10 },
        })
      }
    }
    // Also check children
    if (node.children) {
      for (const child of node.children) {
        if (child.onReject) {
          const gotoTarget =
            typeof child.onReject.goto === 'string'
              ? child.onReject.goto
              : child.onReject.goto?.node_id
          if (gotoTarget) {
            edges.push({
              id: `reject-${child.id}-${gotoTarget}`,
              source: child.id,
              target: gotoTarget,
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '5 5' },
              markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#ef4444' },
              label: '打回',
              labelStyle: { fill: '#ef4444', fontSize: 10 },
            })
          }
        }
      }
    }
  }

  return edges
}

export function DagPreview({
  nodes: dslNodes,
  edges: dslEdges,
  errors,
  selectedNodeId,
  onNodeClick,
}: DagPreviewProps) {
  const [detailNode, setDetailNode] = useState<DslNode | null>(null)

  const flowNodes = useMemo(() => {
    const laid = layoutNodes(dslNodes, dslEdges)
    // Highlight selected node
    return laid.map((n) => ({
      ...n,
      data: { ...n.data, selected: n.id === selectedNodeId },
    }))
  }, [dslNodes, dslEdges, selectedNodeId])

  const flowEdges = useMemo(() => buildEdges(dslEdges, dslNodes), [dslEdges, dslNodes])

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick(node.id)
      // Find the DSL node for detail panel
      const found = findDslNode(dslNodes, node.id)
      setDetailNode(found)
    },
    [dslNodes, onNodeClick]
  )

  if (dslNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30">
        <div className="text-center">
          <p className="text-muted-foreground">
            {errors.length > 0 ? '修复 YAML 错误后预览 DAG' : '编辑 YAML 以预览 DAG'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          style={{ width: 120, height: 80 }}
        />
      </ReactFlow>

      {detailNode && (
        <NodeDetailPanel node={detailNode} onClose={() => setDetailNode(null)} />
      )}
    </div>
  )
}

function findDslNode(nodes: DslNode[], id: string): DslNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      for (const child of node.children) {
        if (child.id === id) return child
      }
    }
  }
  return null
}
