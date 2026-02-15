import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { agentProviders, agentModels } from '../db/schema.js'
import { AGENT_TYPES, maskProviderConfig } from '../agent-types.js'

export async function agentProviderRoutes(app: FastifyInstance) {
  // 获取 Provider 列表（按 agent_type 过滤）
  app.get<{ Querystring: { agent_type?: string } }>('/', async (request) => {
    const { agent_type } = request.query

    let query = db.select().from(agentProviders).orderBy(agentProviders.createdAt)
    if (agent_type) {
      query = db.select().from(agentProviders)
        .where(eq(agentProviders.agentType, agent_type))
        .orderBy(agentProviders.createdAt)
    }

    const providers = await query
    // 脱敏 secret 字段
    return providers.map(p => ({
      ...p,
      config: maskProviderConfig(p.agentType, p.config as Record<string, any>),
    }))
  })

  // 获取单个 Provider
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const result = await db.select().from(agentProviders).where(eq(agentProviders.id, id))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Provider not found' })
    }
    const p = result[0]
    return {
      ...p,
      config: maskProviderConfig(p.agentType, p.config as Record<string, any>),
    }
  })

  // 创建 Provider
  app.post<{
    Body: {
      agentType: string
      name: string
      config: Record<string, any>
      isDefault?: boolean
    }
  }>('/', async (request, reply) => {
    const { agentType, name, config, isDefault } = request.body

    if (!agentType || !name || !config) {
      return reply.status(400).send({ error: 'agentType, name, config are required' })
    }
    if (!AGENT_TYPES[agentType]) {
      return reply.status(400).send({ error: `Unknown agent type: ${agentType}` })
    }

    // 如果设为默认，先取消该类型的其他默认
    if (isDefault) {
      await db.update(agentProviders)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(agentProviders.agentType, agentType))
    }

    const result = await db.insert(agentProviders).values({
      agentType,
      name,
      config,
      isDefault: isDefault ?? false,
    }).returning()

    return reply.status(201).send(result[0])
  })

  // 更新 Provider
  app.put<{
    Params: { id: string }
    Body: {
      name?: string
      config?: Record<string, any>
      isDefault?: boolean
    }
  }>('/:id', async (request, reply) => {
    const { id } = request.params
    const { name, config, isDefault } = request.body

    const existing = await db.select().from(agentProviders).where(eq(agentProviders.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Provider not found' })
    }

    const provider = existing[0]

    // 如果设为默认，先取消该类型的其他默认
    if (isDefault) {
      await db.update(agentProviders)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(agentProviders.agentType, provider.agentType))
    }

    // 合并 config：如果新 config 中的 secret 字段包含 *** 则保留旧值
    let mergedConfig = config
    if (config) {
      const oldConfig = provider.config as Record<string, any>
      mergedConfig = { ...config }
      for (const [key, value] of Object.entries(mergedConfig)) {
        if (typeof value === 'string' && value.includes('***')) {
          mergedConfig[key] = oldConfig[key]
        }
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (name !== undefined) updateData.name = name
    if (mergedConfig !== undefined) updateData.config = mergedConfig
    if (isDefault !== undefined) updateData.isDefault = isDefault

    const result = await db.update(agentProviders)
      .set(updateData)
      .where(eq(agentProviders.id, id))
      .returning()

    const p = result[0]
    return {
      ...p,
      config: maskProviderConfig(p.agentType, p.config as Record<string, any>),
    }
  })

  // 设为默认 Provider
  app.put<{ Params: { id: string } }>('/:id/default', async (request, reply) => {
    const { id } = request.params

    const existing = await db.select().from(agentProviders).where(eq(agentProviders.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Provider not found' })
    }

    const provider = existing[0]

    // 取消该类型的其他默认
    await db.update(agentProviders)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(agentProviders.agentType, provider.agentType))

    // 设为默认
    await db.update(agentProviders)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(agentProviders.id, id))

    return { success: true }
  })

  // 删除 Provider
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params

    const existing = await db.select().from(agentProviders).where(eq(agentProviders.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Provider not found' })
    }

    await db.delete(agentProviders).where(eq(agentProviders.id, id))
    return reply.status(204).send()
  })

  // ─── Model 子路由 ───

  // 获取 Provider 下的 Model 列表
  app.get<{ Params: { id: string } }>('/:id/models', async (request, reply) => {
    const { id } = request.params

    const existing = await db.select().from(agentProviders).where(eq(agentProviders.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Provider not found' })
    }

    return db.select().from(agentModels)
      .where(eq(agentModels.providerId, id))
      .orderBy(agentModels.createdAt)
  })

  // 添加 Model
  app.post<{
    Params: { id: string }
    Body: {
      modelName: string
      displayName?: string
      isDefault?: boolean
    }
  }>('/:id/models', async (request, reply) => {
    const { id } = request.params
    const { modelName, displayName, isDefault } = request.body

    if (!modelName) {
      return reply.status(400).send({ error: 'modelName is required' })
    }

    const existing = await db.select().from(agentProviders).where(eq(agentProviders.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Provider not found' })
    }

    // 如果设为默认，先取消该 Provider 的其他默认
    if (isDefault) {
      await db.update(agentModels)
        .set({ isDefault: false })
        .where(eq(agentModels.providerId, id))
    }

    const result = await db.insert(agentModels).values({
      providerId: id,
      modelName,
      displayName: displayName || null,
      isDefault: isDefault ?? false,
    }).returning()

    return reply.status(201).send(result[0])
  })
}

// ─── Model 独立路由（删除、设默认） ───

export async function agentModelRoutes(app: FastifyInstance) {
  // 设为默认 Model
  app.put<{ Params: { id: string } }>('/:id/default', async (request, reply) => {
    const { id } = request.params

    const existing = await db.select().from(agentModels).where(eq(agentModels.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Model not found' })
    }

    const model = existing[0]

    // 取消该 Provider 的其他默认
    await db.update(agentModels)
      .set({ isDefault: false })
      .where(eq(agentModels.providerId, model.providerId))

    // 设为默认
    await db.update(agentModels)
      .set({ isDefault: true })
      .where(eq(agentModels.id, id))

    return { success: true }
  })

  // 删除 Model
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params

    const existing = await db.select().from(agentModels).where(eq(agentModels.id, id))
    if (existing.length === 0) {
      return reply.status(404).send({ error: 'Model not found' })
    }

    await db.delete(agentModels).where(eq(agentModels.id, id))
    return reply.status(204).send()
  })
}
