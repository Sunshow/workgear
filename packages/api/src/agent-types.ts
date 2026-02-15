/**
 * Agent 类型系统定义（系统固化，代码硬编码）
 * 
 * 每个 Agent 类型定义了：
 * - name: 显示名称
 * - description: 描述
 * - providerFields: Provider 配置表单字段 schema
 */

export interface ProviderField {
  key: string
  label: string
  type: 'string' | 'secret' | 'select'
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface AgentTypeDefinition {
  name: string
  description: string
  providerFields: ProviderField[]
}

export const AGENT_TYPES: Record<string, AgentTypeDefinition> = {
  'claude-code': {
    name: 'ClaudeCode',
    description: 'Anthropic Claude Code CLI 工具',
    providerFields: [
      { key: 'base_url', label: 'Base URL', type: 'string', required: true, placeholder: 'https://api.anthropic.com' },
      { key: 'auth_token', label: 'Auth Token', type: 'secret', required: true },
    ],
  },
  'codex': {
    name: 'Codex',
    description: 'OpenAI Codex CLI 工具',
    providerFields: [
      { key: 'base_url', label: 'Base URL', type: 'string', required: true, placeholder: 'https://api.openai.com' },
      { key: 'api_key', label: 'API Key', type: 'secret', required: true },
    ],
  },
  'droid': {
    name: 'Droid',
    description: 'Droid Agent',
    providerFields: [
      { key: 'provider_type', label: 'LLM Provider', type: 'select', required: true, options: ['anthropic', 'openai'] },
      { key: 'base_url', label: 'Base URL', type: 'string', required: true },
      { key: 'api_key', label: 'API Key', type: 'secret', required: true },
    ],
  },
}

export type AgentType = keyof typeof AGENT_TYPES

/** 获取 secret 类型的字段 key 列表 */
export function getSecretFields(agentType: string): string[] {
  const def = AGENT_TYPES[agentType]
  if (!def) return []
  return def.providerFields.filter(f => f.type === 'secret').map(f => f.key)
}

/** 脱敏处理 secret 字段 */
export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 10) return '***'
  return value.slice(0, 7) + '***' + value.slice(-3)
}

/** 对 Provider config 中的 secret 字段进行脱敏 */
export function maskProviderConfig(agentType: string, config: Record<string, any>): Record<string, any> {
  const secretKeys = getSecretFields(agentType)
  const masked = { ...config }
  for (const key of secretKeys) {
    if (masked[key]) {
      masked[key] = maskSecret(masked[key])
    }
  }
  return masked
}
