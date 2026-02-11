import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { projectRoutes } from './routes/projects.js'
import { boardRoutes } from './routes/boards.js'
import { taskRoutes } from './routes/tasks.js'
import { healthRoutes } from './routes/health.js'
import { workflowTemplateRoutes } from './routes/workflow-templates.js'
import { workflowRoutes } from './routes/workflows.js'
import { flowRunRoutes } from './routes/flow-runs.js'
import { artifactRoutes } from './routes/artifacts.js'
import { nodeRunRoutes } from './routes/node-runs.js'
import { wsGateway, startEventForwarding } from './ws/gateway.js'

const PORT = parseInt(process.env.PORT || '4000', 10)
const HOST = process.env.HOST || '0.0.0.0'

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
await app.register(cors, { origin: true })
await app.register(websocket)

// Routes
await app.register(healthRoutes, { prefix: '/api' })
await app.register(projectRoutes, { prefix: '/api/projects' })
await app.register(boardRoutes, { prefix: '/api/boards' })
await app.register(taskRoutes, { prefix: '/api/tasks' })
await app.register(workflowTemplateRoutes, { prefix: '/api/workflow-templates' })
await app.register(workflowRoutes, { prefix: '/api/workflows' })
await app.register(flowRunRoutes, { prefix: '/api/flow-runs' })
await app.register(artifactRoutes, { prefix: '/api/artifacts' })
await app.register(nodeRunRoutes, { prefix: '/api/node-runs' })

// WebSocket
await app.register(wsGateway)

// Start
try {
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`WorkGear API Server running at http://${HOST}:${PORT}`)

  // Start forwarding Orchestrator events to WebSocket clients
  startEventForwarding(app.log)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
