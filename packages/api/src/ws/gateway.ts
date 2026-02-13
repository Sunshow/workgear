import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { subscribeEvents } from '../grpc/client.js'
import type { ServerEvent } from '../grpc/client.js'

interface WSClient {
  ws: WebSocket
  subscriptions: Set<string>
}

const clients = new Map<WebSocket, WSClient>()

let eventStreamHandle: { cancel: () => void } | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export async function wsGateway(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket) => {
    const client: WSClient = { ws: socket, subscriptions: new Set() }
    clients.set(socket, client)

    app.log.info(`WebSocket client connected (total: ${clients.size})`)

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'subscribe' && msg.channel) {
          client.subscriptions.add(msg.channel)
          app.log.info(`Client subscribed to: ${msg.channel}`)
        } else if (msg.type === 'unsubscribe' && msg.channel) {
          client.subscriptions.delete(msg.channel)
        } else if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }))
        }
      } catch {
        // Ignore invalid messages
      }
    })

    socket.on('close', () => {
      clients.delete(socket)
      app.log.info(`WebSocket client disconnected (total: ${clients.size})`)
    })
  })
}

// Broadcast an event to all clients subscribed to matching channels
export function broadcast(channel: string, event: Record<string, unknown>) {
  const message = JSON.stringify({ channel, ...event })

  for (const client of clients.values()) {
    if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
      try {
        client.ws.send(message)
      } catch {
        // Client disconnected
      }
    }
  }
}

// Start listening to Orchestrator events via gRPC and forward to WebSocket clients
export function startEventForwarding(logger: { info: (...args: any[]) => void; error: (...args: any[]) => void; warn: (...args: any[]) => void }) {
  if (eventStreamHandle) {
    eventStreamHandle.cancel()
  }

  const connectStream = () => {
    logger.info('Connecting to Orchestrator event stream...')

    eventStreamHandle = subscribeEvents(
      undefined, // Subscribe to all events
      (event: ServerEvent) => {
        let data: Record<string, unknown> = {}
        try {
          data = JSON.parse(event.dataJson || '{}')
        } catch {
          // Ignore parse errors
        }

        const wsEvent = {
          type: event.eventType,
          flowRunId: event.flowRunId,
          nodeRunId: event.nodeRunId,
          nodeId: event.nodeId,
          data,
          timestamp: event.timestamp,
        }

        // Broadcast to flow-run specific channel
        if (event.flowRunId) {
          broadcast(`flow-run:${event.flowRunId}`, wsEvent)
        }

        // Also broadcast to task channel if we can derive it
        // (clients subscribe to task:{taskId})
        broadcast(`event:${event.eventType}`, wsEvent)
      },
      (err: Error) => {
        logger.warn(`Orchestrator event stream error: ${err.message}`)
        // Reconnect after delay
        reconnectTimer = setTimeout(connectStream, 3000)
      },
    )
  }

  connectStream()
}

export function stopEventForwarding() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (eventStreamHandle) {
    eventStreamHandle.cancel()
    eventStreamHandle = null
  }
}
