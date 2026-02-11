import { create } from 'zustand'
import type { Board, BoardColumn, Task } from '@/lib/types'

interface BoardStore {
  board: Board | null
  columns: BoardColumn[]
  tasks: Task[]
  setBoard: (board: Board | null) => void
  setColumns: (columns: BoardColumn[]) => void
  setTasks: (tasks: Task[]) => void
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  moveTask: (taskId: string, columnId: string, position: number) => void
}

export const useBoardStore = create<BoardStore>((set) => ({
  board: null,
  columns: [],
  tasks: [],
  setBoard: (board) => set({ board }),
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
