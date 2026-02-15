import { useEffect, useRef, useCallback } from 'react'

type EventHandler = (event: WSEvent) => void

export interface WSEvent {
  type: string
  channel: string
  flowRunId?: string
  nodeRunId?: string
  nodeId?: string
  data?: Record<string, unknown>
  timestamp?: string
}

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
const RECONNECT_DELAY = 3000

let ws: WebSocket | null = null
let handlers = new Map<string, Set<EventHandler>>()
let subscriptions = new Set<string>()

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return
  }

  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    console.log('[WS] Connected')
    // Re-subscribe to all channels
    for (const channel of subscriptions) {
      ws?.send(JSON.stringify({ type: 'subscribe', channel }))
    }
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WSEvent
      if (msg.type === 'pong') return

      // Notify channel-specific handlers
      if (msg.channel) {
        const channelHandlers = handlers.get(msg.channel)
        if (channelHandlers) {
          for (const handler of channelHandlers) {
            handler(msg)
          }
        }
      }

      // Notify wildcard handlers
      const wildcardHandlers = handlers.get('*')
      if (wildcardHandlers) {
        for (const handler of wildcardHandlers) {
          handler(msg)
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting...')
    setTimeout(connect, RECONNECT_DELAY)
  }

  ws.onerror = () => {
    ws?.close()
  }
}

function subscribe(channel: string) {
  subscriptions.add(channel)
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', channel }))
  } else {
    connect()
  }
}

function unsubscribe(channel: string) {
  subscriptions.delete(channel)
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe', channel }))
  }
}

function addHandler(channel: string, handler: EventHandler) {
  if (!handlers.has(channel)) {
    handlers.set(channel, new Set())
  }
  handlers.get(channel)!.add(handler)
}

function removeHandler(channel: string, handler: EventHandler) {
  handlers.get(channel)?.delete(handler)
  if (handlers.get(channel)?.size === 0) {
    handlers.delete(channel)
  }
}

// Initialize connection
connect()

/**
 * Hook to subscribe to a WebSocket channel and receive events
 */
export function useWebSocket(channel: string, onEvent: EventHandler) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  const stableHandler = useCallback((event: WSEvent) => {
    handlerRef.current(event)
  }, [])

  useEffect(() => {
    subscribe(channel)
    addHandler(channel, stableHandler)

    return () => {
      removeHandler(channel, stableHandler)
      // Only unsubscribe if no more handlers for this channel
      if (!handlers.has(channel) || handlers.get(channel)!.size === 0) {
        unsubscribe(channel)
      }
    }
  }, [channel, stableHandler])
}

/**
 * Hook to subscribe to flow run events
 */
export function useFlowRunEvents(flowRunId: string | null | undefined, handlers: {
  onNodeStarted?: (data: Record<string, unknown>) => void
  onNodeCompleted?: (data: Record<string, unknown>) => void
  onNodeWaitingHuman?: (data: Record<string, unknown>) => void
  onNodeFailed?: (data: Record<string, unknown>) => void
  onNodeRejected?: (data: Record<string, unknown>) => void
  onNodeCancelled?: (data: Record<string, unknown>) => void
  onFlowStarted?: (data: Record<string, unknown>) => void
  onFlowCompleted?: (data: Record<string, unknown>) => void
  onFlowFailed?: (data: Record<string, unknown>) => void
  onFlowCancelled?: (data: Record<string, unknown>) => void
}) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const channel = flowRunId ? `flow-run:${flowRunId}` : ''

  useWebSocket(channel || '__noop__', useCallback((event: WSEvent) => {
    if (!channel) return
    const h = handlersRef.current
    const data = event.data || {}

    switch (event.type) {
      case 'node.started': h.onNodeStarted?.(data); break
      case 'node.completed': h.onNodeCompleted?.(data); break
      case 'node.waiting_human': h.onNodeWaitingHuman?.(data); break
      case 'node.failed': h.onNodeFailed?.(data); break
      case 'node.rejected': h.onNodeRejected?.(data); break
      case 'node.cancelled': h.onNodeCancelled?.(data); break
      case 'flow.started': h.onFlowStarted?.(data); break
      case 'flow.completed': h.onFlowCompleted?.(data); break
      case 'flow.failed': h.onFlowFailed?.(data); break
      case 'flow.cancelled': h.onFlowCancelled?.(data); break
    }
  }, [channel]))
}

/**
 * Log stream event from node execution
 */
export interface LogStreamEvent {
  type: 'assistant' | 'tool_use' | 'result' | string
  content?: string
  tool_name?: string
  tool_input?: Record<string, any>
  timestamp: number
}

/**
 * Hook to subscribe to real-time log stream from a node run
 */
export function useNodeLogStream(
  nodeRunId: string | undefined,
  onLogEvent: (event: LogStreamEvent) => void
) {
  const handlerRef = useRef(onLogEvent)
  handlerRef.current = onLogEvent

  const channel = nodeRunId ? `node-run:${nodeRunId}` : ''

  useWebSocket(channel || '__noop__', useCallback((event: WSEvent) => {
    if (!channel || event.type !== 'node.log_stream') return
    if (event.data) {
      handlerRef.current(event.data as unknown as LogStreamEvent)
    }
  }, [channel]))
}
