import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { nodeRuns } from '../db/schema.js'
import * as orchestrator from '../grpc/client.js'

export async function nodeRunRoutes(app: FastifyInstance) {
  // Get node run details
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params

    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))

    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    return nodeRun
  })

  // Submit review (approve/reject/edit)
  app.post<{
    Params: { id: string }
    Body: {
      action: 'approve' | 'reject' | 'edit_and_approve'
      feedback?: string
      editedContent?: string
      changeSummary?: string
    }
  }>('/:id/review', async (request, reply) => {
    const { id } = request.params
    const { action, feedback, editedContent, changeSummary } = request.body

    // Validate node exists and is waiting for human
    const [nodeRun] = await db.select().from(nodeRuns).where(eq(nodeRuns.id, id))
    if (!nodeRun) {
      return reply.status(404).send({ error: 'NodeRun not found' })
    }

    if (nodeRun.status !== 'waiting_human') {
      return reply.status(422).send({ error: `Cannot review node in status: ${nodeRun.status}` })
    }

    try {
      let result: { success: boolean; error?: string }

      switch (action) {
        case 'approve':
          result = await orchestrator.approveNode(id)
          break
        case 'reject':
          if (!feedback) {
            return reply.status(422).send({ error: 'feedback is required for reject action' })
          }
          result = await orchestrator.rejectNode(id, feedback)
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
        return reply.status(500).send({ error: result.error || 'Orchestrator error' })
      }

      return { success: true }
    } catch (error: any) {
      app.log.error(error)
      return reply.status(500).send({ error: error.message || 'Failed to retry node' })
    }
  })
}
