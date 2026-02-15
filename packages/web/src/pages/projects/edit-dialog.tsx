import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '@/lib/api'
import type { Project, GitMergeMethod } from '@/lib/types'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface EditProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  onSuccess?: () => void
}

interface EditProjectForm {
  name: string
  description: string
  gitRepoUrl: string
  gitAccessToken: string
  autoMergePr: boolean
  gitMergeMethod: GitMergeMethod
  visibility: 'private' | 'public'
}

export function EditProjectDialog({ open, onOpenChange, project, onSuccess }: EditProjectDialogProps) {
  const { updateProject } = useProjectStore()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<EditProjectForm>()

  const visibility = watch('visibility')
  const autoMergePr = watch('autoMergePr')
  const gitMergeMethod = watch('gitMergeMethod')

  useEffect(() => {
    if (open) {
      reset({
        name: project.name,
        description: project.description || '',
        gitRepoUrl: project.gitRepoUrl || '',
        gitAccessToken: '',
        autoMergePr: project.autoMergePr,
        gitMergeMethod: project.gitMergeMethod || 'merge',
        visibility: project.visibility,
      })
    }
  }, [open, project, reset])

  async function onSubmit(data: EditProjectForm) {
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        name: data.name,
        description: data.description || null,
        gitRepoUrl: data.gitRepoUrl || null,
        autoMergePr: data.autoMergePr,
        gitMergeMethod: data.gitMergeMethod,
        visibility: data.visibility,
      }
      // 只在用户实际输入了新 token 时才提交
      if (data.gitAccessToken) {
        payload.gitAccessToken = data.gitAccessToken
      }

      const updated = await api.put(`projects/${project.id}`, { json: payload }).json<Project>()
      updateProject(project.id, updated)
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Failed to update project:', error)
      alert('更新项目失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑项目</DialogTitle>
          <DialogDescription>修改项目设置</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">项目名称 *</Label>
              <Input
                id="edit-name"
                placeholder="我的项目"
                {...register('name', { required: '项目名称不能为空' })}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">描述</Label>
              <Textarea
                id="edit-description"
                placeholder="项目描述（可选）"
                {...register('description')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-visibility">可见性</Label>
              <Select value={visibility} onValueChange={(v) => setValue('visibility', v as 'private' | 'public')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">私有 — 仅成员可见</SelectItem>
                  <SelectItem value="public">公开 — 所有人可查看</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-gitRepoUrl">Git 仓库地址</Label>
              <Input
                id="edit-gitRepoUrl"
                placeholder="https://github.com/user/repo.git"
                {...register('gitRepoUrl')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-gitAccessToken">Git Access Token</Label>
              <Input
                id="edit-gitAccessToken"
                type="password"
                placeholder="留空则不修改"
                {...register('gitAccessToken')}
              />
              {project.gitAccessToken && (
                <p className="text-xs text-muted-foreground">
                  当前 Token：{project.gitAccessToken}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="edit-autoMergePr">自动合并 PR</Label>
                <p className="text-xs text-muted-foreground">
                  流程完成后自动合并 PR 到目标分支
                </p>
              </div>
              <Switch
                id="edit-autoMergePr"
                checked={autoMergePr}
                onCheckedChange={(checked) => setValue('autoMergePr', checked)}
              />
            </div>
            {autoMergePr && (
              <div className="space-y-2">
                <Label htmlFor="edit-gitMergeMethod">合并方式</Label>
                <Select value={gitMergeMethod} onValueChange={(v) => setValue('gitMergeMethod', v as GitMergeMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">Merge — 创建合并提交（推荐）</SelectItem>
                    <SelectItem value="squash">Squash — 压缩为单个提交</SelectItem>
                    <SelectItem value="rebase">Rebase — 线性合并</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
