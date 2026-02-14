import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { eq } from 'drizzle-orm'
import { subscribeEvents } from '../grpc/client.js'
import type { ServerEvent } from '../grpc/client.js'
import { db } from '../db/index.js'
import { flowRuns, tasks, projects, timelineEvents } from '../db/schema.js'
import { GitHubProvider } from '../lib/github-provider.js'

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

        // Also broadcast to event-type channel
        broadcast(`event:${event.eventType}`, wsEvent)

        // For flow lifecycle events, broadcast to project channel so kanban pages can refresh
        const flowLifecycleEvents = ['flow.started', 'flow.completed', 'flow.cancelled', 'flow.failed']
        if (flowLifecycleEvents.includes(event.eventType) && event.flowRunId) {
          broadcastToProjectChannel(event.flowRunId, wsEvent, logger).catch(err => {
            logger.warn(`Failed to broadcast to project channel: ${err.message}`)
          })
        }

        // Handle flow.completed — auto-merge PR if enabled
        if (event.eventType === 'flow.completed' && event.flowRunId) {
          handleFlowCompletedAutoMerge(event.flowRunId, logger).catch(err => {
            logger.error(`Auto-merge error for flow ${event.flowRunId}: ${err.message}`)
          })
        }
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

// ─── Broadcast Flow Events to Project Channel ───

async function broadcastToProjectChannel(
  flowRunId: string,
  wsEvent: Record<string, unknown>,
  logger: { info: (...args: any[]) => void; error: (...args: any[]) => void; warn: (...args: any[]) => void }
) {
  const [flowRun] = await db.select().from(flowRuns).where(eq(flowRuns.id, flowRunId))
  if (!flowRun?.taskId) return

  const [task] = await db.select().from(tasks).where(eq(tasks.id, flowRun.taskId))
  if (!task?.projectId) return

  broadcast(`project:${task.projectId}`, wsEvent)
}

// ─── Auto-Merge PR on Flow Completion ───

async function handleFlowCompletedAutoMerge(
  flowRunId: string,
  logger: { info: (...args: any[]) => void; error: (...args: any[]) => void; warn: (...args: any[]) => void }
) {
  // 1. Query flow_run
  const [flowRun] = await db.select().from(flowRuns).where(eq(flowRuns.id, flowRunId))
  if (!flowRun?.prNumber) return // No PR, skip

  // 2. Query task → project
  const [task] = await db.select().from(tasks).where(eq(tasks.id, flowRun.taskId))
  if (!task) return

  const [project] = await db.select().from(projects).where(eq(projects.id, task.projectId))
  if (!project?.autoMergePr || !project.gitAccessToken || !project.gitRepoUrl) return

  // 3. Execute squash merge
  const provider = new GitHubProvider(project.gitAccessToken)
  const repoInfo = provider.parseRepoUrl(project.gitRepoUrl)
  if (!repoInfo) return

  logger.info(`Auto-merging PR #${flowRun.prNumber} for flow ${flowRunId}...`)

  const mergeResult = await provider.mergePullRequest({
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    pullNumber: flowRun.prNumber,
    mergeMethod: 'squash',
    commitTitle: task.title,
  })

  if (mergeResult.merged) {
    // 4. Update flow_run
    await db.update(flowRuns).set({
      prMergedAt: new Date(),
      mergeCommitSha: mergeResult.sha || null,
    }).where(eq(flowRuns.id, flowRunId))

    // 5. Record timeline
    await db.insert(timelineEvents).values({
      taskId: task.id,
      flowRunId: flowRunId,
      eventType: 'pr_merged',
      content: {
        prUrl: flowRun.prUrl,
        message: `PR 已自动合并`,
        merge_commit_sha: mergeResult.sha || undefined,
      },
    })

    // 6. Delete feature branch
    if (flowRun.branchName) {
      await provider.deleteBranch(repoInfo.owner, repoInfo.repo, flowRun.branchName).catch(() => {})
    }

    logger.info(`Auto-merged PR #${flowRun.prNumber} for flow ${flowRunId}`)
  } else {
    // Record merge failure
    await db.insert(timelineEvents).values({
      taskId: task.id,
      flowRunId: flowRunId,
      eventType: 'pr_merge_failed',
      content: {
        prUrl: flowRun.prUrl,
        error: mergeResult.message,
        message: `PR 自动合并失败: ${mergeResult.message}`,
      },
    })

    logger.warn(`Failed to auto-merge PR #${flowRun.prNumber}: ${mergeResult.message}`)
  }
}
