import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { tasks, timelineEvents } from '../db/schema.js'
import { authenticate } from '../middleware/auth.js'
import * as orchestrator from '../grpc/client.js'

export async function taskRoutes(app: FastifyInstance) {
  // 所有任务路由都需要登录
  app.addHook('preHandler', authenticate)
  // 获取项目的所有任务
  app.get<{ Querystring: { projectId: string } }>('/', async (request) => {
    const { projectId } = request.query
    const result = await db.select().from(tasks).where(eq(tasks.projectId, projectId))
    return result
  })

  // 获取单个任务
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const result = await db.select().from(tasks).where(eq(tasks.id, id))
    if (result.length === 0) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return result[0]
  })

  // 创建任务
  app.post<{
    Body: { projectId: string; columnId: string; title: string; description?: string }
  }>('/', async (request, reply) => {
    const { projectId, columnId, title, description } = request.body

    if (!title || title.trim().length === 0) {
      return reply.status(422).send({ error: 'Task title is required' })
    }

    // 获取当前列中最大 position
    const existing = await db.select()
      .from(tasks)
      .where(eq(tasks.columnId, columnId))
    const maxPosition = existing.reduce((max, t) => Math.max(max, t.position), -1)

    const [task] = await db.insert(tasks).values({
      projectId,
      columnId,
      title: title.trim(),
      description: description || null,
      position: maxPosition + 1,
    }).returning()

    return reply.status(201).send(task)
  })

  // 从产物创建任务（启动流程）
  app.post<{
    Body: {
      projectId: string
      columnId: string
      artifactId: string
      selectedStories?: Array<{ id: string; title: string; priority?: string; storyPoints?: number; content: string }>
      taskTitle: string
      flowType: 'simple' | 'full'
      artifactContent?: string
    }
  }>('/from-artifact', async (request, reply) => {
    const { projectId, columnId, artifactId, selectedStories, taskTitle, flowType, artifactContent } = request.body

    // 验证输入
    if (!taskTitle || taskTitle.trim().length === 0) {
      return reply.status(422).send({ error: 'Task title is required' })
    }
    if ((!selectedStories || selectedStories.length === 0) && !artifactContent) {
      return reply.status(422).send({ error: 'Either selectedStories or artifactContent must be provided' })
    }
    if (flowType !== 'simple' && flowType !== 'full') {
      return reply.status(422).send({ error: 'flowType must be "simple" or "full"' })
    }

    // 查找或创建 workflow
    const { workflows, workflowTemplates } = await import('../db/schema.js')
    const templateSlug = flowType === 'simple' ? 'simple-dev-from-artifact' : 'openspec-dev-from-artifact'
    
    const [template] = await db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.slug, templateSlug))
      .limit(1)

    if (!template) {
      return reply.status(404).send({ 
        error: `Workflow template "${templateSlug}" not found. Please run database seed.` 
      })
    }

    // 查找或创建该项目的 workflow
    let [workflow] = await db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.projectId, projectId),
          eq(workflows.templateId, template.id)
        )
      )
      .limit(1)

    if (!workflow) {
      // 自动创建 workflow
      [workflow] = await db.insert(workflows).values({
        projectId,
        templateId: template.id,
        name: template.name,
        dsl: template.template,
        templateParams: null,
      }).returning()
    }

    // 获取当前列中最大 position
    const existing = await db.select()
      .from(tasks)
      .where(eq(tasks.columnId, columnId))
    const maxPosition = existing.reduce((max, t) => Math.max(max, t.position), -1)

    // 构建 selected_stories 内容
    const storiesMarkdown = selectedStories && selectedStories.length > 0
      ? selectedStories.map(s => {
          const priorityText = s.priority ? ` (${s.priority}${s.storyPoints ? `, ${s.storyPoints}SP` : ''})` : ''
          return `#### ${s.id}: ${s.title}${priorityText}\n\n${s.content}`
        }).join('\n\n')
      : artifactContent!

    const storiesCount = selectedStories && selectedStories.length > 0 ? selectedStories.length : 0

    // 创建任务
    const [task] = await db.insert(tasks).values({
      projectId,
      columnId,
      title: taskTitle.trim(),
      description: `从产物创建：${storiesCount > 0 ? `${storiesCount} 个 User Stories` : '完整产物内容'}`,
      position: maxPosition + 1,
    }).returning()

    // 创建 flow_run
    const { flowRuns } = await import('../db/schema.js')
    const [flowRun] = await db.insert(flowRuns).values({
      taskId: task.id,
      workflowId: workflow.id,
      status: 'pending',
      dslSnapshot: workflow.dsl,
      variables: {
        project_id: projectId,
        selected_stories: storiesMarkdown,
      },
    }).returning()

    // 调用 orchestrator 启动流程
    try {
      const result = await orchestrator.startFlow(
        flowRun.id,
        workflow.dsl,
        {
          project_id: projectId,
          selected_stories: storiesMarkdown,
        },
        task.id,
        workflow.id
      )

      if (!result.success) {
        // 启动失败，更新 flow_run 状态
        await db.update(flowRuns).set({ 
          status: 'failed', 
          error: result.error || 'Failed to start flow' 
        }).where(eq(flowRuns.id, flowRun.id))
        
        return reply.status(500).send({ error: result.error || 'Failed to start workflow' })
      }
    } catch (error: any) {
      app.log.error('Failed to start flow:', error)
      
      // 更新 flow_run 状态为 failed
      await db.update(flowRuns).set({ 
        status: 'failed', 
        error: error.message || 'Failed to communicate with orchestrator' 
      }).where(eq(flowRuns.id, flowRun.id))
      
      return reply.status(500).send({ 
        error: error.message || 'Failed to start workflow' 
      })
    }

    // 记录 timeline 事件
    await db.insert(timelineEvents).values({
      taskId: task.id,
      flowRunId: flowRun.id,
      eventType: 'flow_started',
      content: {
        workflow_name: workflow.name,
        flow_type: flowType,
        stories_count: storiesCount,
        artifact_id: artifactId,
      },
    })

    return reply.status(201).send({
      task,
      flowRunId: flowRun.id,
    })
  })

  // 更新任务
  app.put<{
    Params: { id: string }
    Body: { title?: string; description?: string; columnId?: string; position?: number; gitBranch?: string }
  }>('/:id', async (request, reply) => {
    const { id } = request.params
    const { title, description, columnId, position, gitBranch } = request.body

    const [updated] = await db.update(tasks)
      .set({
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(columnId !== undefined && { columnId }),
        ...(position !== undefined && { position }),
        ...(gitBranch !== undefined && { gitBranch }),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return updated
  })

  // 删除任务
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params
    const [deleted] = await db.delete(tasks).where(eq(tasks.id, id)).returning()
    if (!deleted) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    return { success: true }
  })

  // 移动任务（跨列或列内排序）
  app.put<{
    Params: { id: string }
    Body: { columnId: string; position: number }
  }>('/:id/move', async (request, reply) => {
    const { id } = request.params
    const { columnId, position } = request.body

    // 更新任务的列和位置
    const [updated] = await db.update(tasks)
      .set({
        columnId,
        position,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Task not found' })
    }

    return updated
  })

  // 获取任务时间线
  app.get<{ Params: { id: string } }>('/:id/timeline', async (request) => {
    const { id } = request.params
    const events = await db.select()
      .from(timelineEvents)
      .where(eq(timelineEvents.taskId, id))
      .orderBy(timelineEvents.createdAt)
    return events
  })
}
