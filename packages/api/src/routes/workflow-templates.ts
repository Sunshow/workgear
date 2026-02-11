import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workflowTemplates } from '../db/schema.js'

export async function workflowTemplateRoutes(app: FastifyInstance) {
  // 获取所有模板
  app.get('/', async () => {
    const result = await db
      .select()
      .from(workflowTemplates)
      .orderBy(workflowTemplates.createdAt)
    return result
  })

  // 获取单个模板
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const result = await db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.id, id))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Template not found' })
    }
    return result[0]
  })

  // 按 slug 获取模板
  app.get<{ Params: { slug: string } }>('/by-slug/:slug', async (request, reply) => {
    const { slug } = request.params
    const result = await db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.slug, slug))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Template not found' })
    }
    return result[0]
  })
}
