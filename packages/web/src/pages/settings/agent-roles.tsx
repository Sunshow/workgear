import { useState, useEffect } from 'react'
import { Bot, Plus, Pencil, Trash2, Save, X } from 'lucide-react'
import { api } from '@/lib/api'
import type { AgentRole } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const MODEL_OPTIONS = [
  { value: '__default__', label: '默认 (CLAUDE_MODEL)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (20250514)' },
  { value: 'claude-opus-4-20250918', label: 'Claude Opus 4 (20250918)' },
]

const AGENT_TYPE_OPTIONS = [
  { value: 'claude-code', label: 'Claude Code' },
]

export function AgentRolesPage() {
  const [roles, setRoles] = useState<AgentRole[]>([])
  const [loading, setLoading] = useState(true)
  const [editingRole, setEditingRole] = useState<AgentRole | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadRoles()
  }, [])

  async function loadRoles() {
    setLoading(true)
    try {
      const data = await api.get('agent-roles').json<AgentRole[]>()
      setRoles(data)
    } catch (error) {
      console.error('Failed to load agent roles:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(role: AgentRole, updates: Partial<AgentRole>) {
    setSaving(true)
    try {
      await api.put(`agent-roles/${role.id}`, { json: updates })
      await loadRoles()
      setEditingRole(null)
    } catch (error) {
      console.error('Failed to update role:', error)
      alert('更新失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate(data: {
    slug: string
    name: string
    description: string
    agentType: string
    defaultModel: string | null
    systemPrompt: string
  }) {
    setSaving(true)
    try {
      await api.post('agent-roles', { json: data })
      await loadRoles()
      setShowCreateDialog(false)
    } catch (error) {
      console.error('Failed to create role:', error)
      alert('创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(role: AgentRole) {
    if (!confirm(`确定要删除角色 "${role.name}" 吗？`)) return
    try {
      await api.delete(`agent-roles/${role.id}`)
      await loadRoles()
    } catch (error) {
      console.error('Failed to delete role:', error)
      alert('删除失败')
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Agent 角色管理</h1>
          <span className="text-sm text-muted-foreground">
            配置每个角色使用的 Agent 类型和默认模型
          </span>
        </div>
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-1 h-4 w-4" />
          新建角色
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-4">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              isEditing={editingRole?.id === role.id}
              onEdit={() => setEditingRole(role)}
              onCancel={() => setEditingRole(null)}
              onSave={(updates) => handleSave(role, updates)}
              onDelete={() => handleDelete(role)}
              saving={saving}
            />
          ))}
        </div>
      </div>

      <CreateRoleDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={handleCreate}
        saving={saving}
      />
    </div>
  )
}

function RoleCard({
  role,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  saving,
}: {
  role: AgentRole
  isEditing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (updates: Partial<AgentRole>) => void
  onDelete: () => void
  saving: boolean
}) {
  const [editName, setEditName] = useState(role.name)
  const [editDescription, setEditDescription] = useState(role.description || '')
  const [editAgentType, setEditAgentType] = useState(role.agentType)
  const [editModel, setEditModel] = useState(role.defaultModel || '__default__')
  const [editPrompt, setEditPrompt] = useState(role.systemPrompt)

  useEffect(() => {
    if (isEditing) {
      setEditName(role.name)
      setEditDescription(role.description || '')
      setEditAgentType(role.agentType)
      setEditModel(role.defaultModel || '__default__')
      setEditPrompt(role.systemPrompt)
    }
  }, [isEditing, role])

  if (isEditing) {
    return (
      <Card className="p-5 space-y-4 border-primary/50">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>名称</Label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Slug</Label>
            <Input value={role.slug} disabled className="mt-1 bg-muted" />
          </div>
        </div>

        <div>
          <Label>描述</Label>
          <Input
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            className="mt-1"
            placeholder="角色描述"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Agent 类型</Label>
            <Select value={editAgentType} onValueChange={setEditAgentType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>默认模型</Label>
            <Select value={editModel} onValueChange={setEditModel}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label>System Prompt</Label>
          <Textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            className="mt-1 min-h-[120px] font-mono text-sm"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            <X className="mr-1 h-3 w-3" />
            取消
          </Button>
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              onSave({
                name: editName,
                description: editDescription || null,
                agentType: editAgentType,
                defaultModel: editModel === '__default__' ? null : editModel,
                systemPrompt: editPrompt,
              })
            }
          >
            <Save className="mr-1 h-3 w-3" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex items-start justify-between p-5">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{role.name}</h3>
          <Badge variant="outline" className="font-mono text-xs">
            {role.slug}
          </Badge>
          {role.isBuiltin && (
            <Badge className="bg-blue-100 text-blue-800 text-xs">内置</Badge>
          )}
        </div>
        {role.description && (
          <p className="text-sm text-muted-foreground">{role.description}</p>
        )}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Agent: {role.agentType}</span>
          <span>
            模型:{' '}
            {role.defaultModel ? (
              <span className="font-mono">{role.defaultModel}</span>
            ) : (
              <span className="italic">默认 (CLAUDE_MODEL)</span>
            )}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        {!role.isBuiltin && (
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
    </Card>
  )
}

function CreateRoleDialog({
  open,
  onOpenChange,
  onCreate,
  saving,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (data: {
    slug: string
    name: string
    description: string
    agentType: string
    defaultModel: string | null
    systemPrompt: string
  }) => void
  saving: boolean
}) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentType, setAgentType] = useState('claude-code')
  const [model, setModel] = useState('__default__')
  const [prompt, setPrompt] = useState('')

  function handleClose(open: boolean) {
    if (!open) {
      setSlug('')
      setName('')
      setDescription('')
      setAgentType('claude-code')
      setModel('__default__')
      setPrompt('')
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建 Agent 角色</DialogTitle>
          <DialogDescription>创建自定义 Agent 角色，配置模型和 System Prompt</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Slug (唯一标识)</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-1"
                placeholder="my-custom-role"
              />
            </div>
            <div>
              <Label>名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1"
                placeholder="自定义角色"
              />
            </div>
          </div>

          <div>
            <Label>描述</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
              placeholder="角色描述"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Agent 类型</Label>
              <Select value={agentType} onValueChange={setAgentType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>默认模型</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>System Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="mt-1 min-h-[120px] font-mono text-sm"
              placeholder="你是一个..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            取消
          </Button>
          <Button
            disabled={saving || !slug.trim() || !name.trim() || !prompt.trim()}
            onClick={() =>
              onCreate({
                slug,
                name,
                description,
                agentType,
                defaultModel: model === '__default__' ? null : model,
                systemPrompt: prompt,
              })
            }
          >
            {saving ? '创建中...' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
