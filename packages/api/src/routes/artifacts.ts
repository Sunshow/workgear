import type { FastifyInstance } from 'fastify'
import { eq, desc, and, max, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { artifacts, artifactVersions, artifactLinks } from '../db/schema.js'
import { authenticate } from '../middleware/auth.js'

export async function artifactRoutes(app: FastifyInstance) {
  // 所有产物路由都需要登录
  app.addHook('preHandler', authenticate)
  // 查询产物（支持 taskId / flowRunId / nodeRunId）
  app.get<{ Querystring: { taskId?: string; flowRunId?: string; nodeRunId?: string; types?: string; includeVersions?: string } }>('/', async (request, reply) => {
    const { taskId, flowRunId, nodeRunId, types, includeVersions } = request.query

    if (!taskId && !flowRunId && !nodeRunId) {
      return reply.status(422).send({ error: 'taskId, flowRunId, or nodeRunId is required' })
    }

    // 解析 types 参数
    const typesParam = types as string | undefined
    const allowedTypes = typesParam ? typesParam.split(',').map(t => t.trim()).filter(Boolean) : undefined

    // 构建基础查询
    let query = db.select({
      id: artifacts.id,
      taskId: artifacts.taskId,
      flowRunId: artifacts.flowRunId,
      nodeRunId: artifacts.nodeRunId,
      type: artifacts.type,
      title: artifacts.title,
      content: artifacts.content,
      createdAt: artifacts.createdAt,
      createdBy: artifacts.createdBy,
    }).from(artifacts)

    // 添加过滤条件
    if (nodeRunId) {
      query = query.where(eq(artifacts.nodeRunId, nodeRunId))
    } else if (flowRunId) {
      query = query.where(eq(artifacts.flowRunId, flowRunId))
    } else {
      query = query.where(eq(artifacts.taskId, taskId!))
    }

    // 添加类型过滤
    if (allowedTypes && allowedTypes.length > 0) {
      query = query.where(inArray(artifacts.type, allowedTypes))
    }

    // 按创建时间降序排列
    query = query.orderBy(desc(artifacts.createdAt))

    const result = await query

    // 如果需要包含版本信息
    if (includeVersions === 'true' && result.length > 0) {
      const artifactIds = result.map(a => a.id)
      const versions = await db
        .select()
        .from(artifactVersions)
        .where(inArray(artifactVersions.artifactId, artifactIds))
        .orderBy(desc(artifactVersions.version))

      // 为每个产物附加最新版本信息
      const enrichedResult = result.map(artifact => {
        const latestVersion = versions.find(v => v.artifactId === artifact.id)
        return {
          ...artifact,
          latestVersion: latestVersion ? {
            version: latestVersion.version,
            changeSummary: latestVersion.changeSummary,
            createdAt: latestVersion.createdAt,
          } : null
        }
      })

      return enrichedResult
    }

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
