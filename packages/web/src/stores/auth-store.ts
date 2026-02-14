import { create } from 'zustand'

export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  createdAt: string
}

interface AuthStore {
  user: User | null
  accessToken: string | null
  initialized: boolean
  setAuth: (user: User, accessToken: string) => void
  setAccessToken: (token: string) => void
  logout: () => void
  setInitialized: (v: boolean) => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  accessToken: null,
  initialized: false,
  setAuth: (user, accessToken) => set({ user, accessToken }),
  setAccessToken: (accessToken) => set({ accessToken }),
  logout: () => set({ user: null, accessToken: null }),
  setInitialized: (initialized) => set({ initialized }),
}))
