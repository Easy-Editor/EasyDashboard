import { createHash } from 'node:crypto'
import type { AgentSkillTrace } from '../agent/agent-skill-trace.js'

export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

export function canonicalJsonSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function agentSpikeCandidateDigest(candidateSchema: Record<string, unknown>): string {
  return canonicalJsonSha256(candidateSchema)
}

export function agentSpikePreparedDigest(input: {
  candidateSchema: Record<string, unknown>
  hostReceipt: Record<string, unknown>
  evidence: Record<string, unknown>
}): string {
  return canonicalJsonSha256(input)
}

export function agentSpikeIssueDigest(input: {
  actorId: string
  projectId: string
  taskId: string
  stageId: string
  executorId: string
  operationId: string
  grantJti: string
  baseDraftVersion: number
  inputDigest: string
  executorInput: Record<string, unknown>
  compatibility: Record<string, string>
  expiresAt: Date
  skillTrace?: AgentSkillTrace
}): string {
  return canonicalJsonSha256({
    actorId: input.actorId,
    projectId: input.projectId,
    taskId: input.taskId,
    stageId: input.stageId,
    executorId: input.executorId,
    operationId: input.operationId,
    grantJti: input.grantJti,
    baseDraftVersion: input.baseDraftVersion,
    inputDigest: input.inputDigest,
    executorInput: input.executorInput,
    compatibility: input.compatibility,
    expiresAt: input.expiresAt,
    ...(input.skillTrace === undefined ? {} : { skillTrace: input.skillTrace }),
  })
}

export function compareAgentSpikeDigest(
  persistedDigest: string,
  requestedDigest: string,
): 'same' | 'integrity_conflict' {
  return persistedDigest === requestedDigest ? 'same' : 'integrity_conflict'
}
