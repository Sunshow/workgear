import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import { projectRoutes } from './routes/projects.js'
import { kanbanRoutes } from './routes/kanbans.js'
import { taskRoutes } from './routes/tasks.js'
import { healthRoutes } from './routes/health.js'
import { workflowTemplateRoutes } from './routes/workflow-templates.js'
import { workflowRoutes } from './routes/workflows.js'
import { flowRunRoutes } from './routes/flow-runs.js'
import { artifactRoutes } from './routes/artifacts.js'
import { nodeRunRoutes } from './routes/node-runs.js'
import { openspecRoutes } from './routes/openspec.js'
import { agentRoleRoutes } from './routes/agent-roles.js'
import { authRoutes } from './routes/auth.js'
import { wsGateway, startEventForwarding, stopEventForwarding } from './ws/gateway.js'

const PORT = parseInt(process.env.PORT || '4000', 10)
const HOST = process.env.HOST || '0.0.0.0'
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
})

// Plugins
await app.register(cors, { origin: true, credentials: true })
await app.register(cookie)
await app.register(jwt, { secret: JWT_SECRET })
await app.register(websocket)

// Routes
await app.register(healthRoutes, { prefix: '/api' })
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(projectRoutes, { prefix: '/api/projects' })
await app.register(kanbanRoutes, { prefix: '/api/kanbans' })
await app.register(taskRoutes, { prefix: '/api/tasks' })
await app.register(workflowTemplateRoutes, { prefix: '/api/workflow-templates' })
await app.register(workflowRoutes, { prefix: '/api/workflows' })
await app.register(flowRunRoutes, { prefix: '/api/flow-runs' })
await app.register(artifactRoutes, { prefix: '/api/artifacts' })
await app.register(nodeRunRoutes, { prefix: '/api/node-runs' })
await app.register(openspecRoutes, { prefix: '/api/projects/:projectId/openspec' })
await app.register(agentRoleRoutes, { prefix: '/api/agent-roles' })

// WebSocket
await app.register(wsGateway)

// Start
try {
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`WorkGear API Server running at http://${HOST}:${PORT}`)

  // Start forwarding Orchestrator events to WebSocket clients
  startEventForwarding(app.log)

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('Shutting down...')
    stopEventForwarding()
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
