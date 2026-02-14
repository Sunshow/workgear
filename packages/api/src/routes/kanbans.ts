import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { kanbans, kanbanColumns } from '../db/schema.js'
import { authenticate } from '../middleware/auth.js'

export async function kanbanRoutes(app: FastifyInstance) {
  // 获取项目的看板
  app.get<{ Querystring: { projectId: string } }>('/', { preHandler: [authenticate] }, async (request) => {
    const { projectId } = request.query
    const result = await db.select().from(kanbans).where(eq(kanbans.projectId, projectId))
    return result
  })

  // 获取看板的列
  app.get<{ Params: { id: string } }>('/:id/columns', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params

    const kanban = await db.select().from(kanbans).where(eq(kanbans.id, id))
    if (kanban.length === 0) {
      return reply.status(404).send({ error: 'Kanban not found' })
    }

    const columns = await db.select()
      .from(kanbanColumns)
      .where(eq(kanbanColumns.kanbanId, id))
      .orderBy(kanbanColumns.position)

    return { kanban: kanban[0], columns }
  })
}
