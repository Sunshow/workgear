import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { randomUUID, createHash } from 'node:crypto'
import bcrypt from 'bcrypt'
import { db } from '../db/index.js'
import { users, refreshTokens } from '../db/schema.js'
import { authenticate } from '../middleware/auth.js'

const SALT_ROUNDS = 12
const REFRESH_TOKEN_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '7', 10)
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function authRoutes(app: FastifyInstance) {
  // 注册
  app.post<{
    Body: { email: string; password: string; name: string }
  }>('/register', async (request, reply) => {
    const { email, password, name } = request.body

    if (!email || !password || !name) {
      return reply.status(422).send({ error: 'Email, password and name are required' })
    }

    if (password.length < 8) {
      return reply.status(422).send({ error: 'Password must be at least 8 characters' })
    }

    // 检查邮箱是否已注册
    const [existing] = await db.select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))

    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' })
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

    const [user] = await db.insert(users).values({
      email: email.toLowerCase().trim(),
      name: name.trim(),
      passwordHash,
    }).returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    })

    // 签发 tokens
    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: JWT_EXPIRES_IN }
    )

    const refreshToken = randomUUID()
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    })

    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
    })

    return reply.status(201).send({ accessToken, user })
  })

  // 登录
  app.post<{
    Body: { email: string; password: string }
  }>('/login', async (request, reply) => {
    const { email, password } = request.body

    if (!email || !password) {
      return reply.status(422).send({ error: 'Email and password are required' })
    }

    const [user] = await db.select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))

    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: JWT_EXPIRES_IN }
    )

    const refreshToken = randomUUID()
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    })

    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
    })

    const { passwordHash: _, ...safeUser } = user
    return { accessToken, user: safeUser }
  })

  // 刷新 token
  app.post('/refresh', async (request, reply) => {
    const token = request.cookies.refreshToken
    if (!token) {
      return reply.status(401).send({ error: 'No refresh token' })
    }

    const tokenHash = hashToken(token)

    // 查找并验证 refresh token
    const [stored] = await db.select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))

    if (!stored || stored.expiresAt < new Date()) {
      // 清除无效 cookie
      reply.clearCookie('refreshToken', { path: '/api/auth' })
      return reply.status(401).send({ error: 'Invalid or expired refresh token' })
    }

    // 令牌轮换：删除旧 token
    await db.delete(refreshTokens).where(eq(refreshTokens.id, stored.id))

    // 查找用户
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, stored.userId))

    if (!user) {
      reply.clearCookie('refreshToken', { path: '/api/auth' })
      return reply.status(401).send({ error: 'User not found' })
    }

    // 签发新 tokens
    const accessToken = app.jwt.sign(
      { sub: user.id, email: user.email },
      { expiresIn: JWT_EXPIRES_IN }
    )

    const newRefreshToken = randomUUID()
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt,
    })

    reply.setCookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60,
    })

    return { accessToken, user }
  })

  // 登出
  app.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const token = request.cookies.refreshToken
    if (token) {
      const tokenHash = hashToken(token)
      await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash))
    }

    reply.clearCookie('refreshToken', { path: '/api/auth' })
    return { success: true }
  })

  // 获取当前用户
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, request.userId!))

    if (!user) {
      return reply.status(404).send({ error: 'User not found' })
    }

    return user
  })
}
