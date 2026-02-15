import { useState, useEffect } from 'react'
import { Bot, Plus, Pencil, Trash2, Save, X } from 'lucide-react'
import { api } from '@/lib/api'
import type { AgentRole, AgentTypeDefinition, AgentProvider, AgentModel } from '@/lib/types'
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

const NONE_VALUE = '__none__'

export function AgentRolesPage() {
  const [roles, setRoles] = useState<AgentRole[]>([])
  const [agentTypes, setAgentTypes] = useState<Record<string, AgentTypeDefinition>>({})
  const [providers, setProviders] = useState<AgentProvider[]>([])
  const [models, setModels] = useState<Record<string, AgentModel[]>>({})
  const [loading, setLoading] = useState(true)
  const [editingRole, setEditingRole] = useState<AgentRole | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [rolesData, typesData, providersData] = await Promise.all([
        api.get('agent-roles').json<AgentRole[]>(),
        api.get('agent-types').json<Record<string, AgentTypeDefinition>>(),
        api.get('agent-providers').json<AgentProvider[]>(),
      ])
      setRoles(rolesData)
      setAgentTypes(typesData)
      setProviders(providersData)

      // 加载所有 Provider 的 Model
      const modelsByProvider: Record<string, AgentModel[]> = {}
      for (const p of providersData) {
        const m = await api.get(`agent-providers/${p.id}/models`).json<AgentModel[]>()
        modelsByProvider[p.id] = m
      }
      setModels(modelsByProvider)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(role: AgentRole, updates: Partial<AgentRole>) {
    setSaving(true)
    try {
      await api.put(`agent-roles/${role.id}`, { json: updates })
      await loadData()
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
    providerId: string | null
    modelId: string | null
    systemPrompt: string
  }) {
    setSaving(true)
    try {
      await api.post('agent-roles', { json: data })
      await loadData()
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
      await loadData()
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
            配置每个角色使用的 Agent 类型、Provider 和 Model
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
              agentTypes={agentTypes}
              providers={providers}
              models={models}
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
        agentTypes={agentTypes}
        providers={providers}
        models={models}
        onCreate={handleCreate}
        saving={saving}
      />
    </div>
  )
}

function RoleCard({
  role,
  agentTypes,
  providers,
  models,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  saving,
}: {
  role: AgentRole
  agentTypes: Record<string, AgentTypeDefinition>
  providers: AgentProvider[]
  models: Record<string, AgentModel[]>
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
  const [editProviderId, setEditProviderId] = useState(role.providerId || NONE_VALUE)
  const [editModelId, setEditModelId] = useState(role.modelId || NONE_VALUE)
  const [editPrompt, setEditPrompt] = useState(role.systemPrompt)

  useEffect(() => {
    if (isEditing) {
      setEditName(role.name)
      setEditDescription(role.description || '')
      setEditAgentType(role.agentType)
      setEditProviderId(role.providerId || NONE_VALUE)
      setEditModelId(role.modelId || NONE_VALUE)
      setEditPrompt(role.systemPrompt)
    }
  }, [isEditing, role])

  const filteredProviders = providers.filter((p) => p.agentType === editAgentType)
  const filteredModels = editProviderId !== NONE_VALUE ? (models[editProviderId] || []) : []

  // 当 agentType 变化时重置 provider 和 model
  useEffect(() => {
    if (isEditing) {
      const hasProvider = filteredProviders.some((p) => p.id === editProviderId)
      if (!hasProvider) {
        setEditProviderId(NONE_VALUE)
        setEditModelId(NONE_VALUE)
      }
    }
  }, [editAgentType])

  // 当 provider 变化时重置 model
  useEffect(() => {
    if (isEditing) {
      const hasModel = filteredModels.some((m) => m.id === editModelId)
      if (!hasModel) {
        setEditModelId(NONE_VALUE)
      }
    }
  }, [editProviderId])

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

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Agent 类型</Label>
            <Select value={editAgentType} onValueChange={setEditAgentType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(agentTypes).map(([key, def]) => (
                  <SelectItem key={key} value={key}>
                    {def.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Provider</Label>
            <Select value={editProviderId} onValueChange={setEditProviderId}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>使用默认</SelectItem>
                {filteredProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} {p.isDefault ? '(默认)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Model</Label>
            <Select value={editModelId} onValueChange={setEditModelId}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>使用默认</SelectItem>
                {filteredModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName || m.modelName} {m.isDefault ? '(默认)' : ''}
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
                providerId: editProviderId === NONE_VALUE ? null : editProviderId,
                modelId: editModelId === NONE_VALUE ? null : editModelId,
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
          <span>Agent: {agentTypes[role.agentType]?.name || role.agentType}</span>
          <span>Provider: {role.providerName || '默认'}</span>
          <span>Model: {role.modelName || '默认'}</span>
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
  agentTypes,
  providers,
  models,
  onCreate,
  saving,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentTypes: Record<string, AgentTypeDefinition>
  providers: AgentProvider[]
  models: Record<string, AgentModel[]>
  onCreate: (data: {
    slug: string
    name: string
    description: string
    agentType: string
    providerId: string | null
    modelId: string | null
    systemPrompt: string
  }) => void
  saving: boolean
}) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentType, setAgentType] = useState('claude-code')
  const [providerId, setProviderId] = useState(NONE_VALUE)
  const [modelId, setModelId] = useState(NONE_VALUE)
  const [prompt, setPrompt] = useState('')

  const filteredProviders = providers.filter((p) => p.agentType === agentType)
  const filteredModels = providerId !== NONE_VALUE ? (models[providerId] || []) : []

  function handleClose(open: boolean) {
    if (!open) {
      setSlug('')
      setName('')
      setDescription('')
      setAgentType('claude-code')
      setProviderId(NONE_VALUE)
      setModelId(NONE_VALUE)
      setPrompt('')
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新建 Agent 角色</DialogTitle>
          <DialogDescription>创建自定义 Agent 角色，配置 Provider、Model 和 System Prompt</DialogDescription>
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

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Agent 类型</Label>
              <Select value={agentType} onValueChange={(v) => { setAgentType(v); setProviderId(NONE_VALUE); setModelId(NONE_VALUE) }}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(agentTypes).map(([key, def]) => (
                    <SelectItem key={key} value={key}>
                      {def.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Provider</Label>
              <Select value={providerId} onValueChange={(v) => { setProviderId(v); setModelId(NONE_VALUE) }}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>使用默认</SelectItem>
                  {filteredProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.isDefault ? '(默认)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Model</Label>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>使用默认</SelectItem>
                  {filteredModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName || m.modelName} {m.isDefault ? '(默认)' : ''}
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
                providerId: providerId === NONE_VALUE ? null : providerId,
                modelId: modelId === NONE_VALUE ? null : modelId,
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
