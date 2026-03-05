import type { FastifyInstance } from 'fastify'
import { eq, and, desc, ne, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { nodeRuns, flowRuns } from '../db/schema.js'
import * as orchestrator from '../grpc/client.js'
import { authenticate } from '../middleware/auth.js'

export async function nodeRunRoutes(app: FastifyInstance) {
  // 所有节点执行路由都需要登录
  app.addHook('preHandler', authenticate)
  // Get node run details (includes transient artifacts)
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))

    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    return nodeRun
  })

  // Get transient artifacts for a node run
  app.get<{ Params: { id: string } }>('/:id/transient-artifacts', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db
      .select({ transientArtifacts: nodeRuns.transientArtifacts })
      .from(nodeRuns)
      .where(eq(nodeRuns.id, id))

    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    return { artifacts: nodeRun.transientArtifacts || {} }
  })

  // Submit review (approve/reject/edit)
  app.post<{
    Params: { id: string }
    Body: {
      action: 'approve' | 'reject' | 'edit_and_approve'
      feedback?: string
      force?: boolean
      editedContent?: string
      changeSummary?: string
      output?: Record<string, any>
    }
  }>('/:id/review', async (request, reply) => {
    const { id } = request.params
    const { action, feedback, force, editedContent, changeSummary, output } = request.body

    // Validate node exists and is waiting for human
    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    if (nodeRun.status !== 'waiting_human' && !(force && nodeRun.status === 'rejected')) {
      return reply.status(422).send({ error: `Cannot review node in status: ${nodeRun.status}` })
    }

    try {
      let result: { success: boolean; error?: string }

      switch (action) {
        case 'approve':
          // If output is provided, update transient artifacts before approving
          if (output) {
            await db
              .update(nodeRuns)
              .set({ 
                output: JSON.stringify(output),
                transientArtifacts: output._transient ? output : nodeRun.transientArtifacts
              })
              .where(eq(nodeRuns.id, id))
          }
          result = await orchestrator.approveNode(id)
          break
        case 'reject':
          if (!feedback) {
            return reply.status(422).send({ error: 'feedback is required for reject action' })
          }
          result = await orchestrator.rejectNode(id, feedback, force)
          break
        case 'edit_and_approve':
          if (!editedContent) {
            return reply.status(422).send({ error: 'editedContent is required for edit_and_approve action' })
          }
          result = await orchestrator.editNode(id, editedContent, changeSummary || '')
          break
        default:
          return reply.status(422).send({ error: 'Invalid action' })
      }

      if (!result.success) {
        return reply.status(500).send({ error: result.error || 'Orchestrator error' })
      }

      return { success: true }
    } catch (error: any) {
      app.log.error(error)
      return reply.status(500).send({ error: error.message || 'Failed to submit review' })
    }
  })

  // Submit human input
  app.post<{
    Params: { id: string }
    Body: Record<string, any>
  }>('/:id/submit', async (request, reply) => {
    const { id } = request.params
    const data = request.body

    // Validate node exists and is waiting for human
    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    if (nodeRun.status !== 'waiting_human') {
      return reply.status(422).send({ error: `Cannot submit input for node in status: ${nodeRun.status}` })
    }

    try {
      const result = await orchestrator.submitHumanInput(id, JSON.stringify(data))

      if (!result.success) {
        return reply.status(500).send({ error: result.error || 'Orchestrator error' })
      }

      return { success: true }
    } catch (error: any) {
      app.log.error(error)
      return reply.status(500).send({ error: error.message || 'Failed to submit input' })
    }
  })

  // Get node run log stream (for real-time and historical log viewing)
  app.get<{ Params: { id: string } }>('/:id/logs', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db
      .select({ logStream: nodeRuns.logStream })
      .from(nodeRuns)
      .where(eq(nodeRuns.id, id))

    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    return { logs: nodeRun.logStream || [] }
  })

  // Retry a failed node
  app.post<{ Params: { id: string } }>('/:id/retry', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    if (nodeRun.status !== 'failed') {
      return reply.status(422).send({ error: `Can only retry failed nodes, current status: ${nodeRun.status}` })
    }

    try {
      const result = await orchestrator.retryNode(id)

      if (!result.success) {
        const err = result.error || 'Orchestrator error'
        const isBusinessError = /^(can only|cannot|flow has been|not found)/.test(err)
        return reply.status(isBusinessError ? 409 : 500).send({ error: err })
      }

      return { success: true }
    } catch (error: any) {
      app.log.error(error)
      return reply.status(500).send({ error: error.message || 'Failed to retry node' })
    }
  })

  // Rerun a completed agent_task node (re-execute and reset successors)
  app.post<{ Params: { id: string } }>('/:id/rerun', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    if (nodeRun.status !== 'completed') {
      return reply.status(422).send({ error: `Can only rerun completed nodes, current status: ${nodeRun.status}` })
    }

    // Check flow run is not in terminal state
    const [flowRun] = await db
      .select({ status: flowRuns.status })
      .from(flowRuns)
      .where(eq(flowRuns.id, nodeRun.flowRunId))

    if (!flowRun) {
      return reply.status(404).send({ error: 'FlowRun not found' })
    }

    if (flowRun.status === 'completed' || flowRun.status === 'cancelled') {
      return reply.status(422).send({ error: 'Cannot rerun nodes in completed or cancelled flow' })
    }

    try {
      const result = await orchestrator.rerunNode(id)

      if (!result.success) {
        const err = result.error || 'Orchestrator error'
        const isBusinessError = /^(can only|cannot|flow has been|not found)/.test(err)
        return reply.status(isBusinessError ? 409 : 500).send({ error: err })
      }

      return { success: true }
    } catch (error: any) {
      app.log.error(error)
      return reply.status(500).send({ error: error.message || 'Failed to rerun node' })
    }
  })

  // Get previous flow's output for the same node (for artifact reuse)
  app.get<{ Params: { id: string } }>('/:id/previous-output', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    const [flowRun] = await db.select().from(flowRuns).where(eq(flowRuns.id, nodeRun.flowRunId))
    if (!flowRun) {
      return reply.status(404).send({ error: 'FlowRun not found' })
    }

    // Search across ALL previous flows for a completed node with the same node_id and non-null output
    const [prevNodeRun] = await db
      .select({ output: nodeRuns.output, nodeName: nodeRuns.nodeName })
      .from(nodeRuns)
      .innerJoin(flowRuns, eq(nodeRuns.flowRunId, flowRuns.id))
      .where(and(
        eq(flowRuns.taskId, flowRun.taskId),
        ne(flowRuns.id, flowRun.id),
        eq(nodeRuns.nodeId, nodeRun.nodeId),
        eq(nodeRuns.status, 'completed'),
        sql`${nodeRuns.output} IS NOT NULL`
      ))
      .orderBy(desc(flowRuns.createdAt), desc(nodeRuns.attempt))
      .limit(1)

    if (!prevNodeRun || !prevNodeRun.output) {
      return { hasPrevious: false }
    }

    return {
      hasPrevious: true,
      output: prevNodeRun.output,
      nodeName: prevNodeRun.nodeName,
    }
  })

  // Skip a node by injecting previous flow's output
  app.post<{
    Params: { id: string }
    Body: { outputJson: string }
  }>('/:id/skip', async (request, reply) => {
    const { id } = request.params
    const { outputJson } = request.body

    if (!outputJson) {
      return reply.status(422).send({ error: 'outputJson is required' })
    }

    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    try {
      const result = await orchestrator.skipNode(id, outputJson)

      if (!result.success) {
        return reply.status(500).send({ error: result.error || 'Orchestrator error' })
      }

      return { success: true }
    } catch (error: any) {
      app.log.error(error)
      return reply.status(500).send({ error: error.message || 'Failed to skip node' })
    }
  })

  // Proceed with execution for a node paused for reuse check
  app.post<{ Params: { id: string } }>('/:id/proceed', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    if (nodeRun.status !== 'waiting_human') {
      return reply.status(422).send({ error: `Cannot proceed node in status: ${nodeRun.status}` })
    }

    // Remove _reuse_available flag from input and set status to queued
    let input = nodeRun.input ? (typeof nodeRun.input === 'string' ? JSON.parse(nodeRun.input) : nodeRun.input) : {}
    delete input._reuse_available
    await db.update(nodeRuns).set({
      status: 'queued',
      input: JSON.stringify(input),
    }).where(eq(nodeRuns.id, id))

    return { success: true }
  })
}
