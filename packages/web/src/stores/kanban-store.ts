import { create } from 'zustand'
import type { Kanban, KanbanColumn, Task } from '@/lib/types'

interface KanbanStore {
  kanban: Kanban | null
  columns: KanbanColumn[]
  tasks: Task[]
  setKanban: (kanban: Kanban | null) => void
  setColumns: (columns: KanbanColumn[]) => void
  setTasks: (tasks: Task[]) => void
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  moveTask: (taskId: string, columnId: string, position: number) => void
}

export const useKanbanStore = create<KanbanStore>((set) => ({
  kanban: null,
  columns: [],
  tasks: [],
  setKanban: (kanban) => set({ kanban }),
  setColumns: (columns) => set({ columns }),
  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),
  moveTask: (taskId, columnId, position) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, columnId, position } : t)),
    })),
}))
