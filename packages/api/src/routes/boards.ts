import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { boards, boardColumns } from '../db/schema.js'

export async function boardRoutes(app: FastifyInstance) {
  // 获取项目的看板
  app.get<{ Querystring: { projectId: string } }>('/', async (request) => {
    const { projectId } = request.query
    const result = await db.select().from(boards).where(eq(boards.projectId, projectId))
    return result
  })

  // 获取看板的列
  app.get<{ Params: { id: string } }>('/:id/columns', async (request, reply) => {
    const { id } = request.params

    const board = await db.select().from(boards).where(eq(boards.id, id))
    if (board.length === 0) {
      return reply.status(404).send({ error: 'Board not found' })
    }

    const columns = await db.select()
      .from(boardColumns)
      .where(eq(boardColumns.boardId, id))
      .orderBy(boardColumns.position)

    return { board: board[0], columns }
  })
}
