import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects, boards, boardColumns } from '../db/schema.js'

export async function projectRoutes(app: FastifyInstance) {
  // 获取所有项目
  app.get('/', async () => {
    const result = await db.select().from(projects).orderBy(projects.createdAt)
    return result
  })

  // 获取单个项目
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const result = await db.select().from(projects).where(eq(projects.id, id))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Project not found' })
    }
    return result[0]
  })

  // 创建项目（自动创建默认看板和列）
  app.post<{
    Body: { name: string; description?: string; gitRepoUrl?: string }
  }>('/', async (request, reply) => {
    const { name, description, gitRepoUrl } = request.body

    if (!name || name.trim().length === 0) {
      return reply.status(422).send({ error: 'Project name is required' })
    }

    // 创建项目
    const [project] = await db.insert(projects).values({
      name: name.trim(),
      description: description || null,
      gitRepoUrl: gitRepoUrl || null,
    }).returning()

    // 创建默认看板
    const [board] = await db.insert(boards).values({
      projectId: project.id,
      name: 'Default Board',
    }).returning()

    // 创建默认列
    const defaultColumns = ['Backlog', 'In Progress', 'Review', 'Done']
    await db.insert(boardColumns).values(
      defaultColumns.map((colName, idx) => ({
        boardId: board.id,
        name: colName,
        position: idx,
      }))
    )

    return reply.status(201).send(project)
  })

  // 更新项目
  app.put<{
    Params: { id: string }
    Body: { name?: string; description?: string; gitRepoUrl?: string }
  }>('/:id', async (request, reply) => {
    const { id } = request.params
    const { name, description, gitRepoUrl } = request.body

    const [updated] = await db.update(projects)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(gitRepoUrl !== undefined && { gitRepoUrl }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Project not found' })
    }
    return updated
  })

  // 删除项目
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const [deleted] = await db.delete(projects).where(eq(projects.id, id)).returning()
    if (!deleted) {
      return reply.status(404).send({ error: 'Project not found' })
    }
    return { success: true }
  })
}
