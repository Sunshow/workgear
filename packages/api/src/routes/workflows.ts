import type { FastifyInstance } from 'fastify'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workflows, workflowTemplates } from '../db/schema.js'
import { authenticate } from '../middleware/auth.js'

export async function workflowRoutes(app: FastifyInstance) {
  // 所有流程路由都需要登录
  app.addHook('preHandler', authenticate)
  // 获取项目的所有流程
  app.get<{ Querystring: { projectId: string } }>('/', async (request) => {
    const { projectId } = request.query
    const result = await db
      .select()
      .from(workflows)
      .where(and(
        eq(workflows.projectId, projectId),
        isNull(workflows.deletedAt)
      ))
      .orderBy(workflows.createdAt)
    return result
  })

  // 获取单个流程
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const result = await db
      .select()
      .from(workflows)
      .where(and(
        eq(workflows.id, id),
        isNull(workflows.deletedAt)
      ))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Workflow not found' })
    }
    return result[0]
  })

  // 创建流程
  app.post<{
    Body: {
      projectId: string
      templateId?: string
      name: string
      dsl: string
      templateParams?: Record<string, any>
    }
  }>('/', async (request, reply) => {
    const { projectId, templateId, name, dsl, templateParams } = request.body

    if (!name || name.trim().length === 0) {
      return reply.status(422).send({ error: 'Workflow name is required' })
    }
    if (!dsl || dsl.trim().length === 0) {
      return reply.status(422).send({ error: 'Workflow DSL is required' })
    }

    // 如果指定了模板，验证模板存在
    if (templateId) {
      const template = await db
        .select()
        .from(workflowTemplates)
        .where(eq(workflowTemplates.id, templateId))
      if (template.length === 0) {
        return reply.status(404).send({ error: 'Template not found' })
      }
    }

    const [workflow] = await db
      .insert(workflows)
      .values({
        projectId,
        templateId: templateId || null,
        name: name.trim(),
        dsl,
        templateParams: templateParams || null,
      })
      .returning()

    return reply.status(201).send(workflow)
  })

  // 更新流程
  app.put<{
    Params: { id: string }
    Body: {
      name?: string
      dsl?: string
      templateParams?: Record<string, any>
    }
  }>('/:id', async (request, reply) => {
    const { id } = request.params
    const { name, dsl, templateParams } = request.body

    const [updated] = await db
      .update(workflows)
      .set({
        ...(name !== undefined && { name }),
        ...(dsl !== undefined && { dsl }),
        ...(templateParams !== undefined && { templateParams }),
        updatedAt: new Date(),
      })
      .where(and(
        eq(workflows.id, id),
        isNull(workflows.deletedAt)
      ))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Workflow not found' })
    }
    return updated
  })

  // 删除流程（软删除）
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const [deleted] = await db
      .update(workflows)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(workflows.id, id),
        isNull(workflows.deletedAt)
      ))
      .returning()
    if (!deleted) {
      return reply.status(404).send({ error: 'Workflow not found' })
    }
    return { success: true }
  })

  // 校验 DSL
  app.post<{ Body: { dsl: string } }>('/validate', async (request) => {
    const { dsl } = request.body
    try {
      const { parse } = await import('yaml')
      const parsed = parse(dsl)

      const errors: string[] = []

      if (!parsed.name) errors.push('缺少 name 字段')
      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        errors.push('缺少 nodes 字段或格式不正确')
      } else {
        const nodeIds = new Set<string>()
        for (const node of parsed.nodes) {
          if (!node.id) errors.push('节点缺少 id')
          if (!node.type) errors.push(`节点 ${node.id || '?'} 缺少 type`)
          if (!node.name) errors.push(`节点 ${node.id || '?'} 缺少 name`)
          const validTypes = ['human_input', 'human_review', 'agent_task', 'parallel_group', 'integration']
          if (node.type && !validTypes.includes(node.type)) {
            errors.push(`节点 ${node.id} 的 type "${node.type}" 不合法`)
          }
          if (node.id) {
            if (nodeIds.has(node.id)) {
              errors.push(`节点 id "${node.id}" 重复`)
            }
            nodeIds.add(node.id)
          }
        }

        // 校验 edges
        if (parsed.edges && Array.isArray(parsed.edges)) {
          for (const edge of parsed.edges) {
            if (!edge.from) errors.push('边缺少 from')
            if (!edge.to) errors.push('边缺少 to')
            if (edge.from && !nodeIds.has(edge.from)) {
              errors.push(`边的 from "${edge.from}" 引用了不存在的节点`)
            }
            if (edge.to && !nodeIds.has(edge.to)) {
              errors.push(`边的 to "${edge.to}" 引用了不存在的节点`)
            }
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        parsed: errors.length === 0 ? parsed : undefined,
      }
    } catch (error) {
      return {
        valid: false,
        errors: [`YAML 解析失败: ${(error as Error).message}`],
      }
    }
  })
}
