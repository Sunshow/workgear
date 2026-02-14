import type { FastifyInstance } from 'fastify'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { artifacts, artifactVersions, artifactLinks } from '../db/schema.js'
import { authenticate } from '../middleware/auth.js'

export async function artifactRoutes(app: FastifyInstance) {
  // 所有产物路由都需要登录
  app.addHook('preHandler', authenticate)
  // 查询 Task 关联的产物
  app.get<{ Querystring: { taskId: string } }>('/', async (request, reply) => {
    const { taskId } = request.query

    if (!taskId) {
      return reply.status(422).send({ error: 'taskId is required' })
    }

    const result = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.taskId, taskId))
      .orderBy(desc(artifacts.createdAt))

    return result
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
      const { versionId } = request.params

      const [version] = await db
        .select({ content: artifactVersions.content })
        .from(artifactVersions)
        .where(eq(artifactVersions.id, versionId))

      if (!version) {
        return reply.status(404).send({ error: 'Version not found' })
      }

      return { content: version.content || '' }
    }
  )
}
