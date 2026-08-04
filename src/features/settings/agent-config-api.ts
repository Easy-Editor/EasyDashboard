import { apiRequest, jsonBody } from '@/api/client'

export type AgentModelProvider = 'platform' | 'openai-compatible'
export type AgentModelStatus = 'unverified' | 'probing' | 'active' | 'failed'

export type AgentModelCapabilities = {
  vision: boolean
  toolCalling: boolean
  structuredOutput: boolean
}

export type AgentModelBudget = {
  taskMicros: number
  projectMonthMicros: number
  warningRatio: 0.8
}

export type AgentModelConfig = {
  id: string
  provider: AgentModelProvider
  endpoint: string
  endpointOrigin: string
  model: string
  billingScope: 'user' | 'project'
  fallbackToPlatform: boolean
  capabilities: AgentModelCapabilities | null
  status: AgentModelStatus
  configured: boolean
  budget: AgentModelBudget
}

export type AgentModelConfigResponse = {
  config: AgentModelConfig | null
  platformConfigured: boolean
}

export type UserAgentModelConfigInput = {
  provider: AgentModelProvider
  endpoint?: string
  model?: string
  apiKey?: string
  fallbackToPlatform: boolean
  budget: AgentModelBudget
}

export async function getUserAgentModelConfig(): Promise<AgentModelConfigResponse> {
  return apiRequest<AgentModelConfigResponse>('/api/agent/config?scope=user')
}

export async function updateUserAgentModelConfig(input: UserAgentModelConfigInput): Promise<AgentModelConfigResponse> {
  return apiRequest<AgentModelConfigResponse>('/api/agent/config', {
    method: 'PUT',
    body: jsonBody({ scope: 'user', ...input }),
  })
}

export async function probeUserAgentModelConfig(): Promise<AgentModelConfigResponse> {
  return apiRequest<AgentModelConfigResponse>('/api/agent/config/probe', {
    method: 'POST',
    body: jsonBody({ scope: 'user' }),
  })
}

export function microsToUsdInput(micros: number): string {
  return (micros / 1_000_000).toFixed(2)
}

export function usdInputToMicros(value: string): number | null {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const micros = Math.round(amount * 1_000_000)
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null
}
