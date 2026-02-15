import type { FastifyInstance } from 'fastify'
import { eq, or, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects, kanbans, kanbanColumns, projectMembers } from '../db/schema.js'
import { authenticate, optionalAuth, requireProjectAccess } from '../middleware/auth.js'

export async function projectRoutes(app: FastifyInstance) {
  // 脱敏 Token：仅显示前4位 + ***
  function maskToken(token: string | null): string | null {
    if (!token) return null
    if (token.length <= 4) return '****'
    return token.slice(0, 4) + '****'
  }

  function sanitizeProject(project: typeof projects.$inferSelect) {
    return { ...project, gitAccessToken: maskToken(project.gitAccessToken) }
  }

  // 获取所有项目（用户参与的 + public 项目）
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const userId = request.userId!

    // 查询用户参与的项目 ID
    const memberships = await db.select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId))

    const memberProjectIds = memberships.map(m => m.projectId)

    // 查询：用户参与的项目 OR public 项目 OR 用户是 owner
    const result = await db.select().from(projects)
      .where(
        or(
          eq(projects.visibility, 'public'),
          eq(projects.ownerId, userId),
          memberProjectIds.length > 0
            ? inArray(projects.id, memberProjectIds)
            : undefined
        )
      )
      .orderBy(projects.createdAt)

    return result.map(sanitizeProject)
  })

  // 获取所有公开项目（无需登录）
  app.get('/public', async () => {
    const result = await db.select().from(projects)
      .where(eq(projects.visibility, 'public'))
      .orderBy(projects.createdAt)
    return result.map(sanitizeProject)
  })

  // 获取单个项目
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [optionalAuth, requireProjectAccess()] },
    async (request, reply) => {
      const { id } = request.params
      const result = await db.select().from(projects).where(eq(projects.id, id))
      if (result.length === 0) {
        return reply.status(404).send({ error: 'Project not found' })
      }
      return sanitizeProject(result[0])
    }
  )

  // 创建项目（自动创建默认看板和列）
  app.post<{
    Body: { name: string; description?: string; gitRepoUrl?: string; gitAccessToken?: string; autoMergePr?: boolean; gitMergeMethod?: string; visibility?: string }
  }>('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { name, description, gitRepoUrl, gitAccessToken, autoMergePr, gitMergeMethod, visibility } = request.body
    const userId = request.userId!

    if (!name || name.trim().length === 0) {
      return reply.status(422).send({ error: 'Project name is required' })
    }

    // 创建项目
    const [project] = await db.insert(projects).values({
      name: name.trim(),
      description: description || null,
      gitRepoUrl: gitRepoUrl || null,
      gitAccessToken: gitAccessToken || null,
      autoMergePr: autoMergePr ?? false,
      gitMergeMethod: gitMergeMethod || 'merge',
      visibility: visibility === 'public' ? 'public' : 'private',
      ownerId: userId,
    }).returning()

    // 创建 owner 成员关系
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId,
      role: 'owner',
    })

    // 创建默认看板
    const [kanban] = await db.insert(kanbans).values({
      projectId: project.id,
      name: 'Default Board',
    }).returning()

    // 创建默认列
    const defaultColumns = ['Backlog', 'In Progress', 'Review', 'Done']
    await db.insert(kanbanColumns).values(
      defaultColumns.map((colName, idx) => ({
        kanbanId: kanban.id,
        name: colName,
        position: idx,
      }))
    )

    return reply.status(201).send(sanitizeProject(project))
  })

  // 更新项目
  app.put<{
    Params: { id: string }
    Body: { name?: string; description?: string; gitRepoUrl?: string; gitAccessToken?: string; autoMergePr?: boolean; gitMergeMethod?: string; visibility?: string }
  }>(
    '/:id',
    { preHandler: [authenticate, requireProjectAccess('owner')] },
    async (request, reply) => {
      const { id } = request.params
      const { name, description, gitRepoUrl, gitAccessToken, autoMergePr, gitMergeMethod, visibility } = request.body

      const [updated] = await db.update(projects)
        .set({
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(gitRepoUrl !== undefined && { gitRepoUrl }),
          ...(gitAccessToken !== undefined && { gitAccessToken }),
          ...(autoMergePr !== undefined && { autoMergePr }),
          ...(gitMergeMethod !== undefined && { gitMergeMethod }),
          ...(visibility !== undefined && { visibility }),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Project not found' })
      }
      return sanitizeProject(updated)
    }
  )

  // 删除项目
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authenticate, requireProjectAccess('owner')] },
    async (request, reply) => {
      const { id } = request.params
      const [deleted] = await db.delete(projects).where(eq(projects.id, id)).returning()
      if (!deleted) {
        return reply.status(404).send({ error: 'Project not found' })
      }
      return { success: true }
    }
  )
}
