import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tasks } from '../db/schema.js'

export async function taskRoutes(app: FastifyInstance) {
  // 获取项目的所有任务
  app.get<{ Querystring: { projectId: string } }>('/', async (request) => {
    const { projectId } = request.query
    const result = await db.select().from(tasks).where(eq(tasks.projectId, projectId))
    return result
  })

  // 获取单个任务
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const result = await db.select().from(tasks).where(eq(tasks.id, id))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return result[0]
  })

  // 创建任务
  app.post<{
    Body: { projectId: string; columnId: string; title: string; description?: string }
  }>('/', async (request, reply) => {
    const { projectId, columnId, title, description } = request.body

    if (!title || title.trim().length === 0) {
      return reply.status(422).send({ error: 'Task title is required' })
    }

    // 获取当前列中最大 position
    const existing = await db.select()
      .from(tasks)
      .where(eq(tasks.columnId, columnId))
    const maxPosition = existing.reduce((max, t) => Math.max(max, t.position), -1)

    const [task] = await db.insert(tasks).values({
      projectId,
      columnId,
      title: title.trim(),
      description: description || null,
      position: maxPosition + 1,
    }).returning()

    return reply.status(201).send(task)
  })

  // 更新任务
  app.put<{
    Params: { id: string }
    Body: { title?: string; description?: string; columnId?: string; position?: number; gitBranch?: string }
  }>('/:id', async (request, reply) => {
    const { id } = request.params
    const { title, description, columnId, position, gitBranch } = request.body

    const [updated] = await db.update(tasks)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(columnId !== undefined && { columnId }),
        ...(position !== undefined && { position }),
        ...(gitBranch !== undefined && { gitBranch }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return updated
  })

  // 删除任务
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const [deleted] = await db.delete(tasks).where(eq(tasks.id, id)).returning()
    if (!deleted) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return { success: true }
  })
}
