import { parse } from 'yaml'

export interface DslNode {
  id: string
  name: string
  type: string
  config?: any
  agent?: any
  onReject?: any
  children?: DslNode[]
}

export interface DslEdge {
  from: string
  to: string
}

export interface ParseResult {
  nodes: DslNode[]
  edges: DslEdge[]
  errors: string[]
  raw: any | null
}

const VALID_NODE_TYPES = [
  'human_input',
  'human_review',
  'agent_task',
  'parallel_group',
  'integration',
]

export function parseDsl(yamlStr: string): ParseResult {
  const errors: string[] = []
  let raw: any = null

  if (!yamlStr || yamlStr.trim().length === 0) {
    return { nodes: [], edges: [], errors: ['DSL 内容为空'], raw: null }
  }

  try {
    raw = parse(yamlStr)
  } catch (e) {
    return {
      nodes: [],
      edges: [],
      errors: [`YAML 解析失败: ${(e as Error).message}`],
      raw: null,
    }
  }

  if (!raw || typeof raw !== 'object') {
    return { nodes: [], edges: [], errors: ['DSL 格式不正确'], raw: null }
  }

  // Validate top-level fields
  if (!raw.name) errors.push('缺少 name 字段')

  // Parse nodes
  const nodes: DslNode[] = []
  const nodeIds = new Set<string>()

  if (!raw.nodes || !Array.isArray(raw.nodes)) {
    errors.push('缺少 nodes 字段或格式不正确')
    return { nodes: [], edges: [], errors, raw }
  }

  for (const node of raw.nodes) {
    if (!node.id) {
      errors.push('节点缺少 id')
      continue
    }
    if (!node.name) {
      errors.push(`节点 ${node.id} 缺少 name`)
    }
    if (!node.type) {
      errors.push(`节点 ${node.id} 缺少 type`)
    } else if (!VALID_NODE_TYPES.includes(node.type)) {
      errors.push(`节点 ${node.id} 的 type "${node.type}" 不合法，可选: ${VALID_NODE_TYPES.join(', ')}`)
    }
    if (nodeIds.has(node.id)) {
      errors.push(`节点 id "${node.id}" 重复`)
    }
    nodeIds.add(node.id)

    const dslNode: DslNode = {
      id: node.id,
      name: node.name || node.id,
      type: node.type || 'unknown',
      config: node.config,
      agent: node.agent,
      onReject: node.on_reject,
    }

    // Parse children for parallel_group
    if (node.type === 'parallel_group' && node.children) {
      dslNode.children = []
      for (const child of node.children) {
        if (!child.id) {
          errors.push(`parallel_group "${node.id}" 的子节点缺少 id`)
          continue
        }
        if (nodeIds.has(child.id)) {
          errors.push(`节点 id "${child.id}" 重复`)
        }
        nodeIds.add(child.id)
        dslNode.children.push({
          id: child.id,
          name: child.name || child.id,
          type: child.type || 'unknown',
          config: child.config,
          agent: child.agent,
          onReject: child.on_reject,
        })
      }
    }

    nodes.push(dslNode)
  }

  // Parse edges
  const edges: DslEdge[] = []
  if (raw.edges && Array.isArray(raw.edges)) {
    for (const edge of raw.edges) {
      if (!edge.from) {
        errors.push('边缺少 from')
        continue
      }
      if (!edge.to) {
        errors.push('边缺少 to')
        continue
      }
      if (!nodeIds.has(edge.from)) {
        errors.push(`边的 from "${edge.from}" 引用了不存在的节点`)
      }
      if (!nodeIds.has(edge.to)) {
        errors.push(`边的 to "${edge.to}" 引用了不存在的节点`)
      }
      edges.push({ from: edge.from, to: edge.to })
    }

    // Check for cycles (simple DFS)
    const cycleError = detectCycle(nodes, edges)
    if (cycleError) {
      errors.push(cycleError)
    }
  }

  // Check for orphan nodes (no incoming or outgoing edges, except first/last)
  if (edges.length > 0 && nodes.length > 1) {
    const connectedNodes = new Set<string>()
    for (const edge of edges) {
      connectedNodes.add(edge.from)
      connectedNodes.add(edge.to)
    }
    for (const node of nodes) {
      if (!connectedNodes.has(node.id)) {
        errors.push(`节点 "${node.id}" 未连接到任何边`)
      }
    }
  }

  return { nodes, edges, errors, raw }
}

function detectCycle(nodes: DslNode[], edges: DslEdge[]): string | null {
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to)
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    inStack.add(nodeId)

    for (const neighbor of adjacency.get(nodeId) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true
      } else if (inStack.has(neighbor)) {
        return true
      }
    }

    inStack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) {
        return '检测到循环依赖，请检查边的定义'
      }
    }
  }

  return null
}

export function getNodeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    human_input: '人工输入',
    human_review: '人工审核',
    agent_task: 'Agent 任务',
    parallel_group: '并行组',
    integration: '外部集成',
  }
  return labels[type] || type
}

export function getNodeTypeColor(type: string): string {
  const colors: Record<string, string> = {
    human_input: '#3b82f6',
    human_review: '#f59e0b',
    agent_task: '#10b981',
    parallel_group: '#8b5cf6',
    integration: '#6366f1',
  }
  return colors[type] || '#6b7280'
}
