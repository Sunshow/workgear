import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router'
import { ArrowLeft, Save, Check, AlertTriangle, Play, RotateCcw, Settings } from 'lucide-react'
import { parse, stringify } from 'yaml'
import { api } from '@/lib/api'
import type { Workflow, ValidateDslResponse, WorkflowTemplate, TemplateParameter } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { YamlEditor } from './yaml-editor'
import { DagPreview } from './dag-preview'
import { TemplateParamsDialog } from './template-params-dialog'
import type { DslNode, DslEdge } from './dsl-parser'
import { parseDsl } from './dsl-parser'

export function WorkflowEditorPage() {
  const { projectId, workflowId } = useParams<{ projectId: string; workflowId: string }>()
  const navigate = useNavigate()
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [name, setName] = useState('')
  const [dsl, setDsl] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [parsedNodes, setParsedNodes] = useState<DslNode[]>([])
  const [parsedEdges, setParsedEdges] = useState<DslEdge[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [templateParameters, setTemplateParameters] = useState<TemplateParameter[]>([])
  const [templateParams, setTemplateParams] = useState<Record<string, any>>({})
  const [paramsDialogOpen, setParamsDialogOpen] = useState(false)
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (workflowId) loadWorkflow()
  }, [workflowId])

  async function loadWorkflow() {
    try {
      const data = await api.get(`workflows/${workflowId}`).json<Workflow>()
      setWorkflow(data)
      setName(data.name)
      setDsl(data.dsl)
      setTemplateParams(data.templateParams || {})
      handleParseDsl(data.dsl)

      // Load template parameters if workflow has a template
      if (data.templateId) {
        try {
          const template = await api.get(`workflow-templates/${data.templateId}`).json<WorkflowTemplate>()
          setTemplateParameters(template.parameters)
        } catch (error) {
          console.error('Failed to load template:', error)
        }
      }
    } catch (error) {
      console.error('Failed to load workflow:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleParseDsl(yamlStr: string) {
    const result = parseDsl(yamlStr)
    setParsedNodes(result.nodes)
    setParsedEdges(result.edges)
    setValidationErrors(result.errors)
  }

  const handleDslChange = useCallback(
    (value: string) => {
      setDsl(value)
      setDirty(true)

      // Debounced parse + validate
      if (validateTimer.current) clearTimeout(validateTimer.current)
      validateTimer.current = setTimeout(() => {
        handleParseDsl(value)
      }, 500)
    },
    []
  )

  async function handleSave() {
    if (!workflowId) return
    setSaving(true)
    try {
      await api.put(`workflows/${workflowId}`, {
        json: { name, dsl, templateParams },
      })
      setDirty(false)
    } catch (error) {
      console.error('Failed to save workflow:', error)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleValidate() {
    try {
      const result = await api
        .post('workflows/validate', { json: { dsl } })
        .json<ValidateDslResponse>()
      setValidationErrors(result.errors)
      if (result.valid) {
        alert('✅ DSL 校验通过')
      }
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  function handleNodeClick(nodeId: string) {
    setSelectedNodeId(nodeId)
  }

  function handleFormatDsl() {
    try {
      const parsed = parse(dsl)
      const formatted = stringify(parsed, { indent: 2, lineWidth: 120 })
      setDsl(formatted)
      setDirty(true)
      handleParseDsl(formatted)
    } catch {
      // ignore format errors
    }
  }

  function handleParamsSave(values: Record<string, any>) {
    setTemplateParams(values)
    setDirty(true)
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">流程不存在</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/projects/${projectId}/workflows`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setDirty(true)
            }}
            className="w-64 font-semibold"
          />
          {dirty && (
            <Badge variant="outline" className="text-yellow-600">
              未保存
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {validationErrors.length > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {validationErrors.length} 个错误
            </Badge>
          )}
          {validationErrors.length === 0 && parsedNodes.length > 0 && (
            <Badge className="gap-1 bg-green-100 text-green-800">
              <Check className="h-3 w-3" />
              校验通过
            </Badge>
          )}
          {templateParameters.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setParamsDialogOpen(true)}>
              <Settings className="mr-1 h-3 w-3" />
              参数配置
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleValidate}>
            <Play className="mr-1 h-3 w-3" />
            校验
          </Button>
          <Button variant="outline" size="sm" onClick={handleFormatDsl}>
            <RotateCcw className="mr-1 h-3 w-3" />
            格式化
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
            <Save className="mr-1 h-3 w-3" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* Validation errors bar */}
      {validationErrors.length > 0 && (
        <div className="border-b bg-red-50 px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {validationErrors.map((err, i) => (
              <span key={i} className="text-xs text-red-600">
                • {err}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Editor + Preview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: YAML Editor */}
        <div className="flex-1 border-r">
          <YamlEditor
            value={dsl}
            onChange={handleDslChange}
            errors={validationErrors}
          />
        </div>

        {/* Right: DAG Preview */}
        <div className="w-[45%]">
          <DagPreview
            nodes={parsedNodes}
            edges={parsedEdges}
            errors={validationErrors}
            selectedNodeId={selectedNodeId}
            onNodeClick={handleNodeClick}
          />
        </div>
      </div>

      {/* Template Params Dialog */}
      <TemplateParamsDialog
        open={paramsDialogOpen}
        onOpenChange={setParamsDialogOpen}
        parameters={templateParameters}
        values={templateParams}
        onSave={handleParamsSave}
      />
    </div>
  )
}
