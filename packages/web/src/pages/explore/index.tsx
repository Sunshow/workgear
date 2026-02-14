import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Globe } from 'lucide-react'
import { api } from '@/lib/api'
import type { Project } from '@/lib/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ExplorePage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPublicProjects()
  }, [])

  async function loadPublicProjects() {
    try {
      const data = await api.get('projects/public').json<Project[]>()
      setProjects(data)
    } catch (error) {
      console.error('Failed to load public projects:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">探索公开项目</h1>
          <p className="text-muted-foreground">浏览社区公开的 WorkGear 项目</p>
        </div>

        {projects.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Globe className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">暂无公开项目</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(`/projects/${project.id}/kanban`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        {project.name}
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      </CardTitle>
                      {project.description && (
                        <CardDescription className="mt-2">{project.description}</CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {project.gitRepoUrl && (
                  <CardContent>
                    <p className="truncate text-sm text-muted-foreground">{project.gitRepoUrl}</p>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
