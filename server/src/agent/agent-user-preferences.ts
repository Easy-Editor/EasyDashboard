import { z } from 'zod'

export const AGENT_USER_PREFERENCE_CATEGORIES = [
  'canvas',
  'visual',
  'component',
  'chart',
  'language',
  'interaction',
  'other',
] as const

export const agentUserPreferenceSchema = z
  .object({
    id: z.uuid(),
    category: z.enum(AGENT_USER_PREFERENCE_CATEGORIES),
    content: z.string().trim().min(1).max(500),
    source: z.enum(['explicit', 'confirmed_repetition']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const agentUserPreferenceMemorySchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    preferences: z.array(agentUserPreferenceSchema).max(32),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict()

export type AgentUserPreference = z.infer<typeof agentUserPreferenceSchema>
export type AgentUserPreferenceMemory = z.infer<typeof agentUserPreferenceMemorySchema>

export const EMPTY_AGENT_USER_PREFERENCE_MEMORY: AgentUserPreferenceMemory = {
  version: 1,
  revision: 0,
  enabled: false,
  preferences: [],
  updatedAt: null,
}

export function readAgentUserPreferenceMemory(settings: Record<string, unknown>): AgentUserPreferenceMemory {
  const parsed = agentUserPreferenceMemorySchema.safeParse(settings.agentPreferenceMemory)
  return parsed.success ? parsed.data : structuredClone(EMPTY_AGENT_USER_PREFERENCE_MEMORY)
}

const credentialPatterns = [
  /\b(?:api[-_ ]?key|authorization|cookie|credential|password|secret|access[-_ ]?token|refresh[-_ ]?token|token)\b\s*(?::|=|\bis\b|\bwas\b)\s*\S+/iu,
  /\bbearer\s+(?!authentication\b)[a-z0-9._~+/=-]{4,}/iu,
  /\bsk-[a-z0-9_-]{8,}/iu,
  /\b(?:sk|rk|pk)_(?:live|test)_[a-z0-9]{8,}/iu,
  /\b(?:api[_-]?key|apikey)[_-][a-z0-9][a-z0-9_-]{7,}/iu,
  /\bAIza[a-z0-9_-]{20,}/iu,
  /\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})\b/iu,
  /\bxox[baprs]-[a-z0-9-]{16,}/iu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\b[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/iu,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/u,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/iu,
] as const
const MAX_MODEL_PREFERENCES = 12
const MAX_MODEL_PREFERENCE_TEXT = 3_000

export function isAgentUserPreferenceContentSafe(content: string): boolean {
  return !credentialPatterns.some(pattern => pattern.test(content))
}

export function agentUserPreferencesForModel(memory: AgentUserPreferenceMemory): AgentUserPreference[] {
  if (!memory.enabled) return []
  let remaining = MAX_MODEL_PREFERENCE_TEXT
  const projected: AgentUserPreference[] = []
  for (const preference of memory.preferences) {
    if (remaining <= 0 || projected.length >= MAX_MODEL_PREFERENCES) break
    if (!isAgentUserPreferenceContentSafe(preference.content)) continue
    const content = preference.content.slice(0, remaining)
    remaining -= content.length
    projected.push({ ...preference, content })
  }
  return projected
}

export function agentUserPreferenceTextLength(preferences: readonly AgentUserPreference[]): number {
  return preferences.reduce((sum, preference) => sum + preference.category.length + preference.content.length, 0)
}
