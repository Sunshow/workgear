import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import type { KanbanColumn, Task } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { TaskCard } from './task-card'
import { cn } from '@/lib/utils'

interface KanbanColumnProps {
  column: KanbanColumn
  tasks: Task[]
  onCreateTask: () => void
  onTaskClick?: (task: Task) => void
}

export function KanbanColumnComponent({ column, tasks, onCreateTask, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
  })

  return (
    <div className="flex w-80 flex-shrink-0 flex-col rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b bg-background p-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{column.name}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{tasks.length}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onCreateTask}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 space-y-2 overflow-y-auto p-3',
          isOver && 'bg-accent/50'
        )}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick?.(task)} />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}
