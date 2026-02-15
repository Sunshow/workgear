import { useState, useEffect } from 'react'
import { Settings, Plus, Pencil, Trash2, Star } from 'lucide-react'
import { api } from '@/lib/api'
import type { AgentTypeDefinition, AgentProvider, AgentModel } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

export function AgentConfigPage() {
  const [agentTypes, setAgentTypes] = useState<Record<string, AgentTypeDefinition>>({})
  const [providers, setProviders] = useState<Record<string, AgentProvider[]>>({})
  const [models, setModels] = useState<Record<string, AgentModel[]>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('claude-code')

  const [showProviderDialog, setShowProviderDialog] = useState(false)
  const [showModelDialog, setShowModelDialog] = useState(false)
  const [editingProvider, setEditingProvider] = useState<AgentProvider | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      // 加载 Agent 类型定义
      const types = await api.get('agent-types').json<Record<string, AgentTypeDefinition>>()
      setAgentTypes(types)

      // 加载所有 Provider
      const allProviders = await api.get('agent-providers').json<AgentProvider[]>()
      const providersByType: Record<string, AgentProvider[]> = {}
      for (const p of allProviders) {
        if (!providersByType[p.agentType]) providersByType[p.agentType] = []
        providersByType[p.agentType].push(p)
      }
      setProviders(providersByType)

      // 加载所有 Model
      const modelsByProvider: Record<string, AgentModel[]> = {}
      for (const p of allProviders) {
        const m = await api.get(`agent-providers/${p.id}/models`).json<AgentModel[]>()
        modelsByProvider[p.id] = m
      }
      setModels(modelsByProvider)
    } catch (error) {
      console.error('Failed to load agent config:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteProvider(provider: AgentProvider) {
    if (!confirm(`确定要删除 Provider "${provider.name}" 吗？这将同时删除其下的所有 Model。`)) return
    try {
      await api.delete(`agent-providers/${provider.id}`)
      await loadData()
    } catch (error) {
      console.error('Failed to delete provider:', error)
      alert('删除失败')
    }
  }

  async function handleSetDefaultProvider(provider: AgentProvider) {
    try {
      await api.put(`agent-providers/${provider.id}/default`)
      await loadData()
    } catch (error) {
      console.error('Failed to set default provider:', error)
      alert('设置失败')
    }
  }

  async function handleDeleteModel(modelId: string) {
    if (!confirm('确定要删除此 Model 吗？')) return
    try {
      await api.delete(`agent-models/${modelId}`)
      await loadData()
    } catch (error) {
      console.error('Failed to delete model:', error)
      alert('删除失败')
    }
  }

  async function handleSetDefaultModel(modelId: string) {
    try {
      await api.put(`agent-models/${modelId}/default`)
      await loadData()
    } catch (error) {
      console.error('Failed to set default model:', error)
      alert('设置失败')
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  const agentTypeKeys = Object.keys(agentTypes)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Agent 配置</h1>
          <span className="text-sm text-muted-foreground">
            配置 Provider 和 Model
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {agentTypeKeys.map((key) => (
              <TabsTrigger key={key} value={key}>
                {agentTypes[key].name}
              </TabsTrigger>
            ))}
          </TabsList>

          {agentTypeKeys.map((agentType) => (
            <TabsContent key={agentType} value={agentType} className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{agentTypes[agentType].description}</p>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingProvider(null)
                    setShowProviderDialog(true)
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  添加 Provider
                </Button>
              </div>

              <div className="space-y-3">
                {(providers[agentType] || []).map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    agentType={agentTypes[agentType]}
                    models={models[provider.id] || []}
                    onEdit={() => {
                      setEditingProvider(provider)
                      setShowProviderDialog(true)
                    }}
                    onDelete={() => handleDeleteProvider(provider)}
                    onSetDefault={() => handleSetDefaultProvider(provider)}
                    onAddModel={() => {
                      setSelectedProviderId(provider.id)
                      setShowModelDialog(true)
                    }}
                    onDeleteModel={handleDeleteModel}
                    onSetDefaultModel={handleSetDefaultModel}
                  />
                ))}
                {(providers[agentType] || []).length === 0 && (
                  <Card className="p-8 text-center text-muted-foreground">
                    暂无 Provider，点击上方按钮添加
                  </Card>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <ProviderDialog
        open={showProviderDialog}
        onOpenChange={setShowProviderDialog}
        agentType={activeTab}
        agentTypeDef={agentTypes[activeTab]}
        provider={editingProvider}
        onSuccess={loadData}
      />

      <ModelDialog
        open={showModelDialog}
        onOpenChange={setShowModelDialog}
        providerId={selectedProviderId}
        onSuccess={loadData}
      />
    </div>
  )
}

function ProviderCard({
  provider,
  agentType,
  models,
  onEdit,
  onDelete,
  onSetDefault,
  onAddModel,
  onDeleteModel,
  onSetDefaultModel,
}: {
  provider: AgentProvider
  agentType: AgentTypeDefinition
  models: AgentModel[]
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
  onAddModel: () => void
  onDeleteModel: (id: string) => void
  onSetDefaultModel: (id: string) => void
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold">{provider.name}</h3>
            {provider.isDefault && (
              <Badge className="bg-yellow-100 text-yellow-800">
                <Star className="mr-1 h-3 w-3" />
                默认
              </Badge>
            )}
          </div>

          <div className="space-y-1 text-sm text-muted-foreground">
            {agentType.providerFields.map((field) => (
              <div key={field.key}>
                <span className="font-medium">{field.label}:</span>{' '}
                <span className="font-mono">{provider.config[field.key] || '-'}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Models</span>
              <Button variant="ghost" size="sm" onClick={onAddModel}>
                <Plus className="h-3 w-3 mr-1" />
                添加
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {models.map((model) => (
                <Badge
                  key={model.id}
                  variant={model.isDefault ? 'default' : 'outline'}
                  className="flex items-center gap-1"
                >
                  {model.isDefault && <Star className="h-3 w-3" />}
                  {model.displayName || model.modelName}
                  <button
                    onClick={() => onSetDefaultModel(model.id)}
                    className="ml-1 hover:text-yellow-600"
                    title="设为默认"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onDeleteModel(model.id)}
                    className="ml-1 hover:text-destructive"
                  >
                    ×
                  </button>
                </Badge>
              ))}
              {models.length === 0 && (
                <span className="text-xs text-muted-foreground">暂无 Model</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 ml-4">
          {!provider.isDefault && (
            <Button variant="ghost" size="sm" onClick={onSetDefault} title="设为默认">
              <Star className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </Card>
  )
}

function ProviderDialog({
  open,
  onOpenChange,
  agentType,
  agentTypeDef,
  provider,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentType: string
  agentTypeDef: AgentTypeDefinition
  provider: AgentProvider | null
  onSuccess: () => void
}) {
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      if (provider) {
        setName(provider.name)
        setConfig(provider.config)
        setIsDefault(provider.isDefault)
      } else {
        setName('')
        const initialConfig: Record<string, string> = {}
        agentTypeDef?.providerFields.forEach((f) => {
          initialConfig[f.key] = f.placeholder || ''
        })
        setConfig(initialConfig)
        setIsDefault(false)
      }
    }
  }, [open, provider, agentTypeDef])

  async function handleSave() {
    if (!name.trim()) {
      alert('请输入 Provider 名称')
      return
    }

    setSaving(true)
    try {
      if (provider) {
        await api.put(`agent-providers/${provider.id}`, { json: { name, config, isDefault } })
      } else {
        await api.post('agent-providers', { json: { agentType, name, config, isDefault } })
      }
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save provider:', error)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!agentTypeDef) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{provider ? '编辑' : '添加'} Provider</DialogTitle>
          <DialogDescription>{agentTypeDef.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Provider 名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="例如：Anthropic 官方"
            />
          </div>

          {agentTypeDef.providerFields.map((field) => (
            <div key={field.key}>
              <Label>{field.label}</Label>
              {field.type === 'select' ? (
                <Select
                  value={config[field.key] || ''}
                  onValueChange={(v) => setConfig({ ...config, [field.key]: v })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={field.type === 'secret' ? 'password' : 'text'}
                  value={config[field.key] || ''}
                  onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                  className="mt-1"
                  placeholder={field.placeholder}
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-default"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <Label htmlFor="is-default">设为默认 Provider</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModelDialog({
  open,
  onOpenChange,
  providerId,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerId: string | null
  onSuccess: () => void
}) {
  const [modelName, setModelName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setModelName('')
      setDisplayName('')
      setIsDefault(false)
    }
  }, [open])

  async function handleSave() {
    if (!modelName.trim()) {
      alert('请输入 Model 名称')
      return
    }
    if (!providerId) return

    setSaving(true)
    try {
      await api.post(`agent-providers/${providerId}/models`, {
        json: { modelName, displayName: displayName || null, isDefault },
      })
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to add model:', error)
      alert('添加失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加 Model</DialogTitle>
          <DialogDescription>手动输入 Model 名称</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label>Model 名称</Label>
            <Input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="mt-1"
              placeholder="例如：claude-sonnet-4"
            />
          </div>

          <div>
            <Label>显示名称（可选）</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1"
              placeholder="例如：Claude Sonnet 4"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="model-default"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            <Label htmlFor="model-default">设为默认 Model</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving} onClick={handleSave}>
            {saving ? '添加中...' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
