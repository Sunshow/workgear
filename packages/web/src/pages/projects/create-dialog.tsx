import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '@/lib/api'
import type { CreateProjectDto, Project } from '@/lib/types'
import { useProjectStore } from '@/stores/project-store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function CreateProjectDialog({ open, onOpenChange, onSuccess }: CreateProjectDialogProps) {
  const { addProject } = useProjectStore()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateProjectDto>()

  async function onSubmit(data: CreateProjectDto) {
    setLoading(true)
    try {
      const project = await api.post('projects', { json: data }).json<Project>()
      addProject(project)
      reset()
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Failed to create project:', error)
      alert('创建项目失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>创建一个新的 WorkGear 项目</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">项目名称 *</Label>
              <Input
                id="name"
                placeholder="我的项目"
                {...register('name', { required: '项目名称不能为空' })}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                placeholder="项目描述（可选）"
                {...register('description')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitRepoUrl">Git 仓库地址</Label>
              <Input
                id="gitRepoUrl"
                placeholder="https://github.com/user/repo.git"
                {...register('gitRepoUrl')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gitAccessToken">Git Access Token</Label>
              <Input
                id="gitAccessToken"
                type="password"
                placeholder="ghp_xxxx 或 glpat-xxxx"
                {...register('gitAccessToken')}
              />
              <p className="text-xs text-muted-foreground">
                用于 Agent 自动提交代码，需要仓库写权限
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
