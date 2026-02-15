import type { FastifyInstance } from 'fastify'
import { AGENT_TYPES } from '../agent-types.js'

export async function agentTypeRoutes(app: FastifyInstance) {
  // 获取所有 Agent 类型定义（只读）
  app.get('/', async () => {
    return AGENT_TYPES
  })
}
