import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import ky from 'ky'
import { useAuthStore } from '@/stores/auth-store'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, initialized, setAuth, setInitialized, logout } = useAuthStore()
  const [checking, setChecking] = useState(!initialized)

  useEffect(() => {
    if (initialized) return

    // 尝试用 refresh token 恢复会话
    ky.post('/api/auth/refresh', { credentials: 'include' })
      .json<{ accessToken: string; user: any }>()
      .then((res) => {
        setAuth(res.user, res.accessToken)
      })
      .catch(() => {
        logout()
      })
      .finally(() => {
        setInitialized(true)
        setChecking(false)
      })
  }, [initialized])

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
