import { useRef, useCallback } from 'react'
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react'

interface YamlEditorProps {
  value: string
  onChange: (value: string) => void
  errors: string[]
}

// YAML keyword completions for workflow DSL
const DSL_KEYWORDS = [
  'name', 'version', 'description', 'variables', 'triggers', 'nodes', 'edges',
  'id', 'type', 'config', 'agent', 'on_reject', 'on_failure', 'children',
  'form', 'field', 'label', 'required', 'options', 'default',
  'prompt_template', 'mode', 'artifact', 'timeout', 'retry',
  'review_target', 'actions', 'show_diff',
  'goto', 'max_loops', 'inject', 'feedback',
  'role', 'model', 'from', 'to',
  'create_branch', 'branch_pattern', 'auto_commit', 'run_tests',
  'max_attempts', 'backoff', 'execution_mode', 'foreach', 'as', 'max_concurrency',
]

const NODE_TYPES = [
  'human_input', 'human_review', 'agent_task', 'parallel_group', 'integration',
]

const AGENT_MODES = ['spec', 'execute', 'review']
const FORM_FIELD_TYPES = ['text', 'textarea', 'select', 'number', 'file_upload']

export function YamlEditor({ value, onChange, errors }: YamlEditorProps) {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<any>(null)

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Register YAML completion provider
    monaco.languages.registerCompletionItemProvider('yaml', {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const lineContent = model.getLineContent(position.lineNumber).trimStart()
        const suggestions: any[] = []

        // Suggest node types after "type:"
        if (lineContent.match(/^\s*type:\s*/)) {
          for (const t of NODE_TYPES) {
            suggestions.push({
              label: t,
              kind: monaco.languages.CompletionItemKind.Enum,
              insertText: t,
              range,
              detail: 'Node type',
            })
          }
          return { suggestions }
        }

        // Suggest modes after "mode:"
        if (lineContent.match(/^\s*mode:\s*/)) {
          for (const m of AGENT_MODES) {
            suggestions.push({
              label: m,
              kind: monaco.languages.CompletionItemKind.Enum,
              insertText: m,
              range,
              detail: 'Agent mode',
            })
          }
          return { suggestions }
        }

        // Suggest field types after "type:" inside form context
        if (lineContent.match(/^\s*type:\s*/) && isInFormContext(model, position.lineNumber)) {
          for (const ft of FORM_FIELD_TYPES) {
            suggestions.push({
              label: ft,
              kind: monaco.languages.CompletionItemKind.Enum,
              insertText: ft,
              range,
              detail: 'Form field type',
            })
          }
          return { suggestions }
        }

        // Suggest DSL keywords
        for (const kw of DSL_KEYWORDS) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw + ': ',
            range,
          })
        }

        // Suggest node snippets
        suggestions.push({
          label: 'node-agent-task',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            '- id: ${1:node_id}',
            '  name: "${2:节点名称}"',
            '  type: agent_task',
            '  agent:',
            '    role: "${3:general-developer}"',
            '  config:',
            '    prompt_template: |',
            '      ${4:请执行以下任务}',
            '    mode: ${5:execute}',
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: 'Agent Task 节点模板',
          documentation: '创建一个 Agent 执行节点',
        })

        suggestions.push({
          label: 'node-human-review',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            '- id: ${1:review_node}',
            '  name: "${2:人工审核}"',
            '  type: human_review',
            '  config:',
            '    review_target: "{{nodes.${3:prev_node}.outputs}}"',
            '    actions: ["approve", "reject", "edit"]',
            '  on_reject:',
            '    goto: ${4:prev_node}',
            '    max_loops: ${5:3}',
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: 'Human Review 节点模板',
          documentation: '创建一个人工审核节点',
        })

        suggestions.push({
          label: 'node-human-input',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            '- id: ${1:input_node}',
            '  name: "${2:人工输入}"',
            '  type: human_input',
            '  config:',
            '    form:',
            '      - field: ${3:field_name}',
            '        type: ${4:textarea}',
            '        label: "${5:字段标签}"',
            '        required: true',
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: 'Human Input 节点模板',
          documentation: '创建一个人工输入节点',
        })

        suggestions.push({
          label: 'edge',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            '- from: ${1:source_node}',
            '  to: ${2:target_node}',
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          detail: '边定义',
        })

        return { suggestions }
      },
    })

    // Set editor options
    editor.updateOptions({
      minimap: { enabled: false },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      insertSpaces: true,
      fontSize: 13,
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: { indentation: true },
      suggest: { showKeywords: true },
    })
  }, [])

  const handleChange: OnChange = useCallback(
    (value) => {
      onChange(value || '')
    },
    [onChange]
  )

  // Update error markers when errors change
  const updateMarkers = useCallback(() => {
    if (!editorRef.current || !monacoRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return

    const markers = errors.map((err) => ({
      severity: monacoRef.current.MarkerSeverity.Error,
      message: err,
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    }))

    monacoRef.current.editor.setModelMarkers(model, 'dsl-validator', markers)
  }, [errors])

  // Update markers when errors change
  if (monacoRef.current && editorRef.current) {
    updateMarkers()
  }

  return (
    <div className="h-full">
      <Editor
        height="100%"
        language="yaml"
        theme="vs-light"
        value={value}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          fontSize: 13,
        }}
      />
    </div>
  )
}

function isInFormContext(model: any, lineNumber: number): boolean {
  for (let i = lineNumber - 1; i >= 1; i--) {
    const line = model.getLineContent(i).trim()
    if (line === 'form:') return true
    if (line.startsWith('- id:') || line.startsWith('nodes:')) return false
  }
  return false
}
