import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { DndContext, DragEndEvent, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { api } from '@/lib/api'
import type { Board, BoardColumn, Task, Project } from '@/lib/types'
import { useBoardStore } from '@/stores/board-store'
import { BoardColumnComponent } from './board-column'
import { CreateTaskDialog } from './create-task-dialog'
import { TaskCard } from './task-card'
import { TaskDetail } from './task-detail'

export function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { board, columns, tasks, setBoard, setColumns, setTasks, moveTask } = useBoardStore()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [createTaskDialogOpen, setCreateTaskDialogOpen] = useState(false)
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  useEffect(() => {
    if (projectId) {
      loadBoardData()
    }
  }, [projectId])

  async function loadBoardData() {
    try {
      // Load project
      const projectData = await api.get(`projects/${projectId}`).json<Project>()
      setProject(projectData)

      // Load boards
      const boardsData = await api.get('boards', { searchParams: { projectId: projectId! } }).json<Board[]>()
      if (boardsData.length > 0) {
        const boardData = boardsData[0]
        setBoard(boardData)

        // Load columns
        const columnsData = await api.get(`boards/${boardData.id}/columns`).json<{ board: Board; columns: BoardColumn[] }>()
        setColumns(columnsData.columns)

        // Load tasks
        const tasksData = await api.get('tasks', { searchParams: { projectId: projectId! } }).json<Task[]>()
        setTasks(tasksData)
      }
    } catch (error) {
      console.error('Failed to load board data:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleTaskClick(task: Task) {
    setSelectedTask(task)
    setDetailOpen(true)
  }

  function handleCreateTask(columnId: string) {
    setSelectedColumnId(columnId)
    setCreateTaskDialogOpen(true)
  }

  function handleDragStart(event: DragEndEvent) {
    const { active } = event
    const task = tasks.find(t => t.id === active.id)
    if (task) {
      setActiveTask(task)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    const activeTask = tasks.find(t => t.id === active.id)
    if (!activeTask) return

    const overId = over.id as string
    
    // Check if dropped over a column or a task
    const overColumn = columns.find(c => c.id === overId)
    const overTask = tasks.find(t => t.id === overId)
    
    const targetColumnId = overColumn ? overColumn.id : overTask?.columnId
    if (!targetColumnId) return

    const targetColumnTasks = tasks.filter(t => t.columnId === targetColumnId)
    const activeIndex = targetColumnTasks.findIndex(t => t.id === active.id)
    const overIndex = overTask ? targetColumnTasks.findIndex(t => t.id === overId) : targetColumnTasks.length

    let newPosition: number

    if (activeTask.columnId === targetColumnId) {
      // Same column - reorder
      if (activeIndex === overIndex) return
      
      const reordered = arrayMove(targetColumnTasks, activeIndex, overIndex)
      newPosition = overIndex
      
      // Optimistic update
      const updatedTasks = tasks.map(t => {
        if (t.columnId !== targetColumnId) return t
        const idx = reordered.findIndex(rt => rt.id === t.id)
        return { ...t, position: idx }
      })
      setTasks(updatedTasks)
    } else {
      // Different column - move
      newPosition = overTask ? overIndex : targetColumnTasks.length
      
      // Optimistic update
      moveTask(activeTask.id, targetColumnId, newPosition)
    }

    // API call
    try {
      await api.put(`tasks/${activeTask.id}/move`, {
        json: {
          columnId: targetColumnId,
          position: newPosition,
        },
      })
    } catch (error) {
      console.error('Failed to move task:', error)
      // Revert on error
      loadBoardData()
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  if (!board || columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">看板数据加载失败</p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col">
        <div className="border-b bg-background px-6 py-4">
          <h1 className="text-2xl font-bold">{project?.name}</h1>
          <p className="text-sm text-muted-foreground">{project?.description || '项目看板'}</p>
        </div>

        <div className="flex flex-1 gap-4 overflow-x-auto p-6">
          {columns.map((column) => {
            const columnTasks = tasks
              .filter((task) => task.columnId === column.id)
              .sort((a, b) => a.position - b.position)
            return (
              <BoardColumnComponent
                key={column.id}
                column={column}
                tasks={columnTasks}
                onCreateTask={() => handleCreateTask(column.id)}
                onTaskClick={handleTaskClick}
              />
            )
          })}
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} /> : null}
        </DragOverlay>
      </div>

      {selectedColumnId && (
        <CreateTaskDialog
          open={createTaskDialogOpen}
          onOpenChange={setCreateTaskDialogOpen}
          projectId={projectId!}
          columnId={selectedColumnId}
          onSuccess={loadBoardData}
        />
      )}

      <TaskDetail
        task={selectedTask}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDeleted={loadBoardData}
      />
    </DndContext>
  )
}
