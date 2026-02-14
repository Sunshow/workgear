import type { FastifyRequest, FastifyReply } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects, projectMembers } from '../db/schema.js'

// Extend Fastify request with user info
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string
    userEmail?: string
  }
}

// JWT payload type
interface JwtPayload {
  sub: string
  email: string
}

/**
 * authenticate — 必须登录，解析 JWT 并挂载 request.userId / request.userEmail
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const decoded = await request.jwtVerify<JwtPayload>()
    request.userId = decoded.sub
    request.userEmail = decoded.email
  } catch {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}

/**
 * optionalAuth — 可选登录，有 token 就解析，没有也放行
 */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const decoded = await request.jwtVerify<JwtPayload>()
      request.userId = decoded.sub
      request.userEmail = decoded.email
    }
  } catch {
    // Token 无效时静默忽略，当作未登录
  }
}

/**
 * requireProjectAccess — 检查用户是否有权访问该项目
 * 
 * 逻辑：
 * 1. 从 request.params 中取 projectId（或 id）
 * 2. 查询项目 visibility
 * 3. 如果 public 且是 GET 请求 → 放行（只读）
 * 4. 如果用户已登录 → 检查是否为项目成员
 * 5. 可选 requiredRole 参数限制最低角色
 */
export function requireProjectAccess(requiredRole?: 'owner' | 'admin' | 'member') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>
    const projectId = params.projectId || params.id

    if (!projectId) {
      return reply.status(400).send({ error: 'Project ID is required' })
    }

    // 查询项目
    const [project] = await db.select({
      id: projects.id,
      visibility: projects.visibility,
      ownerId: projects.ownerId,
    }).from(projects).where(eq(projects.id, projectId))

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' })
    }

    // Public 项目 + GET 请求 → 允许匿名只读访问
    if (project.visibility === 'public' && request.method === 'GET') {
      return
    }

    // 非 public 或非 GET → 必须登录
    if (!request.userId) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // 查询成员关系
    const [membership] = await db.select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, request.userId)
        )
      )

    // 项目 owner 始终有权限（兼容 ownerId 字段）
    const isOwner = project.ownerId === request.userId
    
    if (!membership && !isOwner) {
      return reply.status(403).send({ error: 'Forbidden: not a project member' })
    }

    // 角色检查
    if (requiredRole) {
      const roleHierarchy: Record<string, number> = { owner: 3, admin: 2, member: 1 }
      const userRole = isOwner ? 'owner' : (membership?.role || 'member')
      const userLevel = roleHierarchy[userRole] || 0
      const requiredLevel = roleHierarchy[requiredRole] || 0

      if (userLevel < requiredLevel) {
        return reply.status(403).send({ error: `Forbidden: requires ${requiredRole} role` })
      }
    }
  }
}
