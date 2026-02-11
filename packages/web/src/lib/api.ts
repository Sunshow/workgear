import ky from 'ky'

export const api = ky.create({
  prefixUrl: '/api',
  timeout: 30000,
  retry: {
    limit: 2,
    methods: ['get'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504],
  },
  hooks: {
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
