import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agentRoles } from '../db/schema.js'

export async function agentRoleRoutes(app: FastifyInstance) {
  // 获取所有角色
  app.get('/', async () => {
    return db
      .select()
      .from(agentRoles)
      .orderBy(agentRoles.createdAt)
  })

  // 获取单个角色
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const result = await db
      .select()
      .from(agentRoles)
      .where(eq(agentRoles.id, id))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Agent role not found' })
    }
    return result[0]
  })

  // 创建角色
  app.post<{
    Body: {
      slug: string
      name: string
      description?: string
      agentType?: string
      defaultModel?: string | null
      systemPrompt: string
    }
  }>('/', async (request, reply) => {
    const { slug, name, description, agentType, defaultModel, systemPrompt } = request.body

    if (!slug || !name || !systemPrompt) {
      return reply.status(400).send({ error: 'slug, name, systemPrompt are required' })
    }

    const result = await db
      .insert(agentRoles)
      .values({
        slug,
        name,
        description: description || null,
        agentType: agentType || 'claude-code',
        defaultModel: defaultModel || null,
        systemPrompt,
        isBuiltin: false,
      })
      .returning()

    return reply.status(201).send(result[0])
  })

  // 更新角色
  app.put<{
    Params: { id: string }
    Body: {
      name?: string
      description?: string
      agentType?: string
      defaultModel?: string | null
      systemPrompt?: string
    }
  }>('/:id', async (request, reply) => {
    const { id } = request.params
    const { name, description, agentType, defaultModel, systemPrompt } = request.body

    // Check existence
    const existing = await db
      .select()
      .from(agentRoles)
      .where(eq(agentRoles.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Agent role not found' })
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (agentType !== undefined) updateData.agentType = agentType
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel
    if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt

    const result = await db
      .update(agentRoles)
      .set(updateData)
      .where(eq(agentRoles.id, id))
      .returning()

    return result[0]
  })

  // 删除角色（内置角色不可删）
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params

    const existing = await db
      .select()
      .from(agentRoles)
      .where(eq(agentRoles.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Agent role not found' })
    }
    if (existing[0].isBuiltin) {
      return reply.status(403).send({ error: 'Cannot delete built-in agent role' })
    }

    await db.delete(agentRoles).where(eq(agentRoles.id, id))
    return reply.status(204).send()
  })
}
