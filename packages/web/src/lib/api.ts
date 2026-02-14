import ky from 'ky'
import { useAuthStore } from '@/stores/auth-store'

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await ky.post('/api/auth/refresh', { credentials: 'include' }).json<{
      accessToken: string
      user: { id: string; email: string; name: string; avatarUrl: string | null; createdAt: string }
    }>()
    useAuthStore.getState().setAuth(res.user, res.accessToken)
    return res.accessToken
  } catch {
    useAuthStore.getState().logout()
    return null
  }
}

export const api = ky.create({
  prefixUrl: '/api',
  timeout: 30000,
  credentials: 'include',
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().accessToken
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [
      async (request, _options, response) => {
        if (response.status === 401 && !request.url.includes('/api/auth/')) {
          // 避免并发刷新
          if (!refreshPromise) {
            refreshPromise = refreshAccessToken().finally(() => {
              refreshPromise = null
            })
          }

          const newToken = await refreshPromise
          if (newToken) {
            request.headers.set('Authorization', `Bearer ${newToken}`)
            return ky(request)
          }
        }
        return response
      },
    ],
    beforeError: [
      async (error) => {
        const { response } = error
        if (response) {
          try {
            const body = await response.json() as Record<string, string>
            error.message = body.error || body.message || error.message
          } catch {
            // Ignore JSON parse errors
          }
        }
        return error
      },
    ],
  },
})
