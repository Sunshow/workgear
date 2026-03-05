import type { FastifyInstance } from 'fastify'
import { eq, desc, and, max } from 'drizzle-orm'
import { db } from '../db/index.js'
import { artifacts, artifactVersions, artifactLinks } from '../db/schema.js'
import { authenticate } from '../middleware/auth.js'

export async function artifactRoutes(app: FastifyInstance) {
  // 所有产物路由都需要登录
  app.addHook('preHandler', authenticate)
  
  // 查询产物（支持 taskId / flowRunId / nodeRunId / projectId）
  app.get<{ Querystring: { taskId?: string; flowRunId?: string; nodeRunId?: string; projectId?: string; type?: string } }>('/', async (request, reply) => {
    const { taskId, flowRunId, nodeRunId, projectId, type } = request.query

    if (!taskId && !flowRunId && !nodeRunId && !projectId) {
      return reply.status(422).send({ error: 'taskId, flowRunId, nodeRunId, or projectId is required' })
    }

    if (projectId) {
      // Query by projectId: join with tasks table
      const { tasks } = await import('../db/schema.js')
      const result = await db
        .select({
          id: artifacts.id,
          taskId: artifacts.taskId,
          type: artifacts.type,
          title: artifacts.title,
          filePath: artifacts.filePath,
          flowRunId: artifacts.flowRunId,
          nodeRunId: artifacts.nodeRunId,
          createdAt: artifacts.createdAt,
        })
        .from(artifacts)
        .innerJoin(tasks, eq(artifacts.taskId, tasks.id))
        .where(eq(tasks.projectId, projectId))
        .orderBy(desc(artifacts.createdAt))
      
      // Filter by type if specified
      if (type) {
        return result.filter(a => a.type === type)
      }
      return result
    }

    // Query by taskId / flowRunId / nodeRunId
    if (nodeRunId) {
      const result = await db.select().from(artifacts).where(eq(artifacts.nodeRunId, nodeRunId)).orderBy(desc(artifacts.createdAt))
      if (type) {
        return result.filter(a => a.type === type)
      }
      return result
    }
    
    if (flowRunId) {
      const result = await db.select().from(artifacts).where(eq(artifacts.flowRunId, flowRunId)).orderBy(desc(artifacts.createdAt))
      if (type) {
        return result.filter(a => a.type === type)
      }
      return result
    }
    
    if (taskId) {
      const result = await db.select().from(artifacts).where(eq(artifacts.taskId, taskId)).orderBy(desc(artifacts.createdAt))
      if (type) {
        return result.filter(a => a.type === type)
      }
      return result
    }

    return []
  })

  // 获取单个产物
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params

    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id))

    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' })
    }

    return artifact
  })

  // 获取产物版本历史
  app.get<{ Params: { id: string } }>('/:id/versions', async (request) => {
    const { id } = request.params

    const result = await db
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, id))
      .orderBy(desc(artifactVersions.version))

    return result
  })

  // 获取产物引用关系
  app.get<{ Params: { id: string } }>('/:id/links', async (request) => {
    const { id } = request.params

    const result = await db
      .select()
      .from(artifactLinks)
      .where(eq(artifactLinks.sourceId, id))

    return result
  })

  // 获取产物版本内容
  app.get<{ Params: { id: string; versionId: string } }>(
    '/:id/versions/:versionId/content',
    async (request, reply) => {
      const { id, versionId } = request.params

      const [version] = await db
        .select({ content: artifactVersions.content })
        .from(artifactVersions)
        .where(
          and(
            eq(artifactVersions.id, versionId),
            eq(artifactVersions.artifactId, id)
          )
        )

      if (!version) {
        return reply.status(404).send({ error: 'Version not found' })
      }

      return { content: version.content || '' }
    }
  )

  // 获取产物最新版本内容
  app.get<{ Params: { id: string } }>('/:id/latest-content', async (request, reply) => {
    const { id } = request.params

    const [version] = await db
      .select({ content: artifactVersions.content })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, id))
      .orderBy(desc(artifactVersions.version))
      .limit(1)

    if (!version) {
      return reply.status(404).send({ error: 'No versions found' })
    }

    return { content: version.content || '' }
  })

  // 创建产物新版本
  app.post<{
    Params: { id: string }
    Body: { content: string; changeSummary?: string }
  }>('/:id/versions', async (request, reply) => {
    const { id } = request.params
    const { content, changeSummary } = request.body

    if (!content) {
      return reply.status(422).send({ error: 'content is required' })
    }

    // 检查产物是否存在
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id))
    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' })
    }

    // 获取当前最大版本号
    const [maxResult] = await db
      .select({ maxVersion: max(artifactVersions.version) })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, id))

    const nextVersion = (maxResult?.maxVersion ?? 0) + 1

    // 创建新版本
    const [newVersion] = await db
      .insert(artifactVersions)
      .values({
        artifactId: id,
        version: nextVersion,
        content,
        changeSummary: changeSummary || null,
        createdBy: 'human',
      })
      .returning()

    return reply.status(201).send(newVersion)
  })
}
