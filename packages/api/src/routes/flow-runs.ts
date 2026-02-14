import type { FastifyInstance } from 'fastify'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { flowRuns, nodeRuns, tasks, workflows, timelineEvents } from '../db/schema.js'
import { parse } from 'yaml'
import * as orchestrator from '../grpc/client.js'
import { authenticate } from '../middleware/auth.js'

export async function flowRunRoutes(app: FastifyInstance) {
  // 所有流程执行路由都需要登录
  app.addHook('preHandler', authenticate)
  // 创建 FlowRun（启动流程）
  app.post<{
    Body: {
      taskId: string
      workflowId: string
    }
  }>('/', async (request, reply) => {
    const { taskId, workflowId } = request.body

    // 1. 校验 task 和 workflow 存在
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId))
    if (!workflow) {
      return reply.status(404).send({ error: 'Workflow not found' })
    }

    // 2. 解析 workflow.dsl，提取 nodes 列表
    let parsedDsl: any
    try {
      parsedDsl = parse(workflow.dsl)
    } catch (error) {
      return reply.status(422).send({ error: 'Invalid workflow DSL' })
    }

    if (!parsedDsl.nodes || !Array.isArray(parsedDsl.nodes)) {
      return reply.status(422).send({ error: 'Workflow DSL missing nodes' })
    }

    // 3. 创建 flow_runs 记录
    const [flowRun] = await db
      .insert(flowRuns)
      .values({
        taskId,
        workflowId,
        status: 'pending',
      })
      .returning()

    // 4. 调用 Orchestrator 启动流程
    try {
      const result = await orchestrator.startFlow(
        flowRun.id,
        workflow.dsl,
        workflow.templateParams as Record<string, string> || {},
        taskId,
        workflowId
      )

      if (!result.success) {
        // 启动失败，更新状态
        await db.update(flowRuns).set({ status: 'failed', error: result.error }).where(eq(flowRuns.id, flowRun.id))
        return reply.status(500).send({ error: result.error || 'Failed to start flow' })
      }
    } catch (error: any) {
      app.log.error(error)
      await db.update(flowRuns).set({ status: 'failed', error: error.message }).where(eq(flowRuns.id, flowRun.id))
      return reply.status(500).send({ error: error.message || 'Failed to communicate with orchestrator' })
    }

    // 5. 写入 timeline_events
    await db.insert(timelineEvents).values({
      taskId,
      flowRunId: flowRun.id,
      eventType: 'system_event',
      content: {
        message: `流程已创建：${workflow.name}`,
        workflowName: workflow.name,
      },
    })

    return reply.status(201).send({ flowRun })
  })

  // 查询 Task 关联的所有 FlowRun
  app.get<{ Querystring: { taskId: string } }>('/', async (request, reply) => {
    const { taskId } = request.query

    if (!taskId) {
      return reply.status(422).send({ error: 'taskId is required' })
    }

    const result = await db
      .select()
      .from(flowRuns)
      .where(eq(flowRuns.taskId, taskId))
      .orderBy(desc(flowRuns.createdAt))

    return result
  })

  // 获取单个 FlowRun 详情
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params

    const [flowRun] = await db.select().from(flowRuns).where(eq(flowRuns.id, id))

    if (!flowRun) {
      return reply.status(404).send({ error: 'FlowRun not found' })
    }

    return flowRun
  })

  // 获取 FlowRun 的所有 NodeRun
  app.get<{ Params: { id: string } }>('/:id/nodes', async (request) => {
    const { id } = request.params

    const result = await db
      .select()
      .from(nodeRuns)
      .where(eq(nodeRuns.flowRunId, id))
      .orderBy(nodeRuns.createdAt)

    return result
  })

  // 取消流程
  app.put<{ Params: { id: string } }>('/:id/cancel', async (request, reply) => {
    const { id } = request.params

    const [flowRun] = await db.select().from(flowRuns).where(eq(flowRuns.id, id))

    if (!flowRun) {
      return reply.status(404).send({ error: 'FlowRun not found' })
    }

    if (flowRun.status === 'completed' || flowRun.status === 'cancelled') {
      return reply.status(422).send({ error: 'Cannot cancel completed or already cancelled flow' })
    }

    // 调用 Orchestrator 取消流程
    try {
      const result = await orchestrator.cancelFlow(id)
      if (!result.success) {
        return reply.status(500).send({ error: result.error || 'Failed to cancel flow' })
      }
    } catch (error: any) {
      app.log.error(error)
      return reply.status(500).send({ error: error.message || 'Failed to communicate with orchestrator' })
    }

    // 重新查询更新后的状态
    const [updated] = await db.select().from(flowRuns).where(eq(flowRuns.id, id))
    return updated
  })
}
