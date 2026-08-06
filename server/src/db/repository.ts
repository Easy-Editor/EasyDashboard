import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, max, ne, or, sql } from 'drizzle-orm'
import { readAgentUserPreferenceMemory } from '../agent/agent-user-preferences.js'
import { agentRunInputDigest, estimateAgentProviderInputTokens } from '../agent/change-set-model.js'
import { isAgentConversationImplementationDetailText } from '../agent/conversation-policy.js'
import { derivePublicCost } from '../agent/cost-accuracy.js'
import { safeAgentUndo } from '../agent/safe-agent-undo.js'
import { bindAgentWorkspaceTaskRunProjection, parseAgentProjectWorkspacePayload } from '../agent/workspace-contract.js'
import type { AppEnv } from '../env.js'
import type {
  AgentMutationAuthority,
  AgentProjectContextRecord,
  AgentProjectStartRecord,
  AgentProviderAttemptFence,
  AgentProviderInputSnapshot,
  AgentRunCostRecord,
  AgentRunDispatchRecord,
  AgentRunDispatchState,
  AgentScreenshotArtifactRecord,
  AgentSpikeOperationBinding,
  AgentSpikeOperationRecord,
  AgentSpikeOperationStatus,
  AgentTaskCompletionInput,
  AgentTaskRunBounds,
  AgentTaskTransitionFence,
  AgentWorkspaceRecord,
  DurableAgentTurnRecord,
  DurableProviderAttemptRecord,
  PublicProject,
  Repository,
} from '../types.js'
import type { ProjectSchema } from '../validation.js'
import {
  agentSpikeCandidateDigest,
  agentSpikeIssueDigest,
  agentSpikePreparedDigest,
  canonicalJsonSha256,
  compareAgentSpikeDigest,
} from './agent-stage-commit.js'
import { createDatabase } from './client.js'
import {
  agentAssets,
  agentConversationModelBindings,
  agentProjectContexts,
  agentProjectTaskLeases,
  agentProviderAttempts,
  agentRunCosts,
  agentRunDispatches,
  agentScreenshotArtifacts,
  agentSpikeOperations,
  agentTaskEvents,
  agentTaskOperationalEvents,
  agentTaskPlans,
  agentTaskRuns,
  agentTaskStepAttempts,
  agentTaskSteps,
  agentTaskTransitions,
  agentWorkspaces,
  projectFavorites,
  projectMembers,
  projectPreviewRuns,
  projectPublications,
  projectPublishApprovals,
  projectPublishSnapshots,
  projectReleases,
  projectRevisions,
  projectThumbnailArtifacts,
  projects,
  spaceMembers,
  spaces,
  templates,
  userSettings,
} from './schema.js'

const THUMBNAIL_BUCKET = 'easy-dashboard-thumbnails'
const AGENT_ASSET_BUCKET = 'easy-dashboard-agent-assets'
const AGENT_SCREENSHOT_ARTIFACT_BUCKET = 'easy-dashboard-agent-screenshots'
const MAX_AGENT_SCREENSHOT_ARTIFACT_BYTES = 10 * 1024 * 1024
const AGENT_SCREENSHOT_ARTIFACT_URL_EXPIRES_IN = 60
const agentScreenshotArtifactSelection = {
  id: agentScreenshotArtifacts.id,
  actorId: agentScreenshotArtifacts.actorId,
  projectId: agentScreenshotArtifacts.projectId,
  operationId: agentScreenshotArtifacts.operationId,
  candidateSha256: agentScreenshotArtifacts.candidateSha256,
  draftVersion: agentScreenshotArtifacts.draftVersion,
  contentType: agentScreenshotArtifacts.contentType,
  size: agentScreenshotArtifacts.size,
  sha256: agentScreenshotArtifacts.sha256,
  status: agentScreenshotArtifacts.status,
  storagePath: agentScreenshotArtifacts.storagePath,
  completedAt: agentScreenshotArtifacts.completedAt,
  createdAt: agentScreenshotArtifacts.createdAt,
  updatedAt: agentScreenshotArtifacts.updatedAt,
}
const MAX_AGENT_ASSET_BYTES = 20 * 1024 * 1024
const MAX_AGENT_ASSET_COUNT = 200
const AGENT_ASSET_UPLOAD_STALE_HOURS = 3
const agentAssetPublicSelection = {
  id: agentAssets.id,
  projectId: agentAssets.projectId,
  conversationId: agentAssets.conversationId,
  originalName: agentAssets.originalName,
  contentType: agentAssets.contentType,
  size: agentAssets.size,
  sha256: agentAssets.sha256,
  status: agentAssets.status,
  extractedText: agentAssets.extractedText,
  storagePath: agentAssets.storagePath,
  createdAt: agentAssets.createdAt,
  updatedAt: agentAssets.updatedAt,
}
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024
const THUMBNAIL_UPLOAD_EXPIRES_MS = 2 * 60 * 60 * 1000
const THUMBNAIL_UPLOAD_EXPIRY_SAFETY_MS = 60 * 1000
const THUMBNAIL_UPLOAD_STAGING_EXPIRES_MS = 24 * 60 * 60 * 1000
const THUMBNAIL_CLEANUP_RETRY_MS = 5 * 60 * 1000
const EDITOR_RENDERER_ARTIFACT_VERSION = 'easy-dashboard-editor-renderer-artifact@1'
const EDITOR_RENDERER_ARTIFACT_SHA256 = createHash('sha256').update(EDITOR_RENDERER_ARTIFACT_VERSION).digest('hex')
const EDITOR_BLUEPRINT_ARTIFACT_VERSION = 'easy-dashboard-editor-blueprint-artifact@1'
const EDITOR_BLUEPRINT_ARTIFACT_SHA256 = createHash('sha256').update(EDITOR_BLUEPRINT_ARTIFACT_VERSION).digest('hex')

function cleanAgentPreviewEvidence(evidence: Record<string, unknown> | null): boolean {
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const render = record(evidence?.render)
  const materials = record(evidence?.materials)
  return Boolean(
    evidence &&
      Array.isArray(evidence.consoleErrors) &&
      evidence.consoleErrors.length === 0 &&
      Array.isArray(evidence.requestFailures) &&
      evidence.requestFailures.length === 0 &&
      render?.status === 'rendered' &&
      typeof render.screenshotSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(render.screenshotSha256) &&
      Array.isArray(render.resourceErrors) &&
      render.resourceErrors.length === 0 &&
      Array.isArray(materials?.missing) &&
      materials.missing.length === 0,
  )
}

function completeAgentTaskFinalVerificationEvidence(input: AgentTaskCompletionInput['finalVerification']): boolean {
  return Boolean(
    input &&
      input.operationId.trim() &&
      input.receiptId.trim() &&
      Number.isSafeInteger(input.committedDraftVersion) &&
      input.committedDraftVersion > 0 &&
      Number.isFinite(Date.parse(input.verifiedAt)) &&
      input.documentValid === true &&
      input.renderReady === true &&
      Array.isArray(input.browserErrors) &&
      input.browserErrors.length === 0 &&
      Array.isArray(input.resourceErrors) &&
      input.resourceErrors.length === 0 &&
      input.freshContextVerified === true &&
      input.receiptConsistent === true &&
      input.visualAccepted === true &&
      Number.isFinite(input.visualReviewConfidence) &&
      input.visualReviewConfidence >= 0 &&
      input.visualReviewConfidence <= 1,
  )
}

function reconciledDispatchState(
  operationStatus: AgentSpikeOperationStatus | null,
): Extract<AgentRunDispatchState, 'succeeded' | 'failed' | 'indeterminate'> | null {
  if (operationStatus === 'issued' || operationStatus === 'prepared') return null
  if (operationStatus === 'committed') return 'succeeded'
  if (operationStatus === 'rejected_stale' || operationStatus === 'failed_not_applied') return 'failed'
  return 'indeterminate'
}

function isTransitionProviderAttemptFence(
  fence: AgentProviderAttemptFence,
): fence is Extract<AgentProviderAttemptFence, { kind: 'transition' }> {
  return fence.kind === 'transition'
}

const agentTaskStatusEdges: Readonly<Record<string, readonly string[]>> = {
  planning: ['waiting_user', 'running', 'paused', 'failed', 'canceled'],
  waiting_user: ['planning', 'running', 'canceled'],
  running: ['waiting_user', 'verifying', 'blocked_material', 'paused', 'failed', 'canceled'],
  verifying: ['running', 'completed', 'paused', 'failed', 'canceled'],
  blocked_material: ['running', 'paused', 'canceled'],
  paused: ['running', 'rolling_back', 'failed', 'canceled'],
  completed: ['rolling_back'],
  failed: ['rolling_back'],
  rollback_blocked: ['rolling_back'],
  rolling_back: ['rolled_back', 'rollback_blocked'],
  canceled: [],
  rolled_back: [],
}

const agentStepStatusEdges: Readonly<Record<string, readonly string[]>> = {
  pending: ['running', 'verifying', 'superseded'],
  running: ['verifying', 'revising', 'failed', 'superseded'],
  verifying: ['passed', 'revising', 'failed', 'superseded'],
  revising: ['pending', 'running', 'verifying', 'failed', 'superseded'],
  passed: [],
  failed: [],
  superseded: [],
}

function allowsAgentStateEdge(edges: Readonly<Record<string, readonly string[]>>, from: string, to: string): boolean {
  return from === to || Boolean(edges[from]?.includes(to))
}

interface NormalizedAgentPlanStep {
  id: string
  ordinal: number
  semanticStepKey: string
  title: string
  intent: Record<string, unknown>
}

function normalizedAgentPlanSteps(
  steps: NonNullable<AgentTaskCompletionInput['plan']>['steps'],
): NormalizedAgentPlanStep[] | null {
  if (steps.length < 1 || steps.length > 8) return null
  const ordinals = steps.map(step => step.ordinal)
  if (!ordinals.every((ordinal): ordinal is number => Number.isInteger(ordinal))) return null
  if (!ordinals.every((ordinal, index) => ordinal === index + 1)) return null
  const semanticKeys = steps.map(step => step.id?.trim() ?? '')
  if (
    semanticKeys.some(key => key.length < 1 || key.length > 160) ||
    new Set(semanticKeys).size !== semanticKeys.length
  )
    return null
  return steps.map((step, index) => ({
    id: randomUUID(),
    ordinal: ordinals[index]!,
    semanticStepKey: semanticKeys[index]!,
    title: step.title,
    intent: step.intent,
  }))
}

function agentTaskStepValues(
  taskRunId: string,
  planVersion: number,
  steps: readonly NormalizedAgentPlanStep[],
  now: Date,
): Array<typeof agentTaskSteps.$inferInsert> {
  return steps.map(step => ({
    ...step,
    taskRunId,
    planVersion,
    createdAt: now,
    updatedAt: now,
  }))
}

interface AgentTaskTransitionDigestInput {
  taskRunId: string
  stepId: string | null
  kind: NonNullable<AgentTaskCompletionInput['nextTransition']>['kind']
  transitionKey: string
  availableAt?: Date
  payload: Record<string, unknown>
}

function agentTaskTransitionRequestDigest(input: AgentTaskTransitionDigestInput): string {
  return canonicalJsonSha256({
    taskRunId: input.taskRunId,
    stepId: input.stepId,
    kind: input.kind,
    transitionKey: input.transitionKey,
    availableAt: input.availableAt?.toISOString() ?? null,
    input: input.payload,
  })
}

type AgentTaskClarificationHistoryItem = {
  question: { id: string; text: string }
  response: string
  attachmentIds: string[]
  images: Array<{ assetId: string; sha256: string }>
}

function agentTaskClarificationHistory(value: unknown): AgentTaskClarificationHistoryItem[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 8) return null
  const parsed: AgentTaskClarificationHistoryItem[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
    const item = candidate as Record<string, unknown>
    const question = item.question
    if (!question || typeof question !== 'object' || Array.isArray(question)) return null
    const questionRecord = question as Record<string, unknown>
    if (
      typeof questionRecord.id !== 'string' ||
      !questionRecord.id.trim() ||
      typeof questionRecord.text !== 'string' ||
      !questionRecord.text.trim() ||
      typeof item.response !== 'string' ||
      !item.response.trim() ||
      !Array.isArray(item.attachmentIds) ||
      item.attachmentIds.some(id => typeof id !== 'string') ||
      !Array.isArray(item.images)
    )
      return null
    const images: Array<{ assetId: string; sha256: string }> = []
    for (const image of item.images) {
      if (!image || typeof image !== 'object' || Array.isArray(image)) return null
      const record = image as Record<string, unknown>
      if (
        typeof record.assetId !== 'string' ||
        typeof record.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(record.sha256)
      )
        return null
      images.push({ assetId: record.assetId, sha256: record.sha256 })
    }
    parsed.push({
      question: { id: questionRecord.id, text: questionRecord.text },
      response: item.response,
      attachmentIds: [...item.attachmentIds] as string[],
      images,
    })
  }
  return parsed
}

function agentTaskCompletionRequestDigest(input: AgentTaskCompletionInput): string {
  return canonicalJsonSha256({
    status: input.status,
    output: input.output ?? null,
    error: input.error ?? null,
    taskRunPatch: input.taskRunPatch ?? null,
    accountingDelta: input.accountingDelta ?? null,
    stepPatch: input.stepPatch ?? null,
    plan: input.plan ?? null,
    stepAttempt: input.stepAttempt ?? null,
    finalVerification: input.finalVerification ?? null,
    events: input.events ?? [],
    nextTransition: input.nextTransition
      ? {
          ...input.nextTransition,
          availableAt: input.nextTransition.availableAt?.toISOString() ?? null,
        }
      : null,
  })
}

const agentTaskProjectLeaseReleaseStatuses = new Set([
  'waiting_user',
  'blocked_material',
  'paused',
  'completed',
  'failed',
  'canceled',
  'rolled_back',
  'rollback_blocked',
])

class AgentTaskCompletionRollback extends Error {
  override readonly name = 'AgentTaskCompletionRollback'

  constructor(readonly result: 'stale' | 'invalid_state' | 'conflict') {
    super(result)
  }
}

const agentTaskPublicProtocolKeys = new Set([
  'changeset',
  'componentname',
  'coordinates',
  'fieldid',
  'fieldpath',
  'height',
  'nodeid',
  'operation',
  'operations',
  'parentid',
  'props',
  'rect',
  'shared',
  'width',
  'x',
  'y',
])
const agentTaskPublicRedacted = Symbol('agent-task-public-redacted')

function sanitizePublicAgentTaskValue(value: unknown): unknown | typeof agentTaskPublicRedacted {
  if (typeof value === 'string')
    return isAgentConversationImplementationDetailText(value) ? agentTaskPublicRedacted : value
  if (Array.isArray(value))
    return value
      .map(sanitizePublicAgentTaskValue)
      .filter(
        (entry): entry is Exclude<typeof entry, typeof agentTaskPublicRedacted> => entry !== agentTaskPublicRedacted,
      )
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !agentTaskPublicProtocolKeys.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase()))
      .map(([key, nested]) => [key, sanitizePublicAgentTaskValue(nested)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== agentTaskPublicRedacted),
  )
}

function sanitizePublicAgentTaskEvent(
  event: Pick<NonNullable<AgentTaskCompletionInput['events']>[number], 'summary' | 'publicPayload'>,
): { summary: string; publicPayload: Record<string, unknown> } {
  return {
    summary: isAgentConversationImplementationDetailText(event.summary) ? 'Agent activity updated.' : event.summary,
    publicPayload: sanitizePublicAgentTaskValue(event.publicPayload ?? {}) as Record<string, unknown>,
  }
}

type AgentConversationModelIdentity = Pick<
  typeof agentConversationModelBindings.$inferSelect,
  'provider' | 'model' | 'profileId' | 'configDigest'
>

function matchesAgentConversationModel(
  binding: AgentConversationModelIdentity,
  expected: AgentConversationModelIdentity,
): boolean {
  return (
    binding.provider === expected.provider &&
    binding.model === expected.model &&
    binding.profileId === expected.profileId &&
    binding.configDigest === expected.configDigest
  )
}

type AgentTaskLeaseIdentity = Pick<AgentTaskTransitionFence, 'workerId' | 'leaseGeneration' | 'leaseToken'>

function matchesAgentTaskLease(
  transition: Pick<typeof agentTaskTransitions.$inferSelect, 'leaseOwner' | 'leaseGeneration' | 'leaseToken'>,
  fence: AgentTaskLeaseIdentity,
): boolean {
  return (
    transition.leaseGeneration === fence.leaseGeneration &&
    transition.leaseToken === fence.leaseToken &&
    transition.leaseOwner === fence.workerId
  )
}

function agentTaskTransitionRequiresProjectLease(kind: string): boolean {
  return kind !== 'planning'
}

function matchesAgentProjectTaskLease(
  transition: Pick<
    typeof agentTaskTransitions.$inferSelect,
    'projectLeaseGeneration' | 'projectLeaseToken' | 'projectLeaseWorkerId'
  >,
  fence: AgentTaskTransitionFence,
): boolean {
  return (
    transition.projectLeaseGeneration === fence.projectLeaseGeneration &&
    transition.projectLeaseToken === fence.projectLeaseToken &&
    transition.projectLeaseWorkerId === fence.projectLeaseWorkerId &&
    fence.projectLeaseWorkerId === fence.workerId
  )
}

class ThumbnailConflictRollback extends Error {
  override readonly name = 'ThumbnailConflictRollback'
}

class AgentUndoConflictRollback extends Error {
  override readonly name = 'AgentUndoConflictRollback'
}

export function signedThumbnailUploadCleanupExpiry(token: string, signedAt = Date.now()): Date {
  const documentedExpiry = signedAt + THUMBNAIL_UPLOAD_EXPIRES_MS
  let tokenExpiry = 0
  try {
    const payload = token.split('.')[1]
    if (payload) {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
      if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) {
        tokenExpiry = decoded.exp * 1000
      }
    }
  } catch {
    // Supabase currently returns a JWT, but the documented two-hour lifetime
    // remains the conservative fallback if its token representation changes.
  }
  return new Date(Math.max(documentedExpiry, tokenExpiry) + THUMBNAIL_UPLOAD_EXPIRY_SAFETY_MS)
}

export function thumbnailRequestedVersionCase(nextDraftVersion: number) {
  return sql<number>`case
    when ${projects.thumbnailMode} = 'auto' then cast(${nextDraftVersion} as integer)
    else null
  end`
}

function projectMetadata(schema: ProjectSchema): {
  pageCount: number
  canvasWidth: number
  canvasHeight: number
  startPageId: string | null
} {
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const envelope = record(schema)
  const editorSchema = record(envelope?.editorSchema) ?? envelope
  const presentation = record(envelope?.presentation)
  const pages = Array.isArray(editorSchema?.componentsTree) ? editorSchema.componentsTree : []
  const requestedStartPageId =
    typeof presentation?.startPageId === 'string' && presentation.startPageId ? presentation.startPageId : null
  const pageId = (page: unknown): string | null => {
    const pageRecord = record(page)
    const meta = record(pageRecord?.meta)
    const easyDashboard = record(meta?.easyDashboard)
    for (const candidate of [easyDashboard?.pageId, pageRecord?.docId, pageRecord?.id]) {
      if (typeof candidate === 'string' && candidate) return candidate
    }
    return null
  }
  const startPage = pages.find(page => pageId(page) === requestedStartPageId) ?? pages[0]
  const startPageRecord = record(startPage)
  const dashboard = record(startPageRecord?.$dashboard)
  const rect = record(dashboard?.rect)
  return {
    pageCount: Math.max(1, pages.length),
    canvasWidth: typeof rect?.width === 'number' && rect.width > 0 ? Math.round(rect.width) : 1920,
    canvasHeight: typeof rect?.height === 'number' && rect.height > 0 ? Math.round(rect.height) : 1080,
    startPageId: requestedStartPageId ?? pageId(startPage),
  }
}

function toAgentProjectContextRecord(row: typeof agentProjectContexts.$inferSelect): AgentProjectContextRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    content: row.content,
    status: 'confirmed',
    revision: row.revision,
    history: row.history,
    ...(row.sourceTaskId ? { sourceTaskId: row.sourceTaskId } : {}),
    ...(row.provenance ? { provenance: row.provenance } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    confirmedAt: row.confirmedAt,
  }
}

function slugify(value: string, id: string): string {
  const base = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 54)
  return `${base || 'dashboard'}-${id.slice(0, 8)}`
}

function aggregateAgentRunCostRows(rows: readonly AgentRunCostRecord[]): AgentRunCostRecord | null {
  const latest = rows[0]
  if (!latest) return null
  const chargedRows = rows.filter(row => row.state !== 'released')
  if (chargedRows.length === 0) {
    return {
      ...latest,
      reservedMicros: 0,
      settledMicros: 0,
      minimumMicros: null,
      maximumMicros: null,
      promptTokens: null,
      completionTokens: null,
      createdAt: rows.reduce(
        (earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest),
        latest.createdAt,
      ),
      updatedAt: rows.reduce((newest, row) => (row.updatedAt > newest ? row.updatedAt : newest), latest.updatedAt),
    }
  }
  const sumNullable = (select: (row: AgentRunCostRecord) => number | null): number | null => {
    const values = chargedRows.flatMap(row => {
      const value = select(row)
      return value === null ? [] : [value]
    })
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)
  }
  const state: AgentRunCostRecord['state'] = chargedRows.some(row => row.state === 'reserved') ? 'reserved' : 'settled'
  const accuracy = chargedRows.some(row => row.accuracy === 'billing_indeterminate')
    ? 'billing_indeterminate'
    : chargedRows.some(row => row.accuracy === 'estimated')
      ? 'estimated'
      : chargedRows.every(row => row.accuracy === 'actual')
        ? 'actual'
        : null
  return {
    ...latest,
    state,
    accuracy,
    reservedMicros: chargedRows.reduce((sum, row) => sum + row.reservedMicros, 0),
    settledMicros: chargedRows.reduce((sum, row) => sum + row.settledMicros, 0),
    minimumMicros: chargedRows.reduce(
      (sum, row) => sum + (row.minimumMicros ?? (row.state === 'settled' ? row.settledMicros : 0)),
      0,
    ),
    maximumMicros: chargedRows.reduce(
      (sum, row) => sum + (row.maximumMicros ?? (row.state === 'reserved' ? row.reservedMicros : row.settledMicros)),
      0,
    ),
    promptTokens: sumNullable(row => row.promptTokens),
    completionTokens: sumNullable(row => row.completionTokens),
    createdAt: rows.reduce((earliest, row) => (row.createdAt < earliest ? row.createdAt : earliest), latest.createdAt),
    updatedAt: rows.reduce((newest, row) => (row.updatedAt > newest ? row.updatedAt : newest), latest.updatedAt),
  }
}

function durableProviderAttempt(
  row: typeof agentProviderAttempts.$inferSelect,
  idempotencyMode: 'unsupported' | 'stable',
): DurableProviderAttemptRecord {
  return {
    id: row.id,
    state: row.state,
    providerRequestKey: row.providerRequestKey,
    requestBodyDigest: row.requestBodyDigest,
    idempotencyMode,
  }
}

function durableTurnFromDispatch(row: typeof agentRunDispatches.$inferSelect): DurableAgentTurnRecord | null {
  const snapshot = row.inputSnapshot
  const providerInputSnapshot = durableProviderInputSnapshot(snapshot?.providerInputSnapshot)
  if (
    !row.turnId ||
    !row.inputDigest ||
    !row.frozenProvider ||
    !row.frozenModel ||
    !row.frozenProfile ||
    !row.billingScope ||
    !row.payerId ||
    row.taskLimitMicros === null ||
    row.projectLimitMicros === null ||
    !row.providerIdempotency ||
    !snapshot ||
    typeof snapshot.prompt !== 'string' ||
    typeof snapshot.endpoint !== 'string' ||
    typeof snapshot.reservedMicros !== 'number' ||
    typeof snapshot.projectDraftVersion !== 'number' ||
    typeof snapshot.maximumRateMicrosPerToken !== 'number' ||
    snapshot.maximumRateMicrosPerToken <= 0 ||
    !providerInputSnapshot ||
    !Array.isArray(snapshot.attachmentIds) ||
    !snapshot.attachmentIds.every(value => typeof value === 'string') ||
    !Array.isArray(snapshot.projectContext)
  ) {
    return null
  }
  const projectContext: DurableAgentTurnRecord['projectContext'] = snapshot.projectContext.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const item = value as Record<string, unknown>
    if (
      typeof item.title !== 'string' ||
      typeof item.content !== 'string' ||
      (item.status !== 'pending' && item.status !== 'confirmed')
    )
      return []
    return [{ title: item.title, content: item.content, status: item.status }]
  })
  if (projectContext.length !== snapshot.projectContext.length) return null
  return {
    actorId: row.actorId,
    projectId: row.projectId,
    conversationId: row.conversationId,
    taskId: row.taskId,
    turnId: row.turnId,
    operationId: row.operationId,
    inputDigest: row.inputDigest,
    prompt: snapshot.prompt,
    attachmentIds: [...snapshot.attachmentIds],
    projectContext,
    provider: row.frozenProvider,
    model: row.frozenModel,
    profileId: row.frozenProfile,
    endpoint: snapshot.endpoint,
    billingScope: row.billingScope,
    payerId: row.payerId,
    taskLimitMicros: row.taskLimitMicros,
    projectMonthLimitMicros: row.projectLimitMicros,
    projectDraftVersion: snapshot.projectDraftVersion,
    reservedMicros: snapshot.reservedMicros,
    maximumRateMicrosPerToken: snapshot.maximumRateMicrosPerToken,
    providerInputSnapshot,
    idempotencyMode: row.providerIdempotency,
    providerRequestKey: typeof snapshot.providerRequestKey === 'string' ? snapshot.providerRequestKey : null,
  }
}

function durableProviderInputSnapshot(value: unknown): AgentProviderInputSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  const trace = snapshot.trace
  const traceRecord =
    trace && typeof trace === 'object' && !Array.isArray(trace) ? (trace as Record<string, unknown>) : null
  const skills = traceRecord?.skills
  if (
    typeof snapshot.systemPrompt !== 'string' ||
    typeof snapshot.userText !== 'string' ||
    !traceRecord ||
    typeof traceRecord.promptBundleId !== 'string' ||
    typeof traceRecord.promptBundleVersion !== 'string' ||
    typeof traceRecord.promptBundleHash !== 'string' ||
    !Array.isArray(skills) ||
    !skills.every(skill => typeof skill === 'string') ||
    !Array.isArray(snapshot.images)
  ) {
    return null
  }
  const images = snapshot.images.flatMap(image => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return []
    const record = image as Record<string, unknown>
    return typeof record.assetId === 'string' && typeof record.sha256 === 'string'
      ? [{ assetId: record.assetId, sha256: record.sha256 }]
      : []
  })
  if (images.length !== snapshot.images.length) return null
  return {
    systemPrompt: snapshot.systemPrompt,
    userText: snapshot.userText,
    trace: {
      promptBundleId: traceRecord.promptBundleId,
      promptBundleVersion: traceRecord.promptBundleVersion,
      promptBundleHash: traceRecord.promptBundleHash,
      skills: [...skills],
    },
    images,
  }
}

export function createPgRepository(env: AppEnv): Repository {
  const { db, pool } = createDatabase(env)
  const withActor = <T>(
    actorId: string,
    run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  ) =>
    db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`)
      return run(tx)
    })
  const withActorSnapshot = <T>(
    actorId: string,
    run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  ) =>
    db.transaction(
      async tx => {
        await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`)
        return run(tx)
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )

  const lockUserSettings = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actorId: string) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:user-settings`}, 0))`)

  const ensurePersonalSpaceWithTx = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
  ): Promise<string> => {
    const [created] = await tx
      .insert(spaces)
      .values({
        kind: 'personal',
        name: 'Personal space',
        personalOwnerId: actorId,
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: spaces.id })
    const [space] = created
      ? [created]
      : await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.personalOwnerId, actorId)).limit(1)
    if (!space) throw new Error('Personal space provisioning returned no row')
    await tx
      .insert(spaceMembers)
      .values({ spaceId: space.id, userId: actorId, role: 'owner' })
      .onConflictDoNothing({ target: [spaceMembers.spaceId, spaceMembers.userId] })
    return space.id
  }

  const insertProjectOwnerMembership = (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    projectId: string,
    actorId: string,
  ) =>
    tx.insert(projectMembers).values({
      projectId,
      userId: actorId,
      role: 'owner',
      createdBy: actorId,
    })

  const projectSummarySelection = (actorId: string) => ({
    id: projects.id,
    name: projects.name,
    description: projects.description,
    coverUrl: projects.coverUrl,
    draftVersion: projects.draftVersion,
    isFavorite: sql<boolean>`exists (
      select 1 from ${projectFavorites}
      where ${projectFavorites.projectId} = ${projects.id}
        and ${projectFavorites.userId} = ${actorId}
    )`,
    pageCount: projects.pageCount,
    canvasWidth: projects.canvasWidth,
    canvasHeight: projects.canvasHeight,
    startPageId: projects.startPageId,
    draftSavedAt: projects.draftSavedAt,
    thumbnailMode: projects.thumbnailMode,
    thumbnailStatus: projects.thumbnailStatus,
    thumbnailPath: projects.thumbnailPath,
    thumbnailUrl: projects.thumbnailUrl,
    thumbnailDraftVersion: projects.thumbnailDraftVersion,
    thumbnailErrorCode: projects.thumbnailErrorCode,
    publicationSlug: projectPublications.slug,
    publishedRevisionId: projectPublications.revisionId,
    publishedAt: projectPublications.publishedAt,
    currentReleaseNumber: projectReleases.releaseNumber,
    deletedAt: projects.deletedAt,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
  })

  const projectDetailSelection = (actorId: string) => ({
    ...projectSummarySelection(actorId),
    draftSchema: projects.draftSchema,
  })

  const canReadProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projectMembers}
    where ${projectMembers.projectId} = ${projects.id}
      and ${projectMembers.userId} = ${actorId}
  )`

  const canEditProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projectMembers}
    where ${projectMembers.projectId} = ${projects.id}
      and ${projectMembers.userId} = ${actorId}
      and ${projectMembers.role} in ('owner', 'editor')
  )`

  const canReadAgentTaskProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projects}
    inner join ${projectMembers} on ${projectMembers.projectId} = ${projects.id}
    where ${projects.id} = ${agentTaskRuns.projectId}
      and ${projects.deletedAt} is null
      and ${projectMembers.userId} = ${actorId}
  )`

  const canEditAgentTaskProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projects}
    inner join ${projectMembers} on ${projectMembers.projectId} = ${projects.id}
    where ${projects.id} = ${agentTaskRuns.projectId}
      and ${projects.deletedAt} is null
      and ${projectMembers.userId} = ${actorId}
      and ${projectMembers.role} in ('owner', 'editor')
  )`

  const canOwnProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${projectMembers}
    where ${projectMembers.projectId} = ${projects.id}
      and ${projectMembers.userId} = ${actorId}
      and ${projectMembers.role} = 'owner'
  )`

  const canEditAgentAssetProject = (actorId: string) => sql<boolean>`exists (
    select 1
    from ${projects}
    inner join ${projectMembers} on ${projectMembers.projectId} = ${projects.id}
    where ${projects.id} = ${agentAssets.projectId}
      and ${projects.deletedAt} is null
      and ${projectMembers.userId} = ${actorId}
      and ${projectMembers.role} in ('owner', 'editor')
  )`

  const lockAgentSpikeOperation = (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    operationId: string,
  ) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:${operationId}`}, 0))`)

  const selectAgentSpikeOperation = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    operationId: string,
    lock = false,
  ): Promise<AgentSpikeOperationRecord | null> => {
    const query = tx
      .select()
      .from(agentSpikeOperations)
      .where(and(eq(agentSpikeOperations.actorId, actorId), eq(agentSpikeOperations.operationId, operationId)))
    const rows = lock ? await query.for('update').limit(1) : await query.limit(1)
    return (rows[0] as AgentSpikeOperationRecord | undefined) ?? null
  }

  const agentSpikeBindingMatches = (
    operation: AgentSpikeOperationRecord,
    binding: AgentSpikeOperationBinding,
  ): boolean =>
    operation.projectId === binding.projectId &&
    operation.taskId === binding.taskId &&
    operation.stageId === binding.stageId &&
    operation.executorId === binding.executorId &&
    operation.operationId === binding.operationId

  const agentRunDispatchAllowsOperation = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    operationId: string,
    authority: AgentMutationAuthority,
  ): Promise<{ dispatchExists: boolean; allowed: boolean }> => {
    const result = (await tx.execute(sql`
      select
        dispatch.id,
        dispatch.state,
        dispatch.desired_state,
        dispatch.lease_owner,
        dispatch.generation,
        dispatch.lease_until > now() as lease_active
      from app.agent_run_dispatches as dispatch
      where dispatch.actor_id = ${actorId}
        and dispatch.operation_id = ${operationId}
      limit 1
      for update
    `)) as unknown as {
      rows?: Array<{
        id: string
        state: string
        desired_state: string
        lease_owner: string | null
        generation: number
        lease_active: boolean
      }>
    }
    const dispatch = result?.rows?.[0]
    if (!dispatch) return { dispatchExists: false, allowed: !authority.dispatchAttempt }
    const attempt = authority.dispatchAttempt
    return {
      dispatchExists: true,
      allowed:
        !!attempt &&
        attempt.dispatchId === dispatch.id &&
        attempt.workerId === dispatch.lease_owner &&
        attempt.leaseGeneration === dispatch.generation &&
        dispatch.state === 'running' &&
        dispatch.desired_state === 'running' &&
        dispatch.lease_active === true,
    }
  }

  const thumbnailStorage = (accessToken: string) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }).storage.from(THUMBNAIL_BUCKET)
  const agentAssetStorage = (accessToken: string) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }).storage.from(AGENT_ASSET_BUCKET)
  const agentScreenshotArtifactStorage = (accessToken: string) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }).storage.from(AGENT_SCREENSHOT_ARTIFACT_BUCKET)
  const agentScreenshotArtifactAdminStorage = (secretKey: string) =>
    createClient(env.SUPABASE_URL, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).storage.from(AGENT_SCREENSHOT_ARTIFACT_BUCKET)

  const failAgentAssetUpload = async (actorId: string, accessToken: string, id: string) => {
    const failed = await withActor(actorId, async tx => {
      const [updated] = await tx
        .update(agentAssets)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(agentAssets.id, id), eq(agentAssets.actorId, actorId), eq(agentAssets.status, 'uploading')))
        .returning({ storagePath: agentAssets.storagePath })
      return updated?.storagePath ?? null
    })
    if (!failed) return
    await agentAssetStorage(accessToken)
      .remove([failed])
      .catch(() => undefined)
  }

  const selectProjectDetail = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    projectId: string,
    deleted: 'active' | 'trashed' = 'active',
  ) => {
    const [project] = await tx
      .select(projectDetailSelection(actorId))
      .from(projects)
      .leftJoin(
        projectPublications,
        and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
      )
      .leftJoin(
        projectReleases,
        and(eq(projectReleases.projectId, projects.id), eq(projectReleases.revisionId, projectPublications.revisionId)),
      )
      .where(
        and(
          eq(projects.id, projectId),
          canReadProject(actorId),
          deleted === 'active' ? isNull(projects.deletedAt) : isNotNull(projects.deletedAt),
        ),
      )
      .limit(1)
    return project ?? null
  }

  const insertRevision = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    input: {
      actorId: string
      projectId: string
      schema: ProjectSchema
      kind: 'auto' | 'manual' | 'pre_restore' | 'publish' | 'agent'
      sourceDraftVersion: number
      label?: string | null
    },
  ) => {
    const [latest] = await tx
      .select({ value: max(projectRevisions.revisionNumber) })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, input.projectId))
    const [revision] = await tx
      .insert(projectRevisions)
      .values({
        projectId: input.projectId,
        revisionNumber: (latest?.value ?? 0) + 1,
        schema: input.schema,
        kind: input.kind,
        sourceDraftVersion: input.sourceDraftVersion,
        label: input.label ?? null,
        createdBy: input.actorId,
      })
      .returning()
    if (!revision) throw new Error('Revision insert returned no row')
    return revision
  }

  const toPublicProject = (row: {
    slug: string
    projectId: string
    name: string
    description: string | null
    revisionId: string
    revisionNumber: number
    releaseNumber: number
    schema: ProjectSchema
    publishedAt: Date
  }): PublicProject => row

  const reconcileThumbnailArtifacts = async (actorId: string, accessToken: string, projectId: string) => {
    const now = new Date()
    const candidates = await withActor(actorId, async tx => {
      const [project] = await tx
        .select({
          id: projects.id,
          deletedAt: projects.deletedAt,
          currentPath: projects.thumbnailPath,
          pendingPath: projects.thumbnailPendingPath,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), canEditProject(actorId)))
        .for('update')
        .limit(1)
      if (!project) return null

      await tx
        .update(projectThumbnailArtifacts)
        .set({
          status: 'cleanup_pending',
          nextCleanupAt: now,
          lastError: 'upload-expired',
          updatedAt: now,
        })
        .where(
          and(
            eq(projectThumbnailArtifacts.projectId, projectId),
            eq(projectThumbnailArtifacts.status, 'pending'),
            lte(projectThumbnailArtifacts.expiresAt, now),
          ),
        )

      if (project.pendingPath) {
        const [pending] = await tx
          .select({ status: projectThumbnailArtifacts.status })
          .from(projectThumbnailArtifacts)
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, project.pendingPath),
            ),
          )
          .limit(1)
        if (pending?.status === 'cleanup_pending') {
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-expired',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(and(eq(projects.id, projectId), eq(projects.thumbnailPendingPath, project.pendingPath)))
        }
      }

      if (project.deletedAt) {
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, ${now})`,
            updatedAt: now,
          })
          .where(
            and(eq(projectThumbnailArtifacts.projectId, projectId), ne(projectThumbnailArtifacts.status, 'deleted')),
          )
        await tx
          .update(projects)
          .set({
            thumbnailPath: null,
            thumbnailUrl: null,
            thumbnailDraftVersion: null,
            thumbnailStatus: 'queued',
            thumbnailErrorCode: null,
            thumbnailRequestedVersion: null,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
          })
          .where(eq(projects.id, projectId))
      }

      return tx
        .select({ path: projectThumbnailArtifacts.path })
        .from(projectThumbnailArtifacts)
        .where(
          and(
            eq(projectThumbnailArtifacts.projectId, projectId),
            eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
            or(isNull(projectThumbnailArtifacts.nextCleanupAt), lte(projectThumbnailArtifacts.nextCleanupAt, now)),
            project.deletedAt || !project.currentPath
              ? undefined
              : ne(projectThumbnailArtifacts.path, project.currentPath),
          ),
        )
    })
    if (!candidates) return null

    let deleted = 0
    let retryPending = 0
    for (const candidate of candidates) {
      const { error } = await thumbnailStorage(accessToken).remove([candidate.path])
      if (!error) {
        const removed = await withActor(actorId, async tx => {
          const [artifact] = await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'deleted',
              deletedAt: new Date(),
              nextCleanupAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, candidate.path),
                eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
                sql`not exists (
                  select 1 from ${projects}
                  where ${projects.id} = ${projectId}
                    and ${projects.thumbnailPath} = ${candidate.path}
                )`,
              ),
            )
            .returning({ id: projectThumbnailArtifacts.id })
          return Boolean(artifact)
        })
        if (removed) deleted += 1
        continue
      }

      retryPending += 1
      await withActor(actorId, async tx => {
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            cleanupAttempts: sql`${projectThumbnailArtifacts.cleanupAttempts} + 1`,
            nextCleanupAt: new Date(Date.now() + THUMBNAIL_CLEANUP_RETRY_MS),
            lastError: error.message.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, candidate.path),
              eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
            ),
          )
      })
    }
    return { deleted, retryPending }
  }

  const unknownProviderOutcomeAccountingPendingErrorCodes = new Set([
    'provider_outcome_unknown',
    'transition_attempt_stale',
    'transition_generation_reclaimed',
  ])

  const unknownProviderOutcomeAccountingAlreadyApplied = (
    attempt: Pick<typeof agentProviderAttempts.$inferSelect, 'state' | 'errorCode'>,
  ): boolean =>
    attempt.state === 'outcome_unknown' &&
    !unknownProviderOutcomeAccountingPendingErrorCodes.has(attempt.errorCode ?? '')

  const pauseTransitionForUnknownProviderOutcome = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    transition: typeof agentTaskTransitions.$inferSelect,
    attempt: typeof agentProviderAttempts.$inferSelect,
    now: Date,
    evidence?: {
      event?: NonNullable<AgentTaskCompletionInput['events']>[number]
      operationalEvent?: {
        dedupeKey: string
        code: string
        severity: 'info' | 'warning' | 'error' | 'critical'
        details?: Record<string, unknown>
      }
      providerObservation?: {
        promptTokens?: number
        completionTokens?: number
        cachedTokens?: number
        durationMs?: number
        upstreamRequestId?: string
      }
      accountingAlreadyApplied?: boolean
    },
  ) => {
    if (!['started', 'outcome_unknown'].includes(attempt.state)) return 'invalid_state' as const
    if (!['leased', 'failed'].includes(transition.status)) return 'stale' as const
    const needsProjectLease = agentTaskTransitionRequiresProjectLease(transition.kind)
    if (needsProjectLease) {
      if (
        transition.projectLeaseGeneration === null ||
        transition.projectLeaseToken === null ||
        transition.projectLeaseWorkerId === null
      )
        return 'stale' as const
      const [projectLease] = await tx
        .select({ projectId: agentProjectTaskLeases.projectId })
        .from(agentProjectTaskLeases)
        .where(
          and(
            eq(agentProjectTaskLeases.projectId, transition.projectId),
            eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
            eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration),
            eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken),
            eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId),
          ),
        )
        .for('update')
        .limit(1)
      if (!projectLease) return 'stale' as const
    }
    const [run] = await tx
      .select()
      .from(agentTaskRuns)
      .where(eq(agentTaskRuns.id, transition.taskRunId))
      .for('update')
      .limit(1)
    if (!run) return 'stale' as const

    const eventKey = evidence?.event?.eventKey ?? `provider-outcome-unknown:${transition.id}`
    const operationalDedupeKey = evidence?.operationalEvent?.dedupeKey ?? eventKey
    const [existingEvent] = await tx
      .select({ seq: agentTaskEvents.seq })
      .from(agentTaskEvents)
      .where(and(eq(agentTaskEvents.taskRunId, run.id), eq(agentTaskEvents.eventKey, eventKey)))
      .limit(1)
    const [existingOperationalEvent] = await tx
      .select({ id: agentTaskOperationalEvents.id })
      .from(agentTaskOperationalEvents)
      .where(eq(agentTaskOperationalEvents.dedupeKey, operationalDedupeKey))
      .limit(1)

    let reconciledAttempt = attempt
    if (attempt.state === 'started') {
      const [updatedAttempt] = await tx
        .update(agentProviderAttempts)
        .set({
          state: 'outcome_unknown',
          costAccuracy: 'billing_indeterminate',
          amountMicros: attempt.reservationDeltaMicros,
          minimumMicros: 0,
          maximumMicros: attempt.reservationDeltaMicros,
          promptTokens: evidence?.providerObservation?.promptTokens ?? attempt.promptTokens,
          completionTokens: evidence?.providerObservation?.completionTokens ?? attempt.completionTokens,
          cachedTokens: evidence?.providerObservation?.cachedTokens ?? attempt.cachedTokens,
          durationMs: evidence?.providerObservation?.durationMs ?? attempt.durationMs,
          upstreamRequestId: evidence?.providerObservation?.upstreamRequestId ?? attempt.upstreamRequestId,
          errorCode: 'provider_outcome_unknown',
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(agentProviderAttempts.id, attempt.id), eq(agentProviderAttempts.state, 'started')))
        .returning()
      if (!updatedAttempt) return 'stale' as const
      reconciledAttempt = updatedAttempt
    }

    let nextEventSequence = run.nextEventSequence
    if (!existingEvent) {
      const event =
        evidence?.event ??
        ({
          eventKey,
          type: 'waiting_user',
          summary: 'Execution paused because the provider outcome could not be confirmed.',
          publicPayload: { state: 'paused', reason: 'provider_outcome_unknown' },
          technicalPayload: { providerAttemptId: attempt.id, transitionId: transition.id },
          redactionVersion: 1,
        } satisfies NonNullable<AgentTaskCompletionInput['events']>[number])
      const publicEvent = sanitizePublicAgentTaskEvent(event)
      await tx.insert(agentTaskEvents).values({
        taskRunId: run.id,
        seq: nextEventSequence++,
        eventKey,
        stepId: transition.stepId,
        type: event.type,
        summary: publicEvent.summary,
        publicPayload: publicEvent.publicPayload,
        technicalPayload: event.technicalPayload ?? {},
        redactionVersion: event.redactionVersion ?? 1,
        createdAt: now,
      })
    }
    if (!existingOperationalEvent)
      await tx.insert(agentTaskOperationalEvents).values({
        dedupeKey: operationalDedupeKey,
        actorId,
        projectId: run.projectId,
        taskRunId: run.id,
        transitionId: transition.id,
        operationId: transition.operationId,
        code: evidence?.operationalEvent?.code ?? 'agent_task_provider_outcome_unknown',
        severity: evidence?.operationalEvent?.severity ?? 'critical',
        details: evidence?.operationalEvent?.details ?? { providerAttemptId: attempt.id },
        createdAt: now,
      })

    const shouldApplyAccounting = !existingOperationalEvent && !evidence?.accountingAlreadyApplied
    await tx
      .update(agentTaskRuns)
      .set({
        status: 'paused',
        currentTransitionKey: null,
        providerTurns: run.providerTurns + (shouldApplyAccounting ? 1 : 0),
        promptTokens: run.promptTokens + (shouldApplyAccounting ? (reconciledAttempt.promptTokens ?? 0) : 0),
        completionTokens:
          run.completionTokens + (shouldApplyAccounting ? (reconciledAttempt.completionTokens ?? 0) : 0),
        costMicros: run.costMicros + (shouldApplyAccounting ? attempt.reservationDeltaMicros : 0),
        nextEventSequence,
        updatedAt: now,
      })
      .where(eq(agentTaskRuns.id, run.id))
    if (needsProjectLease)
      await tx
        .update(agentProjectTaskLeases)
        .set({ leaseUntil: now, heartbeatAt: now, updatedAt: now })
        .where(
          and(
            eq(agentProjectTaskLeases.projectId, transition.projectId),
            eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
            eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
            eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
            eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
          ),
        )
    const [pausedTransition] = await tx
      .update(agentTaskTransitions)
      .set({
        status: 'failed',
        error: { code: 'provider_outcome_unknown' },
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(agentTaskTransitions.id, transition.id), inArray(agentTaskTransitions.status, ['leased', 'failed'])),
      )
      .returning()
    if (!pausedTransition) return 'stale' as const
    return { transition: pausedTransition, attempt: reconciledAttempt }
  }

  return {
    async ping() {
      await pool.query(`
        select
          releases.release_number,
          releases.publish_snapshot_id,
          publish_snapshots.document_sha256,
          preview_runs.renderer_sha256,
          publish_approvals.consumed_release_id,
          releases.name,
          releases.description,
          thumbnail_artifacts.path,
          thumbnail_artifacts.status,
          agent_operations.status as agent_operation_status,
          agent_screenshot_artifacts.status as agent_screenshot_artifact_status,
          agent_costs.billing_scope as agent_cost_billing_scope,
          agent_costs.payer_id as agent_cost_payer_id,
          agent_costs.turn_id as agent_cost_turn_id,
          agent_costs.decision_output as agent_cost_decision_output,
          agent_costs.decision_usage as agent_cost_decision_usage,
          agent_costs.decision_trace as agent_cost_decision_trace,
          agent_dispatches.desired_state as agent_dispatch_desired_state,
          agent_dispatches.generation as agent_dispatch_generation,
          agent_task_runs.status as agent_task_run_status,
          agent_task_transitions.lease_token as agent_task_transition_lease_token,
          agent_task_events.redaction_version as agent_task_event_redaction_version,
          agent_provider_attempts.task_transition_id as agent_provider_attempt_transition_id,
          agent_assets.idempotency_key as agent_asset_idempotency_key,
          agent_assets.storage_cleanup_status as agent_asset_storage_cleanup_status,
          agent_assets.storage_cleanup_attempts as agent_asset_storage_cleanup_attempts,
          project_members.role as project_member_role,
          projects.agent_model_configuration,
          projects.agent_start_idempotency_key,
          projects.agent_start_input_digest,
          projects.permanent_delete_token,
          projects.permanent_delete_started_at
        from app.project_releases as releases
        cross join app.project_publish_snapshots as publish_snapshots
        cross join app.project_preview_runs as preview_runs
        cross join app.project_publish_approvals as publish_approvals
        cross join app.project_thumbnail_artifacts as thumbnail_artifacts
        cross join app.agent_spike_operations as agent_operations
        cross join app.agent_screenshot_artifacts as agent_screenshot_artifacts
        cross join app.agent_run_costs as agent_costs
        cross join app.agent_run_dispatches as agent_dispatches
        cross join app.agent_task_runs as agent_task_runs
        cross join app.agent_task_transitions as agent_task_transitions
        cross join app.agent_task_events as agent_task_events
        cross join app.agent_provider_attempts as agent_provider_attempts
        cross join app.agent_assets as agent_assets
        cross join app.project_members as project_members
        cross join app.projects as projects
        limit 0
      `)
    },
    resolveAgentConversationModelBinding(actorId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const [existing] = await tx
          .select()
          .from(agentConversationModelBindings)
          .where(
            and(
              eq(agentConversationModelBindings.projectId, input.projectId),
              eq(agentConversationModelBindings.conversationId, input.conversationId),
            ),
          )
          .limit(1)
        if (existing) {
          return matchesAgentConversationModel(existing, input) ? existing : 'configuration_drift'
        }
        const [binding] = await tx
          .insert(agentConversationModelBindings)
          .values({
            actorId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            provider: input.provider,
            model: input.model,
            profileId: input.profileId,
            configDigest: input.configDigest,
            boundAt: input.now,
            createdAt: input.now,
          })
          .onConflictDoNothing()
          .returning()
        if (binding) return binding
        const [concurrent] = await tx
          .select()
          .from(agentConversationModelBindings)
          .where(
            and(
              eq(agentConversationModelBindings.projectId, input.projectId),
              eq(agentConversationModelBindings.conversationId, input.conversationId),
            ),
          )
          .limit(1)
        if (!concurrent) return null
        return matchesAgentConversationModel(concurrent, input) ? concurrent : 'configuration_drift'
      })
    },
    createAgentTaskRun(actorId, input) {
      return withActor(actorId, async tx => {
        const requestDigest = canonicalJsonSha256({
          projectId: input.projectId,
          conversationId: input.conversationId,
          taskId: input.taskId,
          binding: input.binding,
          bounds: input.bounds,
          taskStartDocumentRevision: input.taskStartDocumentRevision,
          planningInput: input.planningInput ?? {},
        })
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const [workspace] = await tx
          .select()
          .from(agentWorkspaces)
          .where(and(eq(agentWorkspaces.ownerId, actorId), eq(agentWorkspaces.projectId, input.projectId)))
          .for('update')
          .limit(1)
        if (!workspace) return 'workspace_unavailable'
        let [binding] = await tx
          .select()
          .from(agentConversationModelBindings)
          .where(
            and(
              eq(agentConversationModelBindings.projectId, input.projectId),
              eq(agentConversationModelBindings.conversationId, input.conversationId),
            ),
          )
          .for('update')
          .limit(1)
        if (binding && !matchesAgentConversationModel(binding, input.binding)) return 'configuration_drift'
        if (!binding) {
          ;[binding] = await tx
            .insert(agentConversationModelBindings)
            .values({
              actorId,
              projectId: input.projectId,
              conversationId: input.conversationId,
              ...input.binding,
              boundAt: input.now,
              createdAt: input.now,
            })
            .onConflictDoNothing()
            .returning()
          if (!binding)
            [binding] = await tx
              .select()
              .from(agentConversationModelBindings)
              .where(
                and(
                  eq(agentConversationModelBindings.projectId, input.projectId),
                  eq(agentConversationModelBindings.conversationId, input.conversationId),
                ),
              )
              .limit(1)
        }
        if (!binding) throw new Error('Agent conversation binding insert returned no row')
        if (!matchesAgentConversationModel(binding, input.binding)) return 'configuration_drift'
        const [existing] = await tx
          .select()
          .from(agentTaskRuns)
          .where(and(eq(agentTaskRuns.actorId, actorId), eq(agentTaskRuns.idempotencyKey, input.idempotencyKey)))
          .limit(1)
        if (existing && existing.requestDigest !== requestDigest) return 'conflict'
        const runId = existing?.id ?? randomUUID()
        let workspacePayload: ReturnType<typeof parseAgentProjectWorkspacePayload>
        try {
          workspacePayload = parseAgentProjectWorkspacePayload(workspace.payload, actorId, input.projectId)
        } catch {
          return 'workspace_unavailable'
        }
        const workspaceProjection = bindAgentWorkspaceTaskRunProjection(workspacePayload, {
          conversationId: input.conversationId,
          taskId: input.taskId,
          taskRunId: runId,
        })
        if (workspaceProjection.status === 'conflict') return 'conflict'
        if (workspaceProjection.status === 'legacy' || workspaceProjection.status === 'not_found') {
          return 'workspace_unavailable'
        }
        if (existing) {
          if (workspaceProjection.status === 'bound') {
            await tx
              .update(agentWorkspaces)
              .set({
                payload: workspaceProjection.payload,
                revision: workspace.revision + 1,
                updatedAt: input.now,
              })
              .where(eq(agentWorkspaces.id, workspace.id))
          }
          return existing as never
        }
        const [run] = await tx
          .insert(agentTaskRuns)
          .values({
            id: runId,
            actorId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            taskId: input.taskId,
            idempotencyKey: input.idempotencyKey,
            requestDigest,
            modelBindingId: binding.id,
            provider: binding.provider,
            model: binding.model,
            profileId: binding.profileId,
            configDigest: binding.configDigest,
            bounds: { ...input.bounds },
            taskStartDocumentRevision: input.taskStartDocumentRevision,
            currentTransitionKey: 'planning:1',
            nextTransitionGeneration: 2,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing()
          .returning()
        if (!run) {
          const [concurrent] = await tx
            .select()
            .from(agentTaskRuns)
            .where(and(eq(agentTaskRuns.actorId, actorId), eq(agentTaskRuns.idempotencyKey, input.idempotencyKey)))
            .limit(1)
          return concurrent?.requestDigest === requestDigest ? (concurrent as never) : 'conflict'
        }
        const planningInput = input.planningInput ?? {}
        await tx.insert(agentTaskTransitions).values({
          actorId,
          projectId: input.projectId,
          taskRunId: run.id,
          kind: 'planning',
          transitionKey: 'planning:1',
          generation: 1,
          status: 'pending',
          availableAt: input.now,
          input: planningInput,
          requestDigest: agentTaskTransitionRequestDigest({
            taskRunId: run.id,
            stepId: null,
            kind: 'planning',
            transitionKey: 'planning:1',
            payload: planningInput,
          }),
          createdAt: input.now,
          updatedAt: input.now,
        })
        if (workspaceProjection.status === 'bound') {
          await tx
            .update(agentWorkspaces)
            .set({
              payload: workspaceProjection.payload,
              revision: workspace.revision + 1,
              updatedAt: input.now,
            })
            .where(eq(agentWorkspaces.id, workspace.id))
        }
        return run as never
      })
    },
    getAgentTaskRun(actorId, taskRunId) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(eq(agentTaskRuns.id, taskRunId), eq(agentTaskRuns.actorId, actorId), canReadAgentTaskProject(actorId)),
          )
          .limit(1)
        return (run as never) ?? null
      })
    },
    getAgentTaskRunDetail(actorId, projectId, taskRunId) {
      return withActorSnapshot(actorId, async tx => {
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, taskRunId),
              eq(agentTaskRuns.projectId, projectId),
              eq(agentTaskRuns.actorId, actorId),
              canReadAgentTaskProject(actorId),
            ),
          )
          .limit(1)
        if (!run) return null

        const [latestEvent] = await tx
          .select({ seq: max(agentTaskEvents.seq) })
          .from(agentTaskEvents)
          .where(eq(agentTaskEvents.taskRunId, run.id))
        const [waitingEvent] =
          run.status === 'waiting_user'
            ? await tx
                .select({ summary: agentTaskEvents.summary, publicPayload: agentTaskEvents.publicPayload })
                .from(agentTaskEvents)
                .where(and(eq(agentTaskEvents.taskRunId, run.id), eq(agentTaskEvents.type, 'waiting_user')))
                .orderBy(desc(agentTaskEvents.seq))
                .limit(1)
            : []

        let activePlan: {
          plan: typeof agentTaskPlans.$inferSelect
          steps: (typeof agentTaskSteps.$inferSelect)[]
        } | null = null
        if (run.activePlanVersion > 0) {
          const [plan] = await tx
            .select()
            .from(agentTaskPlans)
            .where(and(eq(agentTaskPlans.taskRunId, run.id), eq(agentTaskPlans.version, run.activePlanVersion)))
            .limit(1)
          if (plan) {
            const steps = await tx
              .select()
              .from(agentTaskSteps)
              .where(and(eq(agentTaskSteps.taskRunId, run.id), eq(agentTaskSteps.planVersion, run.activePlanVersion)))
              .orderBy(asc(agentTaskSteps.ordinal))
            activePlan = { plan, steps }
          }
        }

        return {
          run,
          activePlan,
          waitingReason: waitingEvent
            ? { summary: waitingEvent.summary, publicPayload: waitingEvent.publicPayload }
            : null,
          latestEventSequence: latestEvent?.seq ?? 0,
        } as never
      })
    },
    listAgentTaskEvents(actorId, projectId, taskRunId, input) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select({ id: agentTaskRuns.id })
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, taskRunId),
              eq(agentTaskRuns.projectId, projectId),
              eq(agentTaskRuns.actorId, actorId),
              canReadAgentTaskProject(actorId),
            ),
          )
          .limit(1)
        if (!run) return null
        const afterSeq = Number.isSafeInteger(input.afterSeq) && input.afterSeq >= 0 ? input.afterSeq : 0
        const limit = Number.isSafeInteger(input.limit) ? Math.min(100, Math.max(1, input.limit)) : 50
        return (await tx
          .select()
          .from(agentTaskEvents)
          .where(and(eq(agentTaskEvents.taskRunId, run.id), gt(agentTaskEvents.seq, afterSeq)))
          .orderBy(asc(agentTaskEvents.seq))
          .limit(limit)) as never
      })
    },
    listAgentTaskEventPage(actorId, projectId, taskRunId, input) {
      return withActorSnapshot(actorId, async tx => {
        const [run] = await tx
          .select({ id: agentTaskRuns.id })
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, taskRunId),
              eq(agentTaskRuns.projectId, projectId),
              eq(agentTaskRuns.actorId, actorId),
              canReadAgentTaskProject(actorId),
            ),
          )
          .limit(1)
        if (!run) return null
        const afterSeq = Number.isSafeInteger(input.afterSeq) && input.afterSeq >= 0 ? input.afterSeq : 0
        const limit = Number.isSafeInteger(input.limit) ? Math.min(100, Math.max(1, input.limit)) : 50
        const [tail] = await tx
          .select({ seq: max(agentTaskEvents.seq) })
          .from(agentTaskEvents)
          .where(eq(agentTaskEvents.taskRunId, run.id))
        const events = await tx
          .select()
          .from(agentTaskEvents)
          .where(and(eq(agentTaskEvents.taskRunId, run.id), gt(agentTaskEvents.seq, afterSeq)))
          .orderBy(asc(agentTaskEvents.seq))
          .limit(limit)
        return { events, latestEventSequence: tail?.seq ?? 0 } as never
      })
    },
    continueAgentTaskRun(actorId, input) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, input.taskRunId),
              eq(agentTaskRuns.projectId, input.projectId),
              eq(agentTaskRuns.actorId, actorId),
              canEditAgentTaskProject(actorId),
            ),
          )
          .for('update')
          .limit(1)
        if (!run) return null
        const continuationKind = run.activePlanVersion === 0 ? 'planning' : 'step-action'
        const transitionKey = `${continuationKind}:continue:${input.idempotencyKey}`
        const [existing] = await tx
          .select()
          .from(agentTaskTransitions)
          .where(and(eq(agentTaskTransitions.taskRunId, run.id), eq(agentTaskTransitions.transitionKey, transitionKey)))
          .limit(1)
        if (existing) {
          const history = agentTaskClarificationHistory(existing.input.clarificationHistory)
          const clarification = existing.input.userClarification
          const executionClarification =
            clarification && typeof clarification === 'object' && !Array.isArray(clarification)
              ? (clarification as Record<string, unknown>)
              : null
          const last = history?.at(-1) ?? executionClarification
          const lastQuestion =
            last?.question && typeof last.question === 'object' && !Array.isArray(last.question)
              ? (last.question as Record<string, unknown>)
              : null
          const replayMatches = Boolean(
            last &&
              lastQuestion?.id === input.questionId &&
              last.response === input.response &&
              canonicalJsonSha256(last.attachmentIds) === canonicalJsonSha256(input.attachmentIds) &&
              canonicalJsonSha256(last.images) === canonicalJsonSha256(input.imageInputs),
          )
          return replayMatches ? ({ taskRun: run, transition: existing } as never) : 'conflict'
        }
        const [latestPlanning] = await tx
          .select({ input: agentTaskTransitions.input })
          .from(agentTaskTransitions)
          .where(and(eq(agentTaskTransitions.taskRunId, run.id), eq(agentTaskTransitions.kind, 'planning')))
          .orderBy(desc(agentTaskTransitions.generation))
          .limit(1)
        const [waitingEvent] = await tx
          .select({ stepId: agentTaskEvents.stepId, publicPayload: agentTaskEvents.publicPayload })
          .from(agentTaskEvents)
          .where(and(eq(agentTaskEvents.taskRunId, run.id), eq(agentTaskEvents.type, 'waiting_user')))
          .orderBy(desc(agentTaskEvents.seq))
          .limit(1)
        const waitingQuestion = waitingEvent?.publicPayload.question
        if (
          !latestPlanning ||
          !waitingQuestion ||
          typeof waitingQuestion !== 'object' ||
          Array.isArray(waitingQuestion)
        )
          return 'invalid_state'
        const question = waitingQuestion as Record<string, unknown>
        if (
          typeof question.id !== 'string' ||
          question.id !== input.questionId ||
          typeof question.text !== 'string' ||
          question.text.length < 1
        )
          return 'invalid_state'
        if (run.status !== 'waiting_user') return 'invalid_state'
        const [nonterminal] = await tx
          .select({ id: agentTaskTransitions.id })
          .from(agentTaskTransitions)
          .where(
            and(
              eq(agentTaskTransitions.taskRunId, run.id),
              inArray(agentTaskTransitions.status, ['pending', 'leased']),
            ),
          )
          .limit(1)
        if (nonterminal) return 'invalid_state'

        if (run.activePlanVersion > 0) {
          if (!waitingEvent.stepId) return 'invalid_state'
          const [step] = await tx
            .select({ id: agentTaskSteps.id, status: agentTaskSteps.status })
            .from(agentTaskSteps)
            .where(
              and(
                eq(agentTaskSteps.id, waitingEvent.stepId),
                eq(agentTaskSteps.taskRunId, run.id),
                eq(agentTaskSteps.planVersion, run.activePlanVersion),
              ),
            )
            .limit(1)
          if (!step || !['running', 'verifying', 'revising'].includes(step.status)) return 'invalid_state'
          const userClarification = {
            question: { id: question.id, text: question.text },
            response: input.response,
            attachmentIds: input.attachmentIds,
            images: input.imageInputs,
          }
          const transitionInput = {
            semanticRevisionCount: 0,
            recoveryClass: 'user_action_resolved',
            userClarification,
            observation: {
              outcome: 'user_input_provided',
              question: userClarification.question,
              response: input.response,
              attachmentIds: input.attachmentIds,
            },
          }
          const requestDigest = agentTaskTransitionRequestDigest({
            taskRunId: run.id,
            stepId: step.id,
            kind: 'step_action',
            transitionKey,
            payload: transitionInput,
          })
          const generation = run.nextTransitionGeneration
          const [transition] = await tx
            .insert(agentTaskTransitions)
            .values({
              actorId,
              projectId: run.projectId,
              taskRunId: run.id,
              stepId: step.id,
              kind: 'step_action',
              transitionKey,
              generation,
              status: 'pending',
              availableAt: input.now,
              input: transitionInput,
              requestDigest,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning()
          if (!transition) throw new Error('Agent task execution continuation insert returned no row')
          const [updatedStep] = await tx
            .update(agentTaskSteps)
            .set({ status: 'revising', updatedAt: input.now })
            .where(and(eq(agentTaskSteps.id, step.id), eq(agentTaskSteps.taskRunId, run.id)))
            .returning({ id: agentTaskSteps.id })
          if (!updatedStep) throw new Error('Agent task execution continuation step update returned no row')
          const [updatedRun] = await tx
            .update(agentTaskRuns)
            .set({
              status: 'running',
              currentTransitionKey: transitionKey,
              nextTransitionGeneration: generation + 1,
              updatedAt: input.now,
            })
            .where(eq(agentTaskRuns.id, run.id))
            .returning()
          if (!updatedRun) throw new Error('Agent task execution continuation run update returned no row')
          return { taskRun: updatedRun, transition } as never
        }

        const history = agentTaskClarificationHistory(latestPlanning.input.clarificationHistory)
        if (!history || history.length >= 8) return 'invalid_state'
        const basePlanningInput = Object.fromEntries(
          Object.entries(latestPlanning.input).filter(([key]) => key !== 'clarification'),
        )
        const transitionInput = {
          ...basePlanningInput,
          clarificationHistory: [
            ...history,
            {
              question: { id: question.id, text: question.text },
              response: input.response,
              attachmentIds: input.attachmentIds,
              images: input.imageInputs,
            },
          ],
        }
        const requestDigest = agentTaskTransitionRequestDigest({
          taskRunId: run.id,
          stepId: null,
          kind: 'planning',
          transitionKey,
          payload: transitionInput,
        })
        if (run.activePlanVersion !== 0) return 'invalid_state'

        const generation = run.nextTransitionGeneration
        const [transition] = await tx
          .insert(agentTaskTransitions)
          .values({
            actorId,
            projectId: run.projectId,
            taskRunId: run.id,
            kind: 'planning',
            transitionKey,
            generation,
            status: 'pending',
            availableAt: input.now,
            input: transitionInput,
            requestDigest,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
        if (!transition) throw new Error('Agent task continuation insert returned no row')
        const [updatedRun] = await tx
          .update(agentTaskRuns)
          .set({
            status: 'planning',
            currentTransitionKey: transitionKey,
            nextTransitionGeneration: generation + 1,
            updatedAt: input.now,
          })
          .where(eq(agentTaskRuns.id, run.id))
          .returning()
        if (!updatedRun) throw new Error('Agent task continuation run update returned no row')
        return { taskRun: updatedRun, transition } as never
      })
    },
    resumeAgentTaskRun(actorId, input) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, input.taskRunId),
              eq(agentTaskRuns.projectId, input.projectId),
              eq(agentTaskRuns.actorId, actorId),
              canEditAgentTaskProject(actorId),
            ),
          )
          .for('update')
          .limit(1)
        if (!run) return null
        if (run.status !== 'paused') return 'invalid_state'
        const bounds = run.bounds as unknown as AgentTaskRunBounds
        const resumableBounds = {
          maxExecutorRetries: bounds.maxExecutorRetries,
          tokenLimit: Math.max(bounds.tokenLimit, input.tokenLimit),
          costLimitMicros: Math.max(bounds.costLimitMicros, input.costLimitMicros),
        }
        const pausedByLegacyProviderTurnLimit =
          typeof bounds.maxProviderTurns === 'number' && run.providerTurns >= bounds.maxProviderTurns
        if (
          !pausedByLegacyProviderTurnLimit &&
          (input.costLimitMicros <= run.costMicros ||
            (input.costLimitMicros <= bounds.costLimitMicros &&
              input.tokenLimit <= bounds.tokenLimit &&
              input.configDigest === run.configDigest))
        )
          return 'invalid_state'
        const [failedTransition] = await tx
          .select()
          .from(agentTaskTransitions)
          .where(
            and(
              eq(agentTaskTransitions.taskRunId, run.id),
              eq(agentTaskTransitions.status, 'failed'),
              sql`${agentTaskTransitions.error}->>'code' = 'task_budget_exceeded'`,
            ),
          )
          .orderBy(desc(agentTaskTransitions.generation))
          .limit(1)
        if (!failedTransition || !['planning', 'step_action'].includes(failedTransition.kind)) return 'invalid_state'
        const transitionKind: 'planning' | 'step_action' =
          failedTransition.kind === 'planning' ? 'planning' : 'step_action'
        const generation = run.nextTransitionGeneration
        const transitionKey = `${failedTransition.transitionKey}:resume-${generation}`
        const transitionInput = failedTransition.input ?? {}
        const requestDigest = agentTaskTransitionRequestDigest({
          taskRunId: run.id,
          stepId: failedTransition.stepId,
          kind: transitionKind,
          transitionKey,
          payload: transitionInput,
        })
        const [transition] = await tx
          .insert(agentTaskTransitions)
          .values({
            actorId,
            projectId: run.projectId,
            taskRunId: run.id,
            stepId: failedTransition.stepId,
            kind: transitionKind,
            transitionKey,
            generation,
            status: 'pending',
            availableAt: input.now,
            input: transitionInput,
            requestDigest,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
        if (!transition) throw new Error('Agent task resume transition insert returned no row')
        const [updatedRun] = await tx
          .update(agentTaskRuns)
          .set({
            bounds: resumableBounds,
            configDigest: input.configDigest,
            status: transitionKind === 'planning' ? 'planning' : 'running',
            currentTransitionKey: transitionKey,
            nextTransitionGeneration: generation + 1,
            updatedAt: input.now,
          })
          .where(eq(agentTaskRuns.id, run.id))
          .returning()
        if (!updatedRun) throw new Error('Agent task resume run update returned no row')
        return { taskRun: updatedRun, transition } as never
      })
    },
    cancelAgentTaskRun(actorId, input) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, input.taskRunId),
              eq(agentTaskRuns.projectId, input.projectId),
              eq(agentTaskRuns.actorId, actorId),
              canEditAgentTaskProject(actorId),
            ),
          )
          .for('update')
          .limit(1)
        if (!run) return null
        if (['completed', 'failed', 'canceled', 'rolled_back'].includes(run.status)) return 'invalid_state'

        const activeTransitions = await tx
          .select({ operationId: agentTaskTransitions.operationId })
          .from(agentTaskTransitions)
          .where(
            and(
              eq(agentTaskTransitions.taskRunId, run.id),
              inArray(agentTaskTransitions.status, ['pending', 'leased']),
            ),
          )
        await tx
          .update(agentTaskTransitions)
          .set({
            status: 'canceled',
            leaseOwner: null,
            leaseToken: null,
            leaseUntil: null,
            heartbeatAt: null,
            error: { code: 'user_canceled' },
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(agentTaskTransitions.taskRunId, run.id),
              inArray(agentTaskTransitions.status, ['pending', 'leased']),
            ),
          )
        await tx
          .update(agentProjectTaskLeases)
          .set({ leaseUntil: input.now, heartbeatAt: input.now, updatedAt: input.now })
          .where(and(eq(agentProjectTaskLeases.projectId, run.projectId), eq(agentProjectTaskLeases.taskRunId, run.id)))
        const [taskRun] = await tx
          .update(agentTaskRuns)
          .set({ status: 'canceled', currentTransitionKey: null, completedAt: input.now, updatedAt: input.now })
          .where(eq(agentTaskRuns.id, run.id))
          .returning()
        if (!taskRun) return null
        return {
          taskRun: taskRun as never,
          operationIds: activeTransitions.flatMap(item => (item.operationId ? [item.operationId] : [])),
        }
      })
    },
    getAgentTaskTransitionProviderResult(actorId, taskRunId, transitionId) {
      return withActor(actorId, async tx => {
        const [transition] = await tx
          .select({ output: agentTaskTransitions.output })
          .from(agentTaskTransitions)
          .innerJoin(agentTaskRuns, eq(agentTaskRuns.id, agentTaskTransitions.taskRunId))
          .where(
            and(
              eq(agentTaskTransitions.id, transitionId),
              eq(agentTaskTransitions.taskRunId, taskRunId),
              eq(agentTaskTransitions.actorId, actorId),
              eq(agentTaskRuns.actorId, actorId),
              canReadAgentTaskProject(actorId),
            ),
          )
          .limit(1)
        if (!transition) return null
        const [latestAttempt] = await tx
          .select({ id: agentProviderAttempts.id, state: agentProviderAttempts.state })
          .from(agentProviderAttempts)
          .where(
            and(eq(agentProviderAttempts.taskTransitionId, transitionId), eq(agentProviderAttempts.actorId, actorId)),
          )
          .orderBy(desc(agentProviderAttempts.attemptNo))
          .limit(1)
        if (!latestAttempt || latestAttempt.state !== 'succeeded') return null
        const providerResult = transition.output?.providerResult
        if (!providerResult || typeof providerResult !== 'object' || Array.isArray(providerResult)) return null
        const result = providerResult as Record<string, unknown>
        const decisionOutput = result.decisionOutput
        const decisionUsage = result.decisionUsage
        const decisionTrace = result.decisionTrace
        if (
          result.attemptId !== latestAttempt.id ||
          !decisionOutput ||
          typeof decisionOutput !== 'object' ||
          Array.isArray(decisionOutput) ||
          !Object.prototype.hasOwnProperty.call(result, 'decisionUsage') ||
          (decisionUsage !== null && (typeof decisionUsage !== 'object' || Array.isArray(decisionUsage))) ||
          !decisionTrace ||
          typeof decisionTrace !== 'object' ||
          Array.isArray(decisionTrace)
        )
          return null
        return {
          attemptId: latestAttempt.id,
          decisionOutput: decisionOutput as Record<string, unknown>,
          decisionUsage: decisionUsage as Record<string, unknown> | null,
          decisionTrace: decisionTrace as Record<string, unknown>,
        }
      })
    },
    getAgentTaskPlanningInput(actorId, projectId, taskRunId) {
      return withActor(actorId, async tx => {
        const [planning] = await tx
          .select({ input: agentTaskTransitions.input })
          .from(agentTaskTransitions)
          .innerJoin(agentTaskRuns, eq(agentTaskRuns.id, agentTaskTransitions.taskRunId))
          .where(
            and(
              eq(agentTaskTransitions.taskRunId, taskRunId),
              eq(agentTaskTransitions.actorId, actorId),
              eq(agentTaskTransitions.projectId, projectId),
              eq(agentTaskTransitions.kind, 'planning'),
              eq(agentTaskRuns.actorId, actorId),
              eq(agentTaskRuns.projectId, projectId),
              canReadAgentTaskProject(actorId),
            ),
          )
          .orderBy(desc(agentTaskTransitions.generation))
          .limit(1)
        return planning?.input ?? null
      })
    },
    enqueueAgentTaskTransition(actorId, input) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, input.taskRunId),
              eq(agentTaskRuns.actorId, actorId),
              canEditAgentTaskProject(actorId),
            ),
          )
          .for('update')
          .limit(1)
        if (!run) return null
        const transitionInput = input.input ?? {}
        const requestDigest = agentTaskTransitionRequestDigest({
          taskRunId: run.id,
          stepId: input.stepId ?? null,
          kind: input.kind,
          transitionKey: input.transitionKey,
          availableAt: input.availableAt,
          payload: transitionInput,
        })
        const [existing] = await tx
          .select()
          .from(agentTaskTransitions)
          .where(
            and(
              eq(agentTaskTransitions.taskRunId, run.id),
              eq(agentTaskTransitions.transitionKey, input.transitionKey),
            ),
          )
          .limit(1)
        if (existing) return existing.requestDigest === requestDigest ? (existing as never) : 'conflict'
        if (['completed', 'failed', 'canceled', 'rolled_back'].includes(run.status)) return 'invalid_state'
        let ownedStep: typeof agentTaskSteps.$inferSelect | undefined
        if (input.stepId) {
          ;[ownedStep] = await tx
            .select()
            .from(agentTaskSteps)
            .where(and(eq(agentTaskSteps.id, input.stepId), eq(agentTaskSteps.taskRunId, run.id)))
            .limit(1)
          if (!ownedStep || ownedStep.planVersion !== run.activePlanVersion) return 'invalid_state'
        }
        const kindAllowsState =
          (input.kind === 'planning' && !ownedStep && ['planning', 'waiting_user'].includes(run.status)) ||
          (input.kind === 'step_action' &&
            ownedStep &&
            run.status === 'running' &&
            ['pending', 'revising'].includes(ownedStep.status)) ||
          (input.kind === 'observation' &&
            ownedStep &&
            ['running', 'verifying'].includes(run.status) &&
            ['running', 'verifying', 'revising'].includes(ownedStep.status)) ||
          (input.kind === 'final_verification' && !ownedStep && run.status === 'verifying') ||
          (input.kind === 'rollback' && !ownedStep && run.status === 'rolling_back')
        if (!kindAllowsState) return 'invalid_state'
        const [earlierNonterminal] = await tx
          .select({ id: agentTaskTransitions.id })
          .from(agentTaskTransitions)
          .where(
            and(
              eq(agentTaskTransitions.taskRunId, run.id),
              inArray(agentTaskTransitions.status, ['pending', 'leased']),
            ),
          )
          .limit(1)
        if (earlierNonterminal) return 'invalid_state'
        const generation = run.nextTransitionGeneration
        const [transition] = await tx
          .insert(agentTaskTransitions)
          .values({
            actorId,
            projectId: run.projectId,
            taskRunId: run.id,
            stepId: input.stepId ?? null,
            kind: input.kind,
            transitionKey: input.transitionKey,
            generation,
            availableAt: input.availableAt ?? input.now,
            input: transitionInput,
            requestDigest,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
        await tx
          .update(agentTaskRuns)
          .set({
            nextTransitionGeneration: generation + 1,
            currentTransitionKey: input.transitionKey,
            updatedAt: input.now,
          })
          .where(eq(agentTaskRuns.id, run.id))
        return (transition as never) ?? null
      })
    },
    createAgentTaskPlan(actorId, taskRunId, input) {
      return withActor(actorId, async tx => {
        const normalizedSteps = normalizedAgentPlanSteps(input.steps)
        if (!normalizedSteps) return 'invalid_state'
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(eq(agentTaskRuns.id, taskRunId), eq(agentTaskRuns.actorId, actorId), canEditAgentTaskProject(actorId)),
          )
          .for('update')
          .limit(1)
        if (!run || run.activePlanVersion !== 0 || run.status !== 'planning') return run ? 'invalid_state' : null
        const version = 1
        const [plan] = await tx
          .insert(agentTaskPlans)
          .values({
            taskRunId,
            version,
            summary: input.summary,
            assumptions: input.assumptions,
            verification: input.verification,
            createdAt: input.now,
          })
          .returning()
        const steps = await tx
          .insert(agentTaskSteps)
          .values(agentTaskStepValues(taskRunId, version, normalizedSteps, input.now))
          .returning()
        await tx
          .update(agentTaskRuns)
          .set({ activePlanVersion: version, status: 'running', updatedAt: input.now })
          .where(eq(agentTaskRuns.id, taskRunId))
        return plan ? { plan: plan as never, steps: steps as never } : 'invalid_state'
      })
    },
    reviseAgentTaskPlan(actorId, taskRunId, input) {
      return withActor(actorId, async tx => {
        const normalizedSteps = normalizedAgentPlanSteps(input.steps)
        if (!normalizedSteps) return 'invalid_state'
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(eq(agentTaskRuns.id, taskRunId), eq(agentTaskRuns.actorId, actorId), canEditAgentTaskProject(actorId)),
          )
          .for('update')
          .limit(1)
        if (!run) return null
        if (run.activePlanVersion < 1 || run.status !== 'paused') return 'invalid_state'
        await tx
          .update(agentTaskSteps)
          .set({ status: 'superseded', updatedAt: input.now })
          .where(and(eq(agentTaskSteps.taskRunId, taskRunId), inArray(agentTaskSteps.status, ['pending', 'revising'])))
        const version = run.activePlanVersion + 1
        const [plan] = await tx
          .insert(agentTaskPlans)
          .values({
            taskRunId,
            version,
            summary: input.summary,
            assumptions: input.assumptions,
            verification: input.verification,
            createdAt: input.now,
          })
          .returning()
        const steps = await tx
          .insert(agentTaskSteps)
          .values(agentTaskStepValues(taskRunId, version, normalizedSteps, input.now))
          .returning()
        await tx
          .update(agentTaskRuns)
          .set({
            activePlanVersion: version,
            status: 'running',
            semanticRevisions: run.semanticRevisions + 1,
            updatedAt: input.now,
          })
          .where(eq(agentTaskRuns.id, taskRunId))
        return plan ? { plan: plan as never, steps: steps as never } : 'invalid_state'
      })
    },
    appendAgentTaskEvent(actorId, taskRunId, input) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(eq(agentTaskRuns.id, taskRunId), eq(agentTaskRuns.actorId, actorId), canEditAgentTaskProject(actorId)),
          )
          .for('update')
          .limit(1)
        if (!run) return null
        const [existing] = await tx
          .select()
          .from(agentTaskEvents)
          .where(and(eq(agentTaskEvents.taskRunId, taskRunId), eq(agentTaskEvents.eventKey, input.eventKey)))
          .limit(1)
        if (existing) return existing as never
        if (input.stepId) {
          const [step] = await tx
            .select({ id: agentTaskSteps.id })
            .from(agentTaskSteps)
            .where(and(eq(agentTaskSteps.id, input.stepId), eq(agentTaskSteps.taskRunId, taskRunId)))
            .limit(1)
          if (!step) return null
        }
        const publicEvent = sanitizePublicAgentTaskEvent(input)
        const seq = run.nextEventSequence
        const [event] = await tx
          .insert(agentTaskEvents)
          .values({
            taskRunId,
            seq,
            eventKey: input.eventKey,
            stepId: input.stepId ?? null,
            type: input.type,
            summary: publicEvent.summary,
            publicPayload: publicEvent.publicPayload,
            technicalPayload: input.technicalPayload ?? {},
            redactionVersion: input.redactionVersion ?? 1,
            createdAt: input.now,
          })
          .returning()
        await tx
          .update(agentTaskRuns)
          .set({ nextEventSequence: seq + 1, updatedAt: input.now })
          .where(eq(agentTaskRuns.id, taskRunId))
        return (event as never) ?? null
      })
    },
    acquireAgentProjectTaskLease(actorId, input) {
      return withActor(actorId, async tx => {
        if (input.leaseUntil <= input.now) return 'stale'
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(
            and(
              eq(agentTaskRuns.id, input.taskRunId),
              eq(agentTaskRuns.actorId, actorId),
              canEditAgentTaskProject(actorId),
            ),
          )
          .limit(1)
        if (!run) return null
        if (['completed', 'failed', 'canceled', 'rolled_back'].includes(run.status)) return 'stale'
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${run.projectId}:agent-task-lease`}, 0))`)
        const [lease] = await tx
          .select()
          .from(agentProjectTaskLeases)
          .where(eq(agentProjectTaskLeases.projectId, run.projectId))
          .for('update')
          .limit(1)
        if (lease?.leaseUntil && lease.leaseUntil > input.now) {
          if (lease.taskRunId !== run.id || lease.leaseOwner !== input.workerId) return 'busy'
          return lease as never
        }
        const leaseToken = randomUUID()
        const generation = (lease?.leaseGeneration ?? 0) + 1
        const values = {
          taskRunId: run.id,
          leaseGeneration: generation,
          leaseToken,
          leaseOwner: input.workerId,
          leaseUntil: input.leaseUntil,
          heartbeatAt: input.now,
          updatedAt: input.now,
        }
        const [saved] = lease
          ? await tx
              .update(agentProjectTaskLeases)
              .set(values)
              .where(eq(agentProjectTaskLeases.projectId, run.projectId))
              .returning()
          : await tx
              .insert(agentProjectTaskLeases)
              .values({ projectId: run.projectId, ...values, createdAt: input.now })
              .returning()
        return (saved as never) ?? 'stale'
      })
    },
    async acquireNextAgentProjectTaskLease(workerId, now, leaseUntil) {
      if (!workerId.trim() || leaseUntil <= now) {
        throw new Error('Valid Agent project task lease worker and lease are required')
      }
      const result = (await db.execute(sql`
        select acquired.project_id as "projectId", acquired.task_run_id as "taskRunId",
          acquired.lease_generation as "leaseGeneration", acquired.lease_token as "leaseToken",
          acquired.lease_owner as "leaseOwner", acquired.lease_until as "leaseUntil",
          acquired.heartbeat_at as "heartbeatAt", acquired.created_at as "createdAt",
          acquired.updated_at as "updatedAt"
        from app.acquire_next_agent_project_task_lease(${workerId}, ${now}, ${leaseUntil}) acquired
      `)) as unknown as { rows?: unknown[] }
      return (result.rows?.[0] as never) ?? null
    },
    releaseAgentProjectTaskLease(actorId, input) {
      return withActor(actorId, async tx => {
        const [run] = await tx
          .select({ projectId: agentTaskRuns.projectId })
          .from(agentTaskRuns)
          .where(and(eq(agentTaskRuns.id, input.taskRunId), eq(agentTaskRuns.actorId, actorId)))
          .limit(1)
        if (!run) return 'stale'
        const [released] = await tx
          .update(agentProjectTaskLeases)
          .set({ leaseUntil: input.now, heartbeatAt: input.now, updatedAt: input.now })
          .where(
            and(
              eq(agentProjectTaskLeases.projectId, run.projectId),
              eq(agentProjectTaskLeases.taskRunId, input.taskRunId),
              eq(agentProjectTaskLeases.leaseGeneration, input.leaseGeneration),
              eq(agentProjectTaskLeases.leaseToken, input.leaseToken),
              eq(agentProjectTaskLeases.leaseOwner, input.workerId),
            ),
          )
          .returning({ projectId: agentProjectTaskLeases.projectId })
        return released ? true : 'stale'
      })
    },
    async claimAgentTaskTransition(workerId, now, leaseUntil, kinds) {
      if (!workerId.trim() || leaseUntil <= now)
        throw new Error('Valid Agent task transition worker and lease are required')
      if (kinds?.length === 0) return null
      const claimKinds = kinds
        ? sql`array[${sql.join(
            kinds.map(kind => sql`${kind}`),
            sql`, `,
          )}]::app.agent_task_transition_kind[]`
        : sql`null::app.agent_task_transition_kind[]`
      // app.claim_agent_task_transition selects pending or expired lease_until work FOR UPDATE SKIP LOCKED.
      const result =
        (await db.execute(sql`select claimed.id, claimed.actor_id as "actorId", claimed.project_id as "projectId",
        claimed.task_run_id as "taskRunId", claimed.step_id as "stepId", claimed.kind, claimed.transition_key as "transitionKey",
        claimed.generation, claimed.status, claimed.available_at as "availableAt", claimed.lease_owner as "leaseOwner",
        claimed.lease_generation as "leaseGeneration", claimed.lease_token as "leaseToken", claimed.lease_until as "leaseUntil",
        claimed.project_lease_generation as "projectLeaseGeneration", claimed.project_lease_token as "projectLeaseToken",
        claimed.project_lease_worker_id as "projectLeaseWorkerId",
        claimed.heartbeat_at as "heartbeatAt", claimed.claim_attempts as "claimAttempts", claimed.operation_id as "operationId",
        claimed.step_attempt_id as "stepAttemptId", claimed.input_json as input, claimed.output_json as output, claimed.error_json as error,
        claimed.request_digest as "requestDigest", claimed.completion_digest as "completionDigest",
        claimed.created_at as "createdAt", claimed.updated_at as "updatedAt", claimed.completed_at as "completedAt"
        from app.claim_agent_task_transition(${workerId}, ${now}, ${leaseUntil}, ${claimKinds}) claimed`)) as unknown as {
          rows?: unknown[]
        }
      return (result.rows?.[0] as never) ?? null
    },
    heartbeatAgentTaskTransition(actorId, fence, now, leaseUntil) {
      return withActor(actorId, async tx => {
        if (leaseUntil <= now) return 'stale' as const
        const [transition] = await tx
          .select()
          .from(agentTaskTransitions)
          .where(and(eq(agentTaskTransitions.id, fence.transitionId), eq(agentTaskTransitions.actorId, actorId)))
          .for('update')
          .limit(1)
        if (
          !transition ||
          transition.status !== 'leased' ||
          !matchesAgentTaskLease(transition, fence) ||
          !transition.leaseUntil ||
          transition.leaseUntil <= now
        )
          return 'stale' as const
        if (agentTaskTransitionRequiresProjectLease(transition.kind)) {
          if (!matchesAgentProjectTaskLease(transition, fence)) return 'stale' as const
          const [projectLease] = await tx
            .update(agentProjectTaskLeases)
            .set({ leaseUntil, heartbeatAt: now, updatedAt: now })
            .where(
              and(
                eq(agentProjectTaskLeases.projectId, transition.projectId),
                eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
                gt(agentProjectTaskLeases.leaseUntil, now),
              ),
            )
            .returning({ projectId: agentProjectTaskLeases.projectId })
          if (!projectLease) return 'stale' as const
        }
        const [heartbeat] = await tx
          .update(agentTaskTransitions)
          .set({ leaseUntil, heartbeatAt: now, updatedAt: now })
          .where(
            and(
              eq(agentTaskTransitions.id, transition.id),
              eq(agentTaskTransitions.status, 'leased'),
              eq(agentTaskTransitions.leaseGeneration, fence.leaseGeneration),
              eq(agentTaskTransitions.leaseToken, fence.leaseToken),
              eq(agentTaskTransitions.leaseOwner, fence.workerId),
              gt(agentTaskTransitions.leaseUntil, now),
            ),
          )
          .returning()
        return (heartbeat as never) ?? ('stale' as const)
      })
    },
    releaseAgentTaskTransition(actorId, fence, now) {
      return withActor(actorId, async tx => {
        const [transition] = await tx
          .update(agentTaskTransitions)
          .set({
            status: 'pending',
            leaseOwner: null,
            leaseToken: null,
            leaseUntil: null,
            heartbeatAt: null,
            availableAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentTaskTransitions.id, fence.transitionId),
              eq(agentTaskTransitions.actorId, actorId),
              eq(agentTaskTransitions.status, 'leased'),
              eq(agentTaskTransitions.leaseGeneration, fence.leaseGeneration),
              eq(agentTaskTransitions.leaseToken, fence.leaseToken),
              eq(agentTaskTransitions.leaseOwner, fence.workerId),
            ),
          )
          .returning()
        return (transition as never) ?? 'stale'
      })
    },
    completeAgentTaskTransition(actorId, fence, input: AgentTaskCompletionInput) {
      const completionDigest = agentTaskCompletionRequestDigest(input)
      // withActor is one database transaction: taskRunPatch, steps, events, accounting and nextTransition commit together.
      return withActor(actorId, async tx => {
        const [transition] = await tx
          .select()
          .from(agentTaskTransitions)
          .where(and(eq(agentTaskTransitions.id, fence.transitionId), eq(agentTaskTransitions.actorId, actorId)))
          .for('update')
          .limit(1)
        if (!transition) return 'stale'
        if (
          ['completed', 'failed', 'canceled'].includes(transition.status) &&
          matchesAgentTaskLease(transition, fence)
        ) {
          if (transition.completionDigest !== completionDigest) return 'conflict'
          const [taskRun] = await tx
            .select()
            .from(agentTaskRuns)
            .where(eq(agentTaskRuns.id, transition.taskRunId))
            .limit(1)
          const [nextTransition] = await tx
            .select()
            .from(agentTaskTransitions)
            .where(
              and(
                eq(agentTaskTransitions.taskRunId, transition.taskRunId),
                gt(agentTaskTransitions.generation, transition.generation),
              ),
            )
            .orderBy(asc(agentTaskTransitions.generation))
            .limit(1)
          return taskRun
            ? {
                transition: transition as never,
                taskRun: taskRun as never,
                nextTransition: (nextTransition as never) ?? null,
              }
            : 'stale'
        }
        if (
          transition.status !== 'leased' ||
          !matchesAgentTaskLease(transition, fence) ||
          !transition.leaseUntil ||
          transition.leaseUntil <= input.now
        )
          return 'stale'
        if (agentTaskTransitionRequiresProjectLease(transition.kind)) {
          if (!matchesAgentProjectTaskLease(transition, fence)) return 'stale'
          const [projectLease] = await tx
            .select({ projectId: agentProjectTaskLeases.projectId })
            .from(agentProjectTaskLeases)
            .where(
              and(
                eq(agentProjectTaskLeases.projectId, transition.projectId),
                eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
                gt(agentProjectTaskLeases.leaseUntil, input.now),
              ),
            )
            .for('update')
            .limit(1)
          if (!projectLease) return 'stale'
        }
        const [run] = await tx
          .select()
          .from(agentTaskRuns)
          .where(eq(agentTaskRuns.id, transition.taskRunId))
          .for('update')
          .limit(1)
        if (!run) return 'stale'
        const kindAllowsRun =
          (transition.kind === 'planning' && ['planning', 'waiting_user'].includes(run.status)) ||
          (transition.kind === 'step_action' && run.status === 'running') ||
          (transition.kind === 'observation' && ['running', 'verifying', 'paused'].includes(run.status)) ||
          (transition.kind === 'final_verification' && run.status === 'verifying') ||
          (transition.kind === 'rollback' && run.status === 'rolling_back')
        if (!kindAllowsRun) return 'invalid_state'

        let transitionStep: typeof agentTaskSteps.$inferSelect | undefined
        if (transition.stepId) {
          ;[transitionStep] = await tx
            .select()
            .from(agentTaskSteps)
            .where(and(eq(agentTaskSteps.id, transition.stepId), eq(agentTaskSteps.taskRunId, run.id)))
            .for('update')
            .limit(1)
          if (!transitionStep || transitionStep.planVersion !== run.activePlanVersion) return 'invalid_state'
        }
        if ((transition.kind === 'step_action' || transition.kind === 'observation') !== Boolean(transitionStep))
          return 'invalid_state'
        if (
          (transition.kind === 'step_action' &&
            transitionStep &&
            !['pending', 'running', 'revising'].includes(transitionStep.status)) ||
          (transition.kind === 'observation' &&
            transitionStep &&
            !['running', 'verifying', 'revising'].includes(transitionStep.status))
        )
          return 'invalid_state'

        const nextRunStatus = input.taskRunPatch?.status ?? run.status
        if (!allowsAgentStateEdge(agentTaskStatusEdges, run.status, nextRunStatus)) return 'invalid_state'
        let patchedStep = transitionStep
        if (!patchedStep && transition.kind === 'final_verification' && input.stepPatch) {
          ;[patchedStep] = await tx
            .select()
            .from(agentTaskSteps)
            .where(and(eq(agentTaskSteps.id, input.stepPatch.stepId), eq(agentTaskSteps.taskRunId, run.id)))
            .for('update')
            .limit(1)
          if (!patchedStep || patchedStep.planVersion !== run.activePlanVersion) return 'invalid_state'
        }
        const isFinalVisualRevision =
          transition.kind === 'final_verification' &&
          input.status === 'completed' &&
          nextRunStatus === 'running' &&
          patchedStep?.status === 'passed' &&
          input.stepPatch?.stepId === patchedStep.id &&
          input.stepPatch.status === 'revising' &&
          input.nextTransition?.kind === 'step_action' &&
          input.nextTransition.stepId === patchedStep.id &&
          input.accountingDelta?.semanticRevisions === 1
        if (transition.kind === 'final_verification' && nextRunStatus === 'completed') {
          if (!completeAgentTaskFinalVerificationEvidence(input.finalVerification)) return 'invalid_state'
          const [notPassedStep] = await tx
            .select({ id: agentTaskSteps.id })
            .from(agentTaskSteps)
            .where(
              and(
                eq(agentTaskSteps.taskRunId, run.id),
                eq(agentTaskSteps.planVersion, run.activePlanVersion),
                ne(agentTaskSteps.status, 'passed'),
              ),
            )
            .limit(1)
          if (notPassedStep) return 'invalid_state'
          const evidence = input.finalVerification!
          const [operation] = await tx
            .select({
              id: agentSpikeOperations.id,
              status: agentSpikeOperations.status,
              committedDraftVersion: agentSpikeOperations.committedDraftVersion,
              evidence: agentSpikeOperations.evidence,
              hostReceipt: agentSpikeOperations.hostReceipt,
            })
            .from(agentSpikeOperations)
            .where(
              and(
                eq(agentSpikeOperations.actorId, actorId),
                eq(agentSpikeOperations.projectId, run.projectId),
                eq(agentSpikeOperations.taskId, run.taskId),
                eq(agentSpikeOperations.operationId, evidence.operationId),
              ),
            )
            .limit(1)
          const [project] = await tx
            .select({ draftVersion: projects.draftVersion })
            .from(projects)
            .where(eq(projects.id, run.projectId))
            .limit(1)
          const renderEvidence =
            operation?.evidence?.render &&
            typeof operation.evidence.render === 'object' &&
            !Array.isArray(operation.evidence.render)
              ? (operation.evidence.render as Record<string, unknown>)
              : null
          if (
            !operation ||
            operation.status !== 'committed' ||
            operation.id !== evidence.receiptId ||
            operation.committedDraftVersion !== evidence.committedDraftVersion ||
            project?.draftVersion !== evidence.committedDraftVersion ||
            !operation.hostReceipt ||
            operation.hostReceipt.status !== 'applied' ||
            renderEvidence?.rendererReady !== true ||
            !cleanAgentPreviewEvidence(operation.evidence)
          )
            return 'invalid_state'
        } else if (input.finalVerification) {
          return 'invalid_state'
        }
        const forbiddenProviderAccountingFields = ['providerTurns', 'promptTokens', 'completionTokens', 'costMicros']
        if (
          forbiddenProviderAccountingFields.some(field =>
            Object.prototype.hasOwnProperty.call(input.accountingDelta ?? {}, field),
          )
        )
          return 'invalid_state'
        const accountingDelta = {
          executorRetries: input.accountingDelta?.executorRetries ?? 0,
          semanticRevisions: input.accountingDelta?.semanticRevisions ?? 0,
        }
        if (Object.values(accountingDelta).some(value => !Number.isSafeInteger(value) || value < 0))
          return 'invalid_state'
        let operationRetryCount = 0
        let stepRevisionCount = 0
        if (input.stepAttempt) {
          const operationId = input.stepAttempt.operationId?.trim() || null
          if (operationId) {
            const [operation] = await tx
              .select({ id: agentSpikeOperations.id })
              .from(agentSpikeOperations)
              .where(
                and(
                  eq(agentSpikeOperations.actorId, actorId),
                  eq(agentSpikeOperations.projectId, run.projectId),
                  eq(agentSpikeOperations.taskId, run.taskId),
                  eq(agentSpikeOperations.operationId, operationId),
                ),
              )
              .limit(1)
            if (!operation) return 'invalid_state'
            const [latestOperationAttempt] = await tx
              .select({ maximum: max(agentTaskStepAttempts.executorRetryCount) })
              .from(agentTaskStepAttempts)
              .where(
                and(eq(agentTaskStepAttempts.taskRunId, run.id), eq(agentTaskStepAttempts.operationId, operationId)),
              )
            operationRetryCount = Number(latestOperationAttempt?.maximum ?? 0) + accountingDelta.executorRetries
          } else if (accountingDelta.executorRetries > 0) {
            return 'invalid_state'
          }
          if (transitionStep) {
            const [latestStepAttempt] = await tx
              .select({ maximum: max(agentTaskStepAttempts.semanticRevisionCount) })
              .from(agentTaskStepAttempts)
              .where(eq(agentTaskStepAttempts.stepId, transitionStep.id))
            stepRevisionCount = Number(latestStepAttempt?.maximum ?? 0) + accountingDelta.semanticRevisions
          }
          if (
            (input.stepAttempt.executorRetryCount ?? 0) !== operationRetryCount ||
            (input.stepAttempt.semanticRevisionCount ?? 0) !== stepRevisionCount
          )
            return 'invalid_state'
        } else if (
          accountingDelta.executorRetries > 0 ||
          (accountingDelta.semanticRevisions > 0 && !isFinalVisualRevision)
        ) {
          return 'invalid_state'
        }
        const nextAccounting = {
          providerTurns: run.providerTurns,
          executorRetries: run.executorRetries + accountingDelta.executorRetries,
          semanticRevisions: run.semanticRevisions + accountingDelta.semanticRevisions,
          promptTokens: run.promptTokens,
          completionTokens: run.completionTokens,
          costMicros: run.costMicros,
        }
        const bounds = run.bounds as unknown as AgentTaskRunBounds
        if (operationRetryCount > bounds.maxExecutorRetries) return 'invalid_state'

        const normalizedPlanStepsInput = input.plan ? normalizedAgentPlanSteps(input.plan.steps) : []
        const projectedPlanVersion = input.plan ? run.activePlanVersion + 1 : run.activePlanVersion
        if (input.plan) {
          if (!normalizedPlanStepsInput) return 'invalid_state'
          const isInitialPlan =
            transition.kind === 'planning' && run.activePlanVersion === 0 && run.status === 'planning'
          const isReplan =
            transition.kind === 'observation' &&
            run.activePlanVersion > 0 &&
            ['running', 'verifying', 'paused'].includes(run.status) &&
            input.stepPatch?.status === 'superseded'
          if (!isInitialPlan && !isReplan) return 'invalid_state'
        }
        if (
          transition.kind === 'planning' &&
          !input.plan &&
          input.status === 'completed' &&
          nextRunStatus !== 'waiting_user'
        )
          return 'invalid_state'
        if (input.stepPatch) {
          if (!patchedStep || input.stepPatch.stepId !== patchedStep.id)
            throw new AgentTaskCompletionRollback('invalid_state')
          if (
            !allowsAgentStateEdge(agentStepStatusEdges, patchedStep.status, input.stepPatch.status) &&
            !isFinalVisualRevision
          )
            throw new AgentTaskCompletionRollback('invalid_state')
        }
        if (input.stepAttempt) {
          if (!transitionStep || input.stepAttempt.stepId !== transitionStep.id)
            throw new AgentTaskCompletionRollback('invalid_state')
          const [existingStepAttempt] = await tx
            .select({ id: agentTaskStepAttempts.id })
            .from(agentTaskStepAttempts)
            .where(eq(agentTaskStepAttempts.transitionId, transition.id))
            .limit(1)
          if (existingStepAttempt) return 'conflict'
        }
        for (const event of input.events ?? []) {
          const resolvedEventStepId =
            event.stepId && normalizedPlanStepsInput
              ? (normalizedPlanStepsInput.find(step => step.semanticStepKey === event.stepId)?.id ?? event.stepId)
              : (event.stepId ?? null)
          if (resolvedEventStepId) {
            const ownedEventStep =
              normalizedPlanStepsInput?.find(step => step.id === resolvedEventStepId) ??
              (
                await tx
                  .select()
                  .from(agentTaskSteps)
                  .where(and(eq(agentTaskSteps.id, resolvedEventStepId), eq(agentTaskSteps.taskRunId, run.id)))
                  .limit(1)
              )[0]
            const supersedesCurrentPlanStep =
              Boolean(input.plan) &&
              transition.kind === 'observation' &&
              event.type === 'step_superseded' &&
              transitionStep?.id === resolvedEventStepId &&
              input.stepPatch?.stepId === resolvedEventStepId &&
              input.stepPatch.status === 'superseded'
            if (
              !ownedEventStep ||
              ('planVersion' in ownedEventStep &&
                ownedEventStep.planVersion !== projectedPlanVersion &&
                !supersedesCurrentPlanStep)
            )
              return 'invalid_state'
          }
          const publicEvent = sanitizePublicAgentTaskEvent(event)
          const [existingEvent] = await tx
            .select()
            .from(agentTaskEvents)
            .where(and(eq(agentTaskEvents.taskRunId, run.id), eq(agentTaskEvents.eventKey, event.eventKey)))
            .limit(1)
          if (
            existingEvent &&
            canonicalJsonSha256({
              stepId: existingEvent.stepId,
              type: existingEvent.type,
              summary: existingEvent.summary,
              publicPayload: existingEvent.publicPayload,
              technicalPayload: existingEvent.technicalPayload,
              redactionVersion: existingEvent.redactionVersion,
            }) !==
              canonicalJsonSha256({
                stepId: resolvedEventStepId,
                type: event.type,
                summary: publicEvent.summary,
                publicPayload: publicEvent.publicPayload,
                technicalPayload: event.technicalPayload ?? {},
                redactionVersion: event.redactionVersion ?? 1,
              })
          )
            return 'conflict'
        }
        if (input.nextTransition) {
          const allowedNextKinds: Readonly<Record<string, readonly string[]>> = {
            planning: ['step_action'],
            step_action: ['observation'],
            observation: ['step_action', 'final_verification'],
            final_verification: ['step_action'],
            rollback: ['rollback'],
          }
          if (!allowedNextKinds[transition.kind]?.includes(input.nextTransition.kind)) return 'invalid_state'
          const nextKindAllowsRun =
            (input.nextTransition.kind === 'step_action' && nextRunStatus === 'running') ||
            (input.nextTransition.kind === 'observation' && ['running', 'verifying'].includes(nextRunStatus)) ||
            (input.nextTransition.kind === 'final_verification' && nextRunStatus === 'verifying') ||
            (input.nextTransition.kind === 'rollback' && nextRunStatus === 'rolling_back')
          if (!nextKindAllowsRun) return 'invalid_state'
          const ordinalStep = input.nextTransition.stepOrdinal
            ? normalizedPlanStepsInput?.find(step => step.ordinal === input.nextTransition?.stepOrdinal)
            : undefined
          const semanticStep = input.nextTransition.stepId
            ? normalizedPlanStepsInput?.find(step => step.semanticStepKey === input.nextTransition?.stepId)
            : undefined
          if (ordinalStep && semanticStep && ordinalStep.id !== semanticStep.id) return 'invalid_state'
          const nextStepId = ordinalStep?.id ?? semanticStep?.id ?? input.nextTransition.stepId ?? null
          const ownedNextStep = nextStepId
            ? (normalizedPlanStepsInput?.find(step => step.id === nextStepId) ??
              (
                await tx
                  .select()
                  .from(agentTaskSteps)
                  .where(and(eq(agentTaskSteps.id, nextStepId), eq(agentTaskSteps.taskRunId, run.id)))
                  .limit(1)
              )[0])
            : undefined
          if (
            (input.nextTransition.kind === 'step_action' || input.nextTransition.kind === 'observation') !==
              Boolean(ownedNextStep) ||
            (ownedNextStep && 'planVersion' in ownedNextStep && ownedNextStep.planVersion !== projectedPlanVersion)
          )
            return 'invalid_state'
          const nextRequestDigest = agentTaskTransitionRequestDigest({
            taskRunId: run.id,
            stepId: nextStepId,
            kind: input.nextTransition.kind,
            transitionKey: input.nextTransition.transitionKey,
            availableAt: input.nextTransition.availableAt,
            payload: input.nextTransition.input ?? {},
          })
          const [existingNext] = await tx
            .select({ requestDigest: agentTaskTransitions.requestDigest })
            .from(agentTaskTransitions)
            .where(
              and(
                eq(agentTaskTransitions.taskRunId, run.id),
                eq(agentTaskTransitions.transitionKey, input.nextTransition.transitionKey),
              ),
            )
            .limit(1)
          if (existingNext && existingNext.requestDigest !== nextRequestDigest) return 'conflict'
        }

        let insertedSteps: Array<typeof agentTaskSteps.$inferSelect> = []
        if (input.plan) {
          const normalizedSteps = normalizedPlanStepsInput!
          const isReplan =
            transition.kind === 'observation' &&
            run.activePlanVersion > 0 &&
            ['running', 'verifying', 'paused'].includes(run.status) &&
            input.stepPatch?.status === 'superseded'
          const version = projectedPlanVersion
          if (isReplan)
            await tx
              .update(agentTaskSteps)
              .set({ status: 'superseded', updatedAt: input.now })
              .where(and(eq(agentTaskSteps.taskRunId, run.id), inArray(agentTaskSteps.status, ['pending', 'revising'])))
          await tx.insert(agentTaskPlans).values({
            taskRunId: run.id,
            version,
            summary: input.plan.summary,
            assumptions: input.plan.assumptions,
            verification: input.plan.verification,
            createdAt: input.now,
          })
          insertedSteps = await tx
            .insert(agentTaskSteps)
            .values(agentTaskStepValues(run.id, version, normalizedSteps, input.now))
            .returning()
          run.activePlanVersion = version
        }
        if (
          transition.kind === 'planning' &&
          !input.plan &&
          input.status === 'completed' &&
          nextRunStatus !== 'waiting_user'
        )
          throw new AgentTaskCompletionRollback('invalid_state')
        if (input.stepPatch) {
          if (!patchedStep || input.stepPatch.stepId !== patchedStep.id)
            throw new AgentTaskCompletionRollback('invalid_state')
          if (
            !allowsAgentStateEdge(agentStepStatusEdges, patchedStep.status, input.stepPatch.status) &&
            !isFinalVisualRevision
          )
            throw new AgentTaskCompletionRollback('invalid_state')
          await tx
            .update(agentTaskSteps)
            .set({
              status: input.stepPatch.status,
              lastObservation: input.stepPatch.lastObservation,
              updatedAt: input.now,
            })
            .where(and(eq(agentTaskSteps.id, input.stepPatch.stepId), eq(agentTaskSteps.taskRunId, run.id)))
        }
        if (input.stepAttempt) {
          if (!transitionStep || input.stepAttempt.stepId !== transitionStep.id)
            throw new AgentTaskCompletionRollback('invalid_state')
          const [latestAttemptNumber] = await tx
            .select({ maximum: max(agentTaskStepAttempts.attemptNumber) })
            .from(agentTaskStepAttempts)
            .where(eq(agentTaskStepAttempts.stepId, input.stepAttempt.stepId))
          const [attempt] = await tx
            .insert(agentTaskStepAttempts)
            .values({
              taskRunId: run.id,
              stepId: input.stepAttempt.stepId,
              attemptNumber: Number(latestAttemptNumber?.maximum ?? 0) + 1,
              decisionKind: input.stepAttempt.decisionKind,
              transitionKey: transition.transitionKey,
              transitionId: transition.id,
              providerCallReference: input.stepAttempt.providerCallReference,
              operationId: input.stepAttempt.operationId,
              executorRetryCount: input.stepAttempt.executorRetryCount ?? 0,
              semanticRevisionCount: input.stepAttempt.semanticRevisionCount ?? 0,
              observation: input.stepAttempt.observation,
              terminalClassification: input.stepAttempt.terminalClassification,
              createdAt: input.now,
              completedAt: input.now,
            })
            .returning()
          if (attempt)
            await tx
              .update(agentTaskTransitions)
              .set({
                stepAttemptId: attempt.id,
                operationId: input.stepAttempt.operationId ?? null,
              })
              .where(eq(agentTaskTransitions.id, transition.id))
        }
        let nextEventSequence = run.nextEventSequence
        for (const event of input.events ?? []) {
          const [existing] = await tx
            .select({ seq: agentTaskEvents.seq })
            .from(agentTaskEvents)
            .where(and(eq(agentTaskEvents.taskRunId, run.id), eq(agentTaskEvents.eventKey, event.eventKey)))
            .limit(1)
          if (existing) continue
          const resolvedEventStepId =
            event.stepId && insertedSteps.length > 0
              ? (insertedSteps.find(step => step.semanticStepKey === event.stepId)?.id ?? event.stepId)
              : (event.stepId ?? null)
          if (resolvedEventStepId) {
            const ownedEventStep =
              insertedSteps.find(step => step.id === resolvedEventStepId) ??
              (
                await tx
                  .select()
                  .from(agentTaskSteps)
                  .where(and(eq(agentTaskSteps.id, resolvedEventStepId), eq(agentTaskSteps.taskRunId, run.id)))
                  .limit(1)
              )[0]
            const supersedesCurrentPlanStep =
              Boolean(input.plan) &&
              transition.kind === 'observation' &&
              event.type === 'step_superseded' &&
              transitionStep?.id === resolvedEventStepId &&
              input.stepPatch?.stepId === resolvedEventStepId &&
              input.stepPatch.status === 'superseded'
            if (!ownedEventStep || (ownedEventStep.planVersion !== run.activePlanVersion && !supersedesCurrentPlanStep))
              throw new AgentTaskCompletionRollback('invalid_state')
          }
          const publicEvent = sanitizePublicAgentTaskEvent(event)
          await tx.insert(agentTaskEvents).values({
            taskRunId: run.id,
            seq: nextEventSequence++,
            eventKey: event.eventKey,
            stepId: resolvedEventStepId,
            type: event.type,
            summary: publicEvent.summary,
            publicPayload: publicEvent.publicPayload,
            technicalPayload: event.technicalPayload ?? {},
            redactionVersion: event.redactionVersion ?? 1,
            createdAt: input.now,
          })
        }
        let nextTransition: typeof agentTaskTransitions.$inferSelect | null = null
        if (input.nextTransition) {
          const allowedNextKinds: Readonly<Record<string, readonly string[]>> = {
            planning: ['step_action'],
            step_action: ['observation'],
            observation: ['step_action', 'final_verification'],
            final_verification: ['step_action'],
            rollback: ['rollback'],
          }
          if (!allowedNextKinds[transition.kind]?.includes(input.nextTransition.kind))
            throw new AgentTaskCompletionRollback('invalid_state')
          const nextKindAllowsRun =
            (input.nextTransition.kind === 'step_action' && nextRunStatus === 'running') ||
            (input.nextTransition.kind === 'observation' && ['running', 'verifying'].includes(nextRunStatus)) ||
            (input.nextTransition.kind === 'final_verification' && nextRunStatus === 'verifying') ||
            (input.nextTransition.kind === 'rollback' && nextRunStatus === 'rolling_back')
          if (!nextKindAllowsRun) throw new AgentTaskCompletionRollback('invalid_state')
          const ordinalStep = input.nextTransition.stepOrdinal
            ? insertedSteps.find(step => step.ordinal === input.nextTransition?.stepOrdinal)
            : undefined
          const semanticStep = input.nextTransition.stepId
            ? insertedSteps.find(step => step.semanticStepKey === input.nextTransition?.stepId)
            : undefined
          if (ordinalStep && semanticStep && ordinalStep.id !== semanticStep.id)
            throw new AgentTaskCompletionRollback('invalid_state')
          const stepId = ordinalStep?.id ?? semanticStep?.id ?? input.nextTransition.stepId ?? null
          let ownedNextStep = insertedSteps.find(step => step.id === stepId)
          if (stepId && !ownedNextStep) {
            ;[ownedNextStep] = await tx
              .select()
              .from(agentTaskSteps)
              .where(and(eq(agentTaskSteps.id, stepId), eq(agentTaskSteps.taskRunId, run.id)))
              .limit(1)
          }
          if (
            (input.nextTransition.kind === 'step_action' || input.nextTransition.kind === 'observation') !==
              Boolean(ownedNextStep) ||
            (ownedNextStep && ownedNextStep.planVersion !== run.activePlanVersion)
          )
            throw new AgentTaskCompletionRollback('invalid_state')
          const nextTransitionInput = input.nextTransition.input ?? {}
          const nextRequestDigest = agentTaskTransitionRequestDigest({
            taskRunId: run.id,
            stepId,
            kind: input.nextTransition.kind,
            transitionKey: input.nextTransition.transitionKey,
            availableAt: input.nextTransition.availableAt,
            payload: nextTransitionInput,
          })
          const [insertedNextTransition] = await tx
            .insert(agentTaskTransitions)
            .values({
              actorId,
              projectId: run.projectId,
              taskRunId: run.id,
              stepId,
              kind: input.nextTransition.kind,
              transitionKey: input.nextTransition.transitionKey,
              generation: run.nextTransitionGeneration,
              status: 'pending',
              availableAt: input.nextTransition.availableAt ?? input.now,
              input: nextTransitionInput,
              requestDigest: nextRequestDigest,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing()
            .returning()
          nextTransition = insertedNextTransition ?? null
          if (!nextTransition) {
            const [existingNextTransition] = await tx
              .select()
              .from(agentTaskTransitions)
              .where(
                and(
                  eq(agentTaskTransitions.taskRunId, run.id),
                  eq(agentTaskTransitions.transitionKey, input.nextTransition.transitionKey),
                ),
              )
              .limit(1)
            nextTransition = existingNextTransition ?? null
            if (!nextTransition || nextTransition.requestDigest !== nextRequestDigest)
              throw new AgentTaskCompletionRollback('conflict')
          }
        }
        const taskRunPatch = input.taskRunPatch ?? {}
        const terminal = ['completed', 'failed', 'canceled', 'rolled_back'].includes(nextRunStatus)
        const releasesProjectLease = agentTaskProjectLeaseReleaseStatuses.has(nextRunStatus)
        const [taskRun] = await tx
          .update(agentTaskRuns)
          .set({
            status: nextRunStatus,
            activePlanVersion: projectedPlanVersion,
            ...nextAccounting,
            nextEventSequence,
            nextTransitionGeneration: nextTransition
              ? Math.max(run.nextTransitionGeneration + 1, nextTransition.generation + 1)
              : run.nextTransitionGeneration,
            currentTransitionKey: releasesProjectLease
              ? null
              : (nextTransition?.transitionKey ?? taskRunPatch.currentTransitionKey ?? run.currentTransitionKey),
            updatedAt: input.now,
            completedAt: terminal ? input.now : run.completedAt,
          })
          .where(eq(agentTaskRuns.id, run.id))
          .returning()
        const checkpointedProviderResult = transition.output?.providerResult
        const completedOutput = input.output
          ? {
              ...input.output,
              ...(checkpointedProviderResult === undefined ? {} : { providerResult: checkpointedProviderResult }),
            }
          : transition.output
        const [completed] = await tx
          .update(agentTaskTransitions)
          .set({
            status: input.status,
            output: completedOutput ?? null,
            error: input.error ?? null,
            completionDigest,
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(and(eq(agentTaskTransitions.id, transition.id), eq(agentTaskTransitions.status, 'leased')))
          .returning()
        if (!completed || !taskRun) throw new AgentTaskCompletionRollback('stale')
        if (releasesProjectLease && agentTaskTransitionRequiresProjectLease(transition.kind)) {
          const [released] = await tx
            .update(agentProjectTaskLeases)
            .set({ leaseUntil: input.now, heartbeatAt: input.now, updatedAt: input.now })
            .where(
              and(
                eq(agentProjectTaskLeases.projectId, transition.projectId),
                eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
              ),
            )
            .returning({ projectId: agentProjectTaskLeases.projectId })
          if (!released) throw new AgentTaskCompletionRollback('stale')
        }
        return {
          transition: completed as never,
          taskRun: taskRun as never,
          nextTransition: (nextTransition as never) ?? null,
        }
      }).catch(error => {
        if (error instanceof AgentTaskCompletionRollback) return error.result
        throw error
      })
    },
    reconcileAgentTaskTransition(actorId, fence, now) {
      return withActor(actorId, async tx => {
        const [transition] = await tx
          .select()
          .from(agentTaskTransitions)
          .where(and(eq(agentTaskTransitions.id, fence.transitionId), eq(agentTaskTransitions.actorId, actorId)))
          .for('update')
          .limit(1)
        if (!transition) return null
        if (transition.status === 'pending')
          return { transition: transition as never, classification: 'already_pending' as const }
        if (
          transition.status === 'failed' &&
          transition.error?.code === 'provider_outcome_unknown' &&
          matchesAgentTaskLease(transition, fence)
        )
          return { transition: transition as never, classification: 'provider_outcome_unknown_paused' as const }
        if (transition.status !== 'leased' || !matchesAgentTaskLease(transition, fence)) return 'stale'
        if (transition.leaseUntil && transition.leaseUntil > now)
          return { transition: transition as never, classification: 'lease_live' as const }
        if (agentTaskTransitionRequiresProjectLease(transition.kind)) {
          if (!matchesAgentProjectTaskLease(transition, fence)) return 'stale'
          const [projectLease] = await tx
            .select({ projectId: agentProjectTaskLeases.projectId })
            .from(agentProjectTaskLeases)
            .where(
              and(
                eq(agentProjectTaskLeases.projectId, transition.projectId),
                eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
              ),
            )
            .for('update')
            .limit(1)
          if (!projectLease) return 'stale'
        }
        const [attempt] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(
            and(
              eq(agentProviderAttempts.taskTransitionId, transition.id),
              inArray(agentProviderAttempts.state, ['started', 'outcome_unknown']),
            ),
          )
          .orderBy(desc(agentProviderAttempts.attemptNo))
          .for('update')
          .limit(1)
        if (attempt) {
          const paused = await pauseTransitionForUnknownProviderOutcome(tx, actorId, transition, attempt, now, {
            accountingAlreadyApplied: unknownProviderOutcomeAccountingAlreadyApplied(attempt),
          })
          if (paused === 'invalid_state') return 'stale'
          if (paused === 'stale') return paused
          return { transition: paused.transition as never, classification: 'provider_outcome_unknown_paused' as const }
        }
        const [pending] = await tx
          .update(agentTaskTransitions)
          .set({
            status: 'pending',
            leaseOwner: null,
            leaseToken: null,
            leaseUntil: null,
            heartbeatAt: null,
            availableAt: now,
            updatedAt: now,
          })
          .where(eq(agentTaskTransitions.id, transition.id))
          .returning()
        return pending ? { transition: pending as never, classification: 'requeued' as const } : 'stale'
      })
    },
    pauseAgentTaskTransitionUnknownOutcome(actorId, fence, input) {
      return withActor(actorId, async tx => {
        const [transition] = await tx
          .select()
          .from(agentTaskTransitions)
          .where(and(eq(agentTaskTransitions.id, fence.transitionId), eq(agentTaskTransitions.actorId, actorId)))
          .for('update')
          .limit(1)
        if (!transition || !matchesAgentTaskLease(transition, fence)) return 'stale'
        const needsProjectLease = agentTaskTransitionRequiresProjectLease(transition.kind)
        if (needsProjectLease && !matchesAgentProjectTaskLease(transition, fence)) return 'stale'
        if (!['leased', 'failed'].includes(transition.status)) return 'invalid_state'
        const [attempt] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(
            and(
              eq(agentProviderAttempts.taskTransitionId, transition.id),
              inArray(agentProviderAttempts.state, ['started', 'outcome_unknown']),
            ),
          )
          .orderBy(desc(agentProviderAttempts.attemptNo))
          .for('update')
          .limit(1)
        if (!attempt) return 'invalid_state'
        const paused = await pauseTransitionForUnknownProviderOutcome(tx, actorId, transition, attempt, input.now, {
          event: input.event,
          operationalEvent: input.operationalEvent,
          accountingAlreadyApplied: unknownProviderOutcomeAccountingAlreadyApplied(attempt),
        })
        return typeof paused === 'string'
          ? paused
          : { transition: paused.transition as never, classification: 'provider_outcome_unknown_paused' as const }
      })
    },
    async reconcileAgentTaskTransitions(now, limit = 100) {
      const result =
        (await db.execute(sql`select reconciled.id, reconciled.actor_id as "actorId", reconciled.project_id as "projectId",
        reconciled.task_run_id as "taskRunId", reconciled.step_id as "stepId", reconciled.kind,
        reconciled.transition_key as "transitionKey", reconciled.generation, reconciled.status,
        reconciled.available_at as "availableAt", reconciled.lease_owner as "leaseOwner",
        reconciled.lease_generation as "leaseGeneration", reconciled.lease_token as "leaseToken",
        reconciled.lease_until as "leaseUntil", reconciled.heartbeat_at as "heartbeatAt",
        reconciled.project_lease_generation as "projectLeaseGeneration",
        reconciled.project_lease_token as "projectLeaseToken",
        reconciled.project_lease_worker_id as "projectLeaseWorkerId",
        reconciled.claim_attempts as "claimAttempts", reconciled.operation_id as "operationId",
        reconciled.step_attempt_id as "stepAttemptId", reconciled.input_json as input,
        reconciled.request_digest as "requestDigest", reconciled.completion_digest as "completionDigest",
        reconciled.output_json as output, reconciled.error_json as error, reconciled.created_at as "createdAt",
        reconciled.updated_at as "updatedAt", reconciled.completed_at as "completedAt",
        case when reconciled.status='failed' and reconciled.error_json->>'code'='provider_outcome_unknown'
          then 'provider_outcome_unknown_paused' else 'requeued' end as "reconciliationClassification"
        from app.reconcile_agent_task_transitions(${now}, ${Math.max(1, Math.min(limit, 500))}) reconciled`)) as unknown as {
          rows?: Array<
            Record<string, unknown> & { reconciliationClassification: 'provider_outcome_unknown_paused' | 'requeued' }
          >
        }
      return (result.rows ?? []).map(({ reconciliationClassification, ...transition }) => ({
        transition,
        classification: reconciliationClassification,
      })) as never
    },
    appendAgentTaskOperationalEvent(actorId, input) {
      return withActor(actorId, async tx => {
        const [event] = await tx
          .insert(agentTaskOperationalEvents)
          .values({
            dedupeKey: input.dedupeKey,
            actorId,
            projectId: input.projectId,
            taskRunId: input.taskRunId,
            transitionId: input.transitionId,
            operationId: input.operationId,
            code: input.code,
            severity: input.severity,
            details: input.details ?? {},
            createdAt: input.now,
          })
          .onConflictDoNothing()
          .returning()
        if (event) return event as never
        const [existing] = await tx
          .select()
          .from(agentTaskOperationalEvents)
          .where(eq(agentTaskOperationalEvents.dedupeKey, input.dedupeKey))
          .limit(1)
        if (!existing) throw new Error('Agent task operational event insert returned no row')
        return existing as never
      })
    },
    ensurePersonalSpace(actorId) {
      return withActor(actorId, tx => ensurePersonalSpaceWithTx(tx, actorId))
    },
    listProjects(actorId, scope = 'active') {
      return withActor(actorId, tx =>
        tx
          .select(projectSummarySelection(actorId))
          .from(projects)
          .leftJoin(
            projectPublications,
            and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
          )
          .leftJoin(
            projectReleases,
            and(
              eq(projectReleases.projectId, projects.id),
              eq(projectReleases.revisionId, projectPublications.revisionId),
            ),
          )
          .where(
            and(
              canReadProject(actorId),
              scope === 'trashed' ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt),
            ),
          )
          .orderBy(
            desc(sql<boolean>`exists (
              select 1 from ${projectFavorites}
              where ${projectFavorites.projectId} = ${projects.id}
                and ${projectFavorites.userId} = ${actorId}
            )`),
            desc(projects.updatedAt),
          ),
      )
    },
    createProject(actorId, input) {
      return withActor(actorId, async tx => {
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const metadata = projectMetadata(input.schema)
        const projectId = randomUUID()
        await tx.insert(projects).values({
          id: projectId,
          ownerId: actorId,
          spaceId,
          name: input.name,
          description: input.description ?? null,
          coverUrl: input.coverUrl ?? null,
          draftSchema: input.schema,
          ...metadata,
        })
        await insertProjectOwnerMembership(tx, projectId, actorId)
        const project = await selectProjectDetail(tx, actorId, projectId)
        if (!project) throw new Error('Created project could not be read')
        return project
      })
    },
    startAgentProject(actorId, input) {
      return withActor(actorId, async tx => {
        const createLegacyDispatch = input.createLegacyDispatch !== false
        if (createLegacyDispatch && !input.dispatch) {
          throw new Error('Legacy Agent start requires dispatch metadata')
        }
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-start:${input.idempotencyKey}`}, 0))`,
        )
        const [existing] = await tx
          .select({ id: projects.id, inputDigest: projects.agentStartInputDigest })
          .from(projects)
          .where(and(eq(projects.ownerId, actorId), eq(projects.agentStartIdempotencyKey, input.idempotencyKey)))
          .limit(1)
        if (existing) {
          if (existing.inputDigest !== input.inputDigest) return 'conflict'
          const [workspace] = await tx
            .select()
            .from(agentWorkspaces)
            .where(and(eq(agentWorkspaces.ownerId, actorId), eq(agentWorkspaces.projectId, existing.id)))
            .limit(1)
          const project = await selectProjectDetail(tx, actorId, existing.id)
          const [dispatch] = createLegacyDispatch
            ? await tx
                .select()
                .from(agentRunDispatches)
                .where(
                  and(
                    eq(agentRunDispatches.actorId, actorId),
                    eq(agentRunDispatches.projectId, existing.id),
                    eq(agentRunDispatches.kind, 'initial'),
                  ),
                )
                .limit(1)
            : [undefined]
          if (!workspace || !project || (createLegacyDispatch && !dispatch)) {
            throw new Error('Idempotent Agent start could not be replayed')
          }
          return {
            project,
            workspace: workspace as AgentWorkspaceRecord,
            ...(dispatch ? { dispatch: dispatch as AgentRunDispatchRecord } : {}),
          } satisfies AgentProjectStartRecord
        }
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const metadata = projectMetadata(input.project.schema)
        await tx.insert(projects).values({
          id: input.project.id,
          ownerId: actorId,
          spaceId,
          name: input.project.name,
          description: input.project.description ?? null,
          coverUrl: input.project.coverUrl ?? null,
          draftSchema: input.project.schema,
          agentStartIdempotencyKey: input.idempotencyKey,
          agentStartInputDigest: input.inputDigest,
          ...metadata,
        })
        await insertProjectOwnerMembership(tx, input.project.id, actorId)
        const [workspace] = await tx
          .insert(agentWorkspaces)
          .values({
            ownerId: actorId,
            projectId: input.project.id,
            payload: input.workspacePayload,
          })
          .returning()
        if (!workspace) throw new Error('Agent workspace insert returned no row')
        const [dispatch] = createLegacyDispatch
          ? await tx
              .insert(agentRunDispatches)
              .values({
                actorId,
                projectId: input.project.id,
                conversationId: input.dispatch!.conversationId,
                taskId: input.dispatch!.taskId,
                operationId: input.dispatch!.operationId,
                kind: 'initial',
                state: input.dispatch!.waitingForUpload ? 'paused' : 'queued',
                desiredState: input.dispatch!.waitingForUpload ? 'paused' : 'running',
                waitingReason: input.dispatch!.waitingForUpload ? 'upload' : null,
              })
              .returning()
          : [undefined]
        if (createLegacyDispatch && !dispatch) throw new Error('Agent initial dispatch insert returned no row')
        const project = await selectProjectDetail(tx, actorId, input.project.id)
        if (!project) throw new Error('Created Agent project could not be read')
        return {
          project,
          workspace: workspace as AgentWorkspaceRecord,
          ...(dispatch ? { dispatch: dispatch as AgentRunDispatchRecord } : {}),
        } satisfies AgentProjectStartRecord
      })
    },
    getProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        return selectProjectDetail(tx, actorId, projectId)
      })
    },
    listProjectMembers(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
          .limit(1)
        if (!membership) return null
        return tx
          .select()
          .from(projectMembers)
          .where(eq(projectMembers.projectId, projectId))
          .orderBy(asc(projectMembers.createdAt), asc(projectMembers.userId))
      })
    },
    setProjectMemberRole(actorId, projectId, userId, role) {
      return withActor(actorId, async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:project-members`}, 0))`)
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
          .limit(1)
        if (!membership) return null
        if (membership.role !== 'owner') return 'forbidden'
        const [target] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
          .limit(1)
        if (target?.role === 'owner' && role !== 'owner') {
          const [{ ownerCount = 0 } = {}] = await tx
            .select({ ownerCount: sql<number>`count(*)::integer` })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')))
          if (ownerCount <= 1) return 'last_owner'
        }
        const [updated] = await tx
          .insert(projectMembers)
          .values({ projectId, userId, role, createdBy: actorId })
          .onConflictDoUpdate({
            target: [projectMembers.projectId, projectMembers.userId],
            set: { role },
          })
          .returning()
        return updated ?? null
      })
    },
    removeProjectMember(actorId, projectId, userId) {
      return withActor(actorId, async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${projectId}:project-members`}, 0))`)
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
          .limit(1)
        if (!membership) return null
        if (membership.role !== 'owner') return 'forbidden'
        const [target] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
          .limit(1)
        if (!target) return null
        if (target.role === 'owner') {
          const [{ ownerCount = 0 } = {}] = await tx
            .select({ ownerCount: sql<number>`count(*)::integer` })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')))
          if (ownerCount <= 1) return 'last_owner'
        }
        const [removed] = await tx
          .delete(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
          .returning({ userId: projectMembers.userId })
        return removed ? true : null
      })
    },
    isProjectOwner(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(
            and(
              eq(projects.id, projectId),
              eq(projectMembers.userId, actorId),
              eq(projectMembers.role, 'owner'),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return Boolean(project)
      })
    },
    getAgentProjectModelConfig(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ config: projects.agentModelConfiguration })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return project?.config ?? null
      })
    },
    updateAgentProjectModelConfig(actorId, projectId, config) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ agentModelConfiguration: config, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), canOwnProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        return Boolean(updated)
      })
    },
    compareAndSetAgentProjectModelConfig(actorId, projectId, expected, config) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ agentModelConfiguration: config, updatedAt: new Date() })
          .where(
            and(
              eq(projects.id, projectId),
              canOwnProject(actorId),
              sql`${projects.agentModelConfiguration} = ${JSON.stringify(expected)}::jsonb`,
              isNull(projects.deletedAt),
            ),
          )
          .returning({ id: projects.id })
        return Boolean(updated)
      })
    },
    getEditableProjectForAgentSpike(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            draftVersion: projects.draftVersion,
            draftSchema: projects.draftSchema,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return project ?? null
      })
    },
    issueAgentSpikeOperation(actorId, input) {
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, input.operationId)
        const issueDigest = agentSpikeIssueDigest({
          actorId,
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
        const existing = await selectAgentSpikeOperation(tx, actorId, input.operationId, true)
        if (existing) {
          return compareAgentSpikeDigest(existing.issueDigest, issueDigest) === 'same'
            ? existing
            : ('integrity_conflict' as const)
        }
        if (input.expiresAt.getTime() <= Date.now()) return 'invalid_state'
        const [project] = await tx
          .select({ id: projects.id, draftVersion: projects.draftVersion, draftSchema: projects.draftSchema })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== input.baseDraftVersion) return 'conflict'
        const [operation] = await tx
          .insert(agentSpikeOperations)
          .values({
            actorId,
            projectId: input.projectId,
            taskId: input.taskId,
            stageId: input.stageId,
            executorId: input.executorId,
            operationId: input.operationId,
            grantJti: input.grantJti,
            baseDraftVersion: input.baseDraftVersion,
            inputDigest: input.inputDigest,
            executorInput: input.executorInput,
            issueDigest,
            skillTrace: input.skillTrace,
            compatibility: input.compatibility,
            expiresAt: input.expiresAt,
          })
          .returning()
        if (!operation) throw new Error('Agent spike operation insert returned no row')
        return operation
      })
    },
    prepareAgentSpikeOperation(
      actorId,
      binding,
      authorityOrInput:
        | AgentMutationAuthority
        | { candidateSchema: ProjectSchema; hostReceipt: Record<string, unknown>; evidence: Record<string, unknown> },
      maybeInput?: {
        candidateSchema: ProjectSchema
        hostReceipt: Record<string, unknown>
        evidence: Record<string, unknown>
      },
    ) {
      const authority = maybeInput ? (authorityOrInput as AgentMutationAuthority) : {}
      const input = (maybeInput ?? authorityOrInput) as {
        candidateSchema: ProjectSchema
        hostReceipt: Record<string, unknown>
        evidence: Record<string, unknown>
      }
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, binding.operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, binding.operationId, true)
        if (!operation) return null
        if (!agentSpikeBindingMatches(operation, binding)) return 'integrity_conflict'
        const dispatchFence = await agentRunDispatchAllowsOperation(tx, actorId, binding.operationId, authority)
        if (!dispatchFence.allowed) return 'attempt_stale'
        const candidateDigest = agentSpikeCandidateDigest(input.candidateSchema)
        const preparedDigest = agentSpikePreparedDigest(input)
        if (operation.status !== 'issued') {
          if (
            !operation.preparedDigest ||
            compareAgentSpikeDigest(operation.preparedDigest, preparedDigest) === 'integrity_conflict'
          ) {
            return 'integrity_conflict'
          }
          return operation.status === 'prepared' || operation.status === 'committed' ? operation : 'invalid_state'
        }
        if (!dispatchFence.dispatchExists && operation.expiresAt.getTime() <= Date.now()) {
          const completedAt = new Date()
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'failed_not_applied',
              outcome: { status: 'failed_not_applied', reason: 'operation_expired' },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'issued')))
          return 'invalid_state'
        }
        const preparedAt = new Date()
        const [prepared] = await tx
          .update(agentSpikeOperations)
          .set({
            status: 'prepared',
            candidateDigest,
            preparedDigest,
            candidateSchema: input.candidateSchema,
            hostReceipt: input.hostReceipt,
            evidence: input.evidence,
            preparedAt,
            updatedAt: preparedAt,
          })
          .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'issued')))
          .returning()
        if (!prepared) throw new Error('Agent spike operation prepare returned no row')
        return prepared
      })
    },
    commitAgentSpikeStage(actorId, binding, authority = {}) {
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, binding.operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, binding.operationId, true)
        if (!operation) return null
        if (!agentSpikeBindingMatches(operation, binding)) return 'integrity_conflict'
        const dispatchFence = await agentRunDispatchAllowsOperation(tx, actorId, binding.operationId, authority)
        if (!dispatchFence.allowed) return 'attempt_stale'
        if (operation.status === 'committed') return operation
        if (
          operation.status !== 'prepared' ||
          !operation.candidateSchema ||
          !operation.candidateDigest ||
          !operation.preparedDigest ||
          !operation.hostReceipt ||
          !operation.evidence
        ) {
          return 'invalid_state'
        }
        if (!dispatchFence.dispatchExists && operation.expiresAt.getTime() <= Date.now()) {
          const completedAt = new Date()
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'failed_not_applied',
              outcome: { status: 'failed_not_applied', reason: 'operation_expired' },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          return 'invalid_state'
        }
        const candidateDigest = agentSpikeCandidateDigest(operation.candidateSchema)
        const preparedDigest = agentSpikePreparedDigest({
          candidateSchema: operation.candidateSchema,
          hostReceipt: operation.hostReceipt,
          evidence: operation.evidence,
        })
        if (candidateDigest !== operation.candidateDigest || preparedDigest !== operation.preparedDigest) {
          const completedAt = new Date()
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'indeterminate',
              outcome: { status: 'indeterminate', reason: 'persisted_prepare_digest_mismatch' },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          return 'integrity_conflict'
        }

        const [project] = await tx
          .select({ id: projects.id, draftVersion: projects.draftVersion, draftSchema: projects.draftSchema })
          .from(projects)
          .where(and(eq(projects.id, binding.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const completedAt = new Date()
        if (project.draftVersion !== operation.baseDraftVersion) {
          await tx
            .update(agentSpikeOperations)
            .set({
              status: 'rejected_stale',
              outcome: {
                status: 'rejected_stale',
                expectedDraftVersion: operation.baseDraftVersion,
                actualDraftVersion: project.draftVersion,
              },
              completedAt,
              updatedAt: completedAt,
            })
            .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          return 'conflict'
        }

        const rollbackRevision = await insertRevision(tx, {
          actorId,
          projectId: binding.projectId,
          schema: project.draftSchema,
          kind: 'agent',
          sourceDraftVersion: project.draftVersion,
          label: `Agent 执行前 · ${binding.taskId}`.slice(0, 120),
        })

        const committedDraftVersion = operation.baseDraftVersion + 1
        const [updated] = await tx
          .update(projects)
          .set({
            draftSchema: operation.candidateSchema,
            draftVersion: committedDraftVersion,
            draftSavedAt: completedAt,
            ...projectMetadata(operation.candidateSchema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(committedDraftVersion),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(projects.id, binding.projectId),
              canEditProject(actorId),
              eq(projects.draftVersion, operation.baseDraftVersion),
              isNull(projects.deletedAt),
            ),
          )
          .returning({ id: projects.id })
        if (!updated) {
          throw new Error('Locked Agent spike project failed its draft-version compare-and-set')
        }

        const [latestAuto] = await tx
          .select({ createdAt: projectRevisions.createdAt })
          .from(projectRevisions)
          .where(and(eq(projectRevisions.projectId, binding.projectId), eq(projectRevisions.kind, 'auto')))
          .orderBy(desc(projectRevisions.createdAt))
          .limit(1)
        if (!latestAuto || completedAt.getTime() - latestAuto.createdAt.getTime() >= 5 * 60 * 1000) {
          await insertRevision(tx, {
            actorId,
            projectId: binding.projectId,
            schema: operation.candidateSchema,
            kind: 'auto',
            sourceDraftVersion: committedDraftVersion,
          })
        }

        const outcome = {
          status: 'committed',
          committedDraftVersion,
          candidateDigest: operation.candidateDigest,
          rollbackRevisionId: rollbackRevision.id,
        }
        const [committed] = await tx
          .update(agentSpikeOperations)
          .set({
            status: 'committed',
            committedDraftVersion,
            rollbackRevisionId: rollbackRevision.id,
            outcome,
            completedAt,
            updatedAt: completedAt,
          })
          .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, 'prepared')))
          .returning()
        if (!committed) throw new Error('Agent spike committed outcome returned no row')
        return committed
      })
    },
    getAgentSpikeOperationOutcome(actorId, operationId) {
      return withActor(actorId, tx => selectAgentSpikeOperation(tx, actorId, operationId))
    },
    getAgentSpikeOperationOutcomeByTask(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        const [operation] = await tx
          .select()
          .from(agentSpikeOperations)
          .where(
            and(
              eq(agentSpikeOperations.actorId, actorId),
              eq(agentSpikeOperations.projectId, projectId),
              eq(agentSpikeOperations.taskId, taskId),
            ),
          )
          .orderBy(desc(agentSpikeOperations.createdAt))
          .limit(1)
        return (operation as AgentSpikeOperationRecord | undefined) ?? null
      })
    },
    async createAgentScreenshotArtifactUpload(actorId, accessToken, projectId, operationId, input) {
      const reserved = await withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, operationId, true)
        if (!operation || operation.projectId !== projectId) return null
        if (!['prepared', 'committed'].includes(operation.status) || !operation.candidateDigest) {
          return 'invalid_state' as const
        }
        const candidateDraftVersion = operation.committedDraftVersion ?? operation.baseDraftVersion + 1
        if (operation.candidateDigest !== input.candidateSha256 || candidateDraftVersion !== input.draftVersion) {
          return 'conflict' as const
        }
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .innerJoin(projects, eq(projects.id, projectMembers.projectId))
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, actorId),
              inArray(projectMembers.role, ['owner', 'editor']),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        if (!membership) return null
        const [existing] = await tx
          .select(agentScreenshotArtifactSelection)
          .from(agentScreenshotArtifacts)
          .where(
            and(
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.agentOperationId, operation.id),
            ),
          )
          .for('update')
          .limit(1)
        if (existing) {
          const exactReplay =
            existing.projectId === projectId &&
            existing.operationId === operationId &&
            existing.candidateSha256 === input.candidateSha256 &&
            existing.draftVersion === input.draftVersion &&
            existing.contentType === input.contentType &&
            existing.size === input.size &&
            existing.sha256 === input.sha256
          if (!exactReplay || existing.status === 'failed') return 'conflict' as const
          return existing
        }
        const artifactId = randomUUID()
        const storagePath = `${actorId}/${projectId}/${artifactId}.png`
        const [artifact] = await tx
          .insert(agentScreenshotArtifacts)
          .values({
            id: artifactId,
            actorId,
            projectId,
            agentOperationId: operation.id,
            operationId,
            candidateSha256: input.candidateSha256,
            draftVersion: input.draftVersion,
            contentType: input.contentType,
            size: input.size,
            sha256: input.sha256,
            storagePath,
          })
          .returning(agentScreenshotArtifactSelection)
        if (!artifact) throw new Error('Agent screenshot artifact reservation returned no row')
        return artifact
      })
      if (!reserved || reserved === 'conflict' || reserved === 'invalid_state') return reserved
      if (reserved.status === 'ready') return { artifact: reserved, alreadyCompleted: true as const }
      const { data, error } = await agentScreenshotArtifactStorage(accessToken).createSignedUploadUrl(
        reserved.storagePath,
      )
      if (error || !data) throw new Error(error?.message ?? 'Unable to sign Agent screenshot artifact upload')
      return {
        artifact: reserved,
        bucket: AGENT_SCREENSHOT_ARTIFACT_BUCKET,
        path: reserved.storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
        maxBytes: MAX_AGENT_SCREENSHOT_ARTIFACT_BYTES,
        expiresIn: 7200,
        alreadyCompleted: false as const,
      }
    },
    async completeAgentScreenshotArtifactUpload(actorId, accessToken, projectId, operationId, input) {
      const artifact = await withActor(actorId, async tx => {
        const [row] = await tx
          .select(agentScreenshotArtifactSelection)
          .from(agentScreenshotArtifacts)
          .innerJoin(agentSpikeOperations, eq(agentSpikeOperations.id, agentScreenshotArtifacts.agentOperationId))
          .where(
            and(
              eq(agentScreenshotArtifacts.id, input.artifactId),
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.projectId, projectId),
              eq(agentScreenshotArtifacts.operationId, operationId),
              eq(agentSpikeOperations.actorId, actorId),
              eq(agentSpikeOperations.projectId, projectId),
              eq(agentSpikeOperations.operationId, operationId),
            ),
          )
          .limit(1)
        return row ?? null
      })
      if (!artifact) return null
      if (artifact.storagePath !== input.path) return 'integrity_conflict'
      if (artifact.status === 'ready') return artifact as AgentScreenshotArtifactRecord
      if (artifact.status !== 'uploading') return 'invalid'
      const storage = agentScreenshotArtifactStorage(accessToken)
      const { data: info, error: infoError } = await storage.info(input.path)
      if (infoError) throw new Error(infoError.message || 'Unable to inspect Agent screenshot artifact')
      let valid = Boolean(
        info && info.size === artifact.size && info.contentType?.toLowerCase().startsWith(artifact.contentType),
      )
      let digest: string | null = null
      if (valid) {
        const { data, error } = await storage.download(input.path)
        if (error) throw new Error(error.message || 'Unable to download Agent screenshot artifact')
        if (data) {
          const bytes = new Uint8Array(await data.arrayBuffer())
          digest = createHash('sha256').update(bytes).digest('hex')
          valid =
            bytes.byteLength === artifact.size &&
            bytes.length >= 8 &&
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a &&
            digest === artifact.sha256
        } else {
          valid = false
        }
      }
      if (!valid || digest !== artifact.sha256) {
        await withActor(actorId, async tx => {
          await tx
            .update(agentScreenshotArtifacts)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              and(
                eq(agentScreenshotArtifacts.id, artifact.id),
                eq(agentScreenshotArtifacts.actorId, actorId),
                eq(agentScreenshotArtifacts.status, 'uploading'),
              ),
            )
        })
        await storage.remove([artifact.storagePath]).catch(() => undefined)
        return 'invalid'
      }
      return withActor(actorId, async tx => {
        const completedAt = new Date()
        const [completed] = await tx
          .update(agentScreenshotArtifacts)
          .set({ status: 'ready', completedAt, updatedAt: completedAt })
          .where(
            and(
              eq(agentScreenshotArtifacts.id, artifact.id),
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.projectId, projectId),
              eq(agentScreenshotArtifacts.status, 'uploading'),
              eq(agentScreenshotArtifacts.sha256, digest!),
            ),
          )
          .returning(agentScreenshotArtifactSelection)
        if (completed) return completed as AgentScreenshotArtifactRecord
        const [replayed] = await tx
          .select(agentScreenshotArtifactSelection)
          .from(agentScreenshotArtifacts)
          .where(
            and(
              eq(agentScreenshotArtifacts.id, artifact.id),
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.status, 'ready'),
            ),
          )
          .limit(1)
        return (replayed as AgentScreenshotArtifactRecord | undefined) ?? null
      })
    },
    async getAgentScreenshotArtifactDownload(actorId, accessToken, projectId, operationId) {
      const artifact = await withActor(actorId, async tx => {
        const [row] = await tx
          .select(agentScreenshotArtifactSelection)
          .from(agentScreenshotArtifacts)
          .where(
            and(
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.projectId, projectId),
              eq(agentScreenshotArtifacts.operationId, operationId),
              eq(agentScreenshotArtifacts.status, 'ready'),
            ),
          )
          .limit(1)
        return row ?? null
      })
      if (!artifact) return null
      const { data, error } = await agentScreenshotArtifactStorage(accessToken).createSignedUrl(
        artifact.storagePath,
        AGENT_SCREENSHOT_ARTIFACT_URL_EXPIRES_IN,
      )
      if (error || !data) return null
      return {
        artifact: artifact as AgentScreenshotArtifactRecord,
        signedUrl: data.signedUrl,
        expiresIn: AGENT_SCREENSHOT_ARTIFACT_URL_EXPIRES_IN,
      }
    },
    async getAgentScreenshotArtifactModelInput(actorId, storageSecret, projectId, operationId) {
      const artifact = await withActor(actorId, async tx => {
        const [row] = await tx
          .select(agentScreenshotArtifactSelection)
          .from(agentScreenshotArtifacts)
          .where(
            and(
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.projectId, projectId),
              eq(agentScreenshotArtifacts.operationId, operationId),
              eq(agentScreenshotArtifacts.status, 'ready'),
            ),
          )
          .limit(1)
        return row ?? null
      })
      if (!artifact) return null
      if (artifact.size > 4 * 1024 * 1024) return 'oversize'
      const { data, error } = await agentScreenshotArtifactAdminStorage(storageSecret).download(artifact.storagePath)
      if (error || !data) return null
      const bytes = new Uint8Array(await data.arrayBuffer())
      if (bytes.byteLength !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
        return null
      }
      return { record: artifact as AgentScreenshotArtifactRecord, bytes }
    },
    async persistAgentScreenshotArtifact(actorId, storageSecret, projectId, operationId, bytes) {
      if (
        bytes.byteLength < 8 ||
        bytes.byteLength > MAX_AGENT_SCREENSHOT_ARTIFACT_BYTES ||
        bytes[0] !== 0x89 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x4e ||
        bytes[3] !== 0x47 ||
        bytes[4] !== 0x0d ||
        bytes[5] !== 0x0a ||
        bytes[6] !== 0x1a ||
        bytes[7] !== 0x0a
      ) {
        return 'conflict'
      }
      const digest = createHash('sha256').update(bytes).digest('hex')
      const reserved = await withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, operationId, true)
        if (!operation || operation.projectId !== projectId) return null
        if (!['prepared', 'committed'].includes(operation.status) || !operation.candidateDigest) {
          return 'invalid_state' as const
        }
        const render =
          operation.evidence?.render && typeof operation.evidence.render === 'object'
            ? (operation.evidence.render as Record<string, unknown>)
            : null
        if (render?.screenshotSha256 !== digest) return 'conflict' as const
        const draftVersion = operation.committedDraftVersion ?? operation.baseDraftVersion + 1
        const [existing] = await tx
          .select(agentScreenshotArtifactSelection)
          .from(agentScreenshotArtifacts)
          .where(
            and(
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.agentOperationId, operation.id),
            ),
          )
          .for('update')
          .limit(1)
        if (existing) {
          const exactReplay =
            existing.projectId === projectId &&
            existing.operationId === operationId &&
            existing.candidateSha256 === operation.candidateDigest &&
            existing.draftVersion === draftVersion &&
            existing.contentType === 'image/png' &&
            existing.size === bytes.byteLength &&
            existing.sha256 === digest
          if (!exactReplay || existing.status === 'failed') return 'conflict' as const
          return existing
        }
        const artifactId = randomUUID()
        const [artifact] = await tx
          .insert(agentScreenshotArtifacts)
          .values({
            id: artifactId,
            actorId,
            projectId,
            agentOperationId: operation.id,
            operationId,
            candidateSha256: operation.candidateDigest,
            draftVersion,
            contentType: 'image/png',
            size: bytes.byteLength,
            sha256: digest,
            storagePath: `${actorId}/${projectId}/${artifactId}.png`,
          })
          .returning(agentScreenshotArtifactSelection)
        if (!artifact) throw new Error('Agent screenshot artifact reservation returned no row')
        return artifact
      })
      if (!reserved || reserved === 'conflict' || reserved === 'invalid_state') return reserved
      if (reserved.status === 'ready') return reserved as AgentScreenshotArtifactRecord
      const storage = agentScreenshotArtifactAdminStorage(storageSecret)
      const { error: uploadError } = await storage.upload(reserved.storagePath, bytes, {
        contentType: 'image/png',
        upsert: true,
      })
      if (uploadError) throw new Error(uploadError.message || 'Unable to upload Agent screenshot artifact')
      const { data: downloaded, error: downloadError } = await storage.download(reserved.storagePath)
      if (downloadError || !downloaded) {
        throw new Error(downloadError?.message || 'Unable to verify Agent screenshot artifact')
      }
      const persistedBytes = new Uint8Array(await downloaded.arrayBuffer())
      if (
        persistedBytes.byteLength !== reserved.size ||
        createHash('sha256').update(persistedBytes).digest('hex') !== reserved.sha256
      ) {
        await storage.remove([reserved.storagePath]).catch(() => undefined)
        await withActor(actorId, tx =>
          tx
            .update(agentScreenshotArtifacts)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              and(
                eq(agentScreenshotArtifacts.id, reserved.id),
                eq(agentScreenshotArtifacts.actorId, actorId),
                eq(agentScreenshotArtifacts.status, 'uploading'),
              ),
            ),
        )
        return 'conflict'
      }
      return withActor(actorId, async tx => {
        const completedAt = new Date()
        const [completed] = await tx
          .update(agentScreenshotArtifacts)
          .set({ status: 'ready', completedAt, updatedAt: completedAt })
          .where(
            and(
              eq(agentScreenshotArtifacts.id, reserved.id),
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.status, 'uploading'),
              eq(agentScreenshotArtifacts.sha256, digest),
            ),
          )
          .returning(agentScreenshotArtifactSelection)
        if (completed) return completed as AgentScreenshotArtifactRecord
        const [replayed] = await tx
          .select(agentScreenshotArtifactSelection)
          .from(agentScreenshotArtifacts)
          .where(
            and(
              eq(agentScreenshotArtifacts.id, reserved.id),
              eq(agentScreenshotArtifacts.actorId, actorId),
              eq(agentScreenshotArtifacts.status, 'ready'),
            ),
          )
          .limit(1)
        return (replayed as AgentScreenshotArtifactRecord | undefined) ?? null
      })
    },
    enqueueAgentRunDispatch(actorId, input) {
      return withActor(actorId, async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-dispatch:${input.operationId}`}, 0))`,
        )
        const [existing] = await tx
          .select()
          .from(agentRunDispatches)
          .where(and(eq(agentRunDispatches.actorId, actorId), eq(agentRunDispatches.operationId, input.operationId)))
          .limit(1)
        if (existing) {
          const matches =
            existing.projectId === input.projectId &&
            existing.conversationId === input.conversationId &&
            existing.taskId === input.taskId
          if (!matches) throw new Error('Agent run dispatch operation was rebound to a different task')
          return existing as AgentRunDispatchRecord
        }
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const [created] = await tx
          .insert(agentRunDispatches)
          .values({
            actorId,
            projectId: input.projectId,
            conversationId: input.conversationId,
            taskId: input.taskId,
            operationId: input.operationId,
            ...(input.now ? { createdAt: input.now, updatedAt: input.now } : {}),
          })
          .returning()
        if (!created) throw new Error('Agent run dispatch insert returned no row')
        return created as AgentRunDispatchRecord
      })
    },
    enqueueAgentTurn(actorId, input) {
      return withActor(actorId, async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-turn:${input.projectId}:${input.turnId}`}, 0))`,
        )
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null

        const [existingDispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              or(
                eq(agentRunDispatches.operationId, input.operationId),
                eq(agentRunDispatches.turnId, input.turnId),
                and(
                  eq(agentRunDispatches.kind, 'initial'),
                  eq(agentRunDispatches.taskId, input.taskId),
                  isNull(agentRunDispatches.turnId),
                ),
              ),
            ),
          )
          .for('update')
          .limit(1)
        if (
          existingDispatch &&
          ((existingDispatch.turnId !== null && existingDispatch.turnId !== input.turnId) ||
            existingDispatch.taskId !== input.taskId ||
            (existingDispatch.inputDigest !== null && existingDispatch.inputDigest !== input.inputDigest))
        ) {
          return 'conflict'
        }

        const [existingCost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (existingCost && (existingCost.taskId !== input.taskId || existingCost.inputDigest !== input.inputDigest)) {
          return 'conflict'
        }

        let cost = existingCost
        if (!cost) {
          if (input.reservedMicros > input.taskLimitMicros) return 'task_budget_exceeded'
          await tx.execute(sql`
            select pg_advisory_xact_lock(hashtextextended(
              ${`agent-budget:${input.billingScope}:${input.payerId}:`} ||
              to_char(${input.now} at time zone 'UTC', 'YYYY-MM'),
              0
            ))
          `)
          const chargedMicros = sql<number>`case
            when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
            when ${agentRunCosts.accuracy} = 'billing_indeterminate'
              then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
            else ${agentRunCosts.settledMicros}
          end`
          const [usage] = await tx
            .select({
              taskMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.actorId} = ${actorId}
                  and ${agentRunCosts.projectId} = ${input.projectId}
                  and ${agentRunCosts.taskId} = ${input.taskId}
                  then ${chargedMicros}
                else 0
              end), 0)`,
              projectMonthMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.billingScope} = ${input.billingScope}
                  and ${agentRunCosts.payerId} = ${input.payerId}
                  and (${input.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                  and ${agentRunCosts.createdAt} >= date_trunc('month', ${input.now} at time zone 'UTC') at time zone 'UTC'
                  then ${chargedMicros}
                else 0
              end), 0)`,
            })
            .from(agentRunCosts)
            .where(ne(agentRunCosts.state, 'released'))
          if (Number(usage?.taskMicros ?? 0) + input.reservedMicros > input.taskLimitMicros) {
            return 'task_budget_exceeded'
          }
          if (Number(usage?.projectMonthMicros ?? 0) + input.reservedMicros > input.projectMonthLimitMicros) {
            return 'project_budget_exceeded'
          }
          const [createdCost] = await tx
            .insert(agentRunCosts)
            .values({
              actorId,
              projectId: input.projectId,
              taskId: input.taskId,
              turnId: input.turnId,
              inputDigest: input.inputDigest,
              operationId: existingDispatch?.operationId ?? input.operationId,
              provider: input.provider,
              model: input.model,
              profile: input.profileId,
              state: 'reserved',
              accuracy: null,
              reservedMicros: input.reservedMicros,
              billingScope: input.billingScope,
              payerId: input.payerId,
              reservationExpiresAt: input.reservationExpiresAt,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning()
          if (!createdCost) throw new Error('Agent turn cost insert returned no row')
          cost = createdCost
        }

        const inputSnapshot = {
          prompt: input.prompt,
          attachmentIds: [...input.attachmentIds],
          projectContext: structuredClone(input.projectContext),
          endpoint: input.endpoint,
          projectDraftVersion: input.projectDraftVersion,
          reservedMicros: input.reservedMicros,
          maximumRateMicrosPerToken: input.maximumRateMicrosPerToken,
          providerInputSnapshot: structuredClone(input.providerInputSnapshot),
          providerRequestKey: input.providerRequestKey,
        }
        const frozenConfigDigest = canonicalJsonSha256({
          provider: input.provider,
          model: input.model,
          profileId: input.profileId,
          endpoint: input.endpoint,
          billingScope: input.billingScope,
          payerId: input.payerId,
          taskLimitMicros: input.taskLimitMicros,
          projectMonthLimitMicros: input.projectMonthLimitMicros,
          idempotencyMode: input.idempotencyMode,
        })
        const dispatchValues = {
          turnId: input.turnId,
          inputDigest: input.inputDigest,
          inputSnapshot,
          phase: 'planning' as const,
          frozenProvider: input.provider,
          frozenModel: input.model,
          frozenProfile: input.profileId,
          frozenConfigDigest,
          billingScope: input.billingScope,
          payerId: input.payerId,
          taskLimitMicros: input.taskLimitMicros,
          projectLimitMicros: input.projectMonthLimitMicros,
          warningRatio: 0.8,
          providerIdempotency: input.idempotencyMode,
          updatedAt: input.now,
        }
        const dispatch = existingDispatch
          ? ((
              await tx
                .update(agentRunDispatches)
                .set(dispatchValues)
                .where(
                  and(
                    eq(agentRunDispatches.id, existingDispatch.id),
                    isNull(agentRunDispatches.turnId),
                    isNull(agentRunDispatches.inputDigest),
                  ),
                )
                .returning()
            )[0] ?? existingDispatch)
          : (
              await tx
                .insert(agentRunDispatches)
                .values({
                  actorId,
                  projectId: input.projectId,
                  conversationId: input.conversationId,
                  taskId: input.taskId,
                  operationId: input.operationId,
                  kind: 'run',
                  ...dispatchValues,
                  createdAt: input.now,
                })
                .returning()
            )[0]
        if (!dispatch) throw new Error('Agent turn dispatch persistence returned no row')
        const turn = durableTurnFromDispatch(dispatch)
        if (!turn) throw new Error('Agent turn dispatch did not contain a complete frozen turn')
        return {
          turn,
          dispatch: dispatch as AgentRunDispatchRecord,
          cost: cost as AgentRunCostRecord,
        }
      })
    },
    getAgentTurnByDispatch(actorId, dispatchId) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(and(eq(agentRunDispatches.id, dispatchId), eq(agentRunDispatches.actorId, actorId)))
          .limit(1)
        return dispatch ? durableTurnFromDispatch(dispatch) : null
      })
    },
    prepareAgentProviderAttempt(actorId, dispatchAttempt, input) {
      if (isTransitionProviderAttemptFence(dispatchAttempt)) {
        return withActor(actorId, async tx => {
          const [priorUnknownAttempt] = await tx
            .select({ id: agentProviderAttempts.id })
            .from(agentProviderAttempts)
            .where(
              and(
                eq(agentProviderAttempts.actorId, actorId),
                eq(agentProviderAttempts.taskTransitionId, dispatchAttempt.transitionId),
                eq(agentProviderAttempts.state, 'outcome_unknown'),
              ),
            )
            .for('update')
            .limit(1)
          if (priorUnknownAttempt) return 'outcome_unknown'
          const [transition] = await tx
            .select()
            .from(agentTaskTransitions)
            .where(
              and(
                eq(agentTaskTransitions.id, dispatchAttempt.transitionId),
                eq(agentTaskTransitions.actorId, actorId),
                eq(agentTaskTransitions.projectId, input.projectId),
                eq(agentTaskTransitions.status, 'leased'),
                eq(agentTaskTransitions.leaseGeneration, dispatchAttempt.leaseGeneration),
                eq(agentTaskTransitions.leaseToken, dispatchAttempt.leaseToken),
                eq(agentTaskTransitions.leaseOwner, dispatchAttempt.workerId),
                gt(agentTaskTransitions.leaseUntil, input.now),
              ),
            )
            .for('update')
            .limit(1)
          if (!transition) return 'stale'
          if (agentTaskTransitionRequiresProjectLease(transition.kind)) {
            const [projectLease] = await tx
              .select({ projectId: agentProjectTaskLeases.projectId })
              .from(agentProjectTaskLeases)
              .where(
                and(
                  eq(agentProjectTaskLeases.projectId, transition.projectId),
                  eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                  eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                  eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                  eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
                  gt(agentProjectTaskLeases.leaseUntil, input.now),
                ),
              )
              .for('update')
              .limit(1)
            if (!projectLease) return 'stale'
          }
          let [latest] = await tx
            .select()
            .from(agentProviderAttempts)
            .where(
              and(
                eq(agentProviderAttempts.actorId, actorId),
                eq(agentProviderAttempts.taskTransitionId, transition.id),
              ),
            )
            .orderBy(desc(agentProviderAttempts.attemptNo))
            .for('update')
            .limit(1)
          if (
            latest &&
            latest.transitionLeaseGeneration === dispatchAttempt.leaseGeneration &&
            latest.transitionLeaseToken === dispatchAttempt.leaseToken &&
            latest.transitionWorkerId === dispatchAttempt.workerId
          ) {
            if (
              (latest.state === 'prepared' || latest.state === 'started') &&
              latest.requestBodyDigest === input.requestBodyDigest &&
              latest.providerRequestKey === input.providerRequestKey
            )
              return durableProviderAttempt(latest, input.idempotencyMode)
            return 'stale'
          }
          if (latest?.state === 'started') {
            await tx
              .update(agentProviderAttempts)
              .set({
                state: 'outcome_unknown',
                costAccuracy: 'billing_indeterminate',
                amountMicros: latest.reservationDeltaMicros,
                minimumMicros: 0,
                maximumMicros: latest.reservationDeltaMicros,
                errorCode: 'transition_generation_reclaimed',
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(agentProviderAttempts.id, latest.id))
            return 'outcome_unknown'
          }
          if (latest?.state === 'prepared') {
            ;[latest] = await tx
              .update(agentProviderAttempts)
              .set({
                state: 'failed_definite',
                costAccuracy: 'estimated',
                amountMicros: 0,
                minimumMicros: 0,
                maximumMicros: 0,
                errorCode: 'transition_generation_reclaimed_before_start',
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(agentProviderAttempts.id, latest.id))
              .returning()
          }
          const [run] = await tx
            .select()
            .from(agentTaskRuns)
            .where(eq(agentTaskRuns.id, transition.taskRunId))
            .for('update')
            .limit(1)
          if (!run) return 'stale'
          const taskBounds = run.bounds as unknown as AgentTaskRunBounds
          const hardBoundExceeded = run.costMicros + input.reservedMicros > taskBounds.costLimitMicros
          if (hardBoundExceeded) {
            const eventKey = `task-budget-exceeded:${transition.id}`
            const [existingEvent] = await tx
              .select({ seq: agentTaskEvents.seq })
              .from(agentTaskEvents)
              .where(and(eq(agentTaskEvents.taskRunId, run.id), eq(agentTaskEvents.eventKey, eventKey)))
              .limit(1)
            let nextEventSequence = run.nextEventSequence
            if (!existingEvent) {
              await tx.insert(agentTaskEvents).values({
                taskRunId: run.id,
                seq: nextEventSequence++,
                eventKey,
                stepId: transition.stepId,
                type: 'waiting_user',
                summary: '任务费用预算已达到上限，已安全暂停。',
                publicPayload: { code: 'task_budget_exceeded', action: 'review_budget_before_resume' },
                technicalPayload: {},
                redactionVersion: 1,
                createdAt: input.now,
              })
            }
            await tx
              .update(agentTaskTransitions)
              .set({
                status: 'failed',
                completionDigest: canonicalJsonSha256({ code: 'task_budget_exceeded', transitionId: transition.id }),
                error: { code: 'task_budget_exceeded' },
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(
                and(
                  eq(agentTaskTransitions.id, transition.id),
                  eq(agentTaskTransitions.status, 'leased'),
                  eq(agentTaskTransitions.leaseGeneration, dispatchAttempt.leaseGeneration),
                  eq(agentTaskTransitions.leaseToken, dispatchAttempt.leaseToken),
                  eq(agentTaskTransitions.leaseOwner, dispatchAttempt.workerId),
                ),
              )
            await tx
              .update(agentTaskRuns)
              .set({ status: 'paused', currentTransitionKey: null, nextEventSequence, updatedAt: input.now })
              .where(eq(agentTaskRuns.id, run.id))
            await tx
              .insert(agentTaskOperationalEvents)
              .values({
                dedupeKey: eventKey,
                actorId,
                projectId: run.projectId,
                taskRunId: run.id,
                transitionId: transition.id,
                code: 'task_budget_exceeded',
                severity: 'warning',
                details: {
                  providerTurns: run.providerTurns,
                  promptTokens: run.promptTokens,
                  completionTokens: run.completionTokens,
                  costMicros: run.costMicros,
                  reservedMicros: input.reservedMicros,
                },
                createdAt: input.now,
              })
              .onConflictDoNothing()
            if (agentTaskTransitionRequiresProjectLease(transition.kind))
              await tx
                .update(agentProjectTaskLeases)
                .set({ leaseUntil: input.now, heartbeatAt: input.now, updatedAt: input.now })
                .where(
                  and(
                    eq(agentProjectTaskLeases.projectId, transition.projectId),
                    eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                    eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                    eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                    eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
                  ),
                )
            return 'task_budget_exceeded'
          }
          const [created] = await tx
            .insert(agentProviderAttempts)
            .values({
              actorId,
              projectId: input.projectId,
              taskTransitionId: transition.id,
              transitionLeaseGeneration: dispatchAttempt.leaseGeneration,
              transitionLeaseToken: dispatchAttempt.leaseToken,
              transitionWorkerId: dispatchAttempt.workerId,
              attemptNo: (latest?.attemptNo ?? 0) + 1,
              providerRequestKey: input.providerRequestKey,
              requestBodyDigest: input.requestBodyDigest,
              state: 'prepared',
              reservationDeltaMicros: input.reservedMicros,
              preparedAt: input.now,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning()
          if (!created) throw new Error('Transition provider attempt insert returned no row')
          return durableProviderAttempt(created, input.idempotencyMode)
        })
      }
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, dispatchAttempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              eq(agentRunDispatches.taskId, input.taskId),
              eq(agentRunDispatches.turnId, input.turnId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.desiredState, 'running'),
              eq(agentRunDispatches.leaseOwner, dispatchAttempt.workerId),
              eq(agentRunDispatches.generation, dispatchAttempt.leaseGeneration),
              gt(agentRunDispatches.leaseUntil, input.now),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch || dispatch.providerIdempotency !== input.idempotencyMode) return 'stale'

        let [latest] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(and(eq(agentProviderAttempts.actorId, actorId), eq(agentProviderAttempts.dispatchId, dispatch.id)))
          .orderBy(desc(agentProviderAttempts.attemptNo))
          .for('update')
          .limit(1)
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.taskId, input.taskId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (!cost || dispatch.taskLimitMicros === null || dispatch.projectLimitMicros === null) return 'stale'

        if (
          latest &&
          (latest.dispatchGeneration !== dispatchAttempt.leaseGeneration ||
            latest.dispatchWorkerId !== dispatchAttempt.workerId)
        ) {
          if ((latest.dispatchGeneration ?? -1) >= dispatchAttempt.leaseGeneration) return 'stale'
          if (latest.state === 'started') {
            const [unknown] = await tx
              .update(agentProviderAttempts)
              .set({
                state: 'outcome_unknown',
                costAccuracy: 'billing_indeterminate',
                amountMicros: cost.reservedMicros,
                minimumMicros: 0,
                maximumMicros: cost.reservedMicros,
                errorCode: 'dispatch_generation_reclaimed',
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(agentProviderAttempts.id, latest.id))
              .returning()
            if (!unknown) return 'stale'
            await tx
              .update(agentRunCosts)
              .set({
                state: 'settled',
                accuracy: 'billing_indeterminate',
                settledMicros: cost.reservedMicros,
                minimumMicros: 0,
                maximumMicros: cost.reservedMicros,
                updatedAt: input.now,
              })
              .where(eq(agentRunCosts.id, cost.id))
            return 'outcome_unknown'
          }
          if (latest.state === 'prepared') {
            const [failed] = await tx
              .update(agentProviderAttempts)
              .set({
                state: 'failed_definite',
                costAccuracy: 'estimated',
                amountMicros: 0,
                minimumMicros: 0,
                maximumMicros: 0,
                errorCode: 'dispatch_generation_reclaimed_before_start',
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(agentProviderAttempts.id, latest.id))
              .returning()
            if (!failed) return 'stale'
            latest = failed
            await tx
              .update(agentRunCosts)
              .set({
                state: 'released',
                accuracy: null,
                settledMicros: 0,
                minimumMicros: null,
                maximumMicros: null,
                updatedAt: input.now,
              })
              .where(eq(agentRunCosts.id, cost.id))
          }
        }
        if (
          latest &&
          latest.dispatchGeneration === dispatchAttempt.leaseGeneration &&
          latest.dispatchWorkerId === dispatchAttempt.workerId &&
          (latest.state === 'prepared' || latest.state === 'started')
        ) {
          if (
            latest.requestBodyDigest !== input.requestBodyDigest ||
            latest.providerRequestKey !== input.providerRequestKey
          ) {
            return 'stale'
          }
          return durableProviderAttempt(latest, input.idempotencyMode)
        }
        if (
          latest &&
          latest.dispatchGeneration === dispatchAttempt.leaseGeneration &&
          latest.dispatchWorkerId === dispatchAttempt.workerId
        ) {
          return 'stale'
        }
        if (latest && latest.state !== 'failed_definite') return 'stale'

        const reservationDeltaMicros = latest ? input.reservedMicros : 0
        if (reservationDeltaMicros > 0) {
          const [usage] = await tx
            .select({
              taskMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.actorId} = ${actorId}
                  and ${agentRunCosts.projectId} = ${input.projectId}
                  and ${agentRunCosts.taskId} = ${input.taskId}
                  then case
                    when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
                    when ${agentRunCosts.accuracy} = 'billing_indeterminate'
                      then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
                    else ${agentRunCosts.settledMicros}
                  end
                else 0
              end), 0)`,
              projectMonthMicros: sql<number>`coalesce(sum(case
                when ${agentRunCosts.billingScope} = ${dispatch.billingScope}
                  and ${agentRunCosts.payerId} = ${dispatch.payerId}
                  and (${dispatch.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                  and ${agentRunCosts.createdAt} >= date_trunc('month', ${input.now} at time zone 'UTC') at time zone 'UTC'
                  then case
                    when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
                    when ${agentRunCosts.accuracy} = 'billing_indeterminate'
                      then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
                    else ${agentRunCosts.settledMicros}
                  end
                else 0
              end), 0)`,
            })
            .from(agentRunCosts)
            .where(ne(agentRunCosts.state, 'released'))
          if (Number(usage?.taskMicros ?? 0) + reservationDeltaMicros > dispatch.taskLimitMicros) {
            return 'task_budget_exceeded'
          }
          if (Number(usage?.projectMonthMicros ?? 0) + reservationDeltaMicros > dispatch.projectLimitMicros) {
            return 'project_budget_exceeded'
          }
          await tx
            .update(agentRunCosts)
            .set({
              state: 'reserved',
              accuracy: null,
              reservedMicros: reservationDeltaMicros,
              settledMicros: 0,
              minimumMicros: null,
              maximumMicros: null,
              updatedAt: input.now,
            })
            .where(eq(agentRunCosts.id, cost.id))
        }
        const [created] = await tx
          .insert(agentProviderAttempts)
          .values({
            actorId,
            projectId: input.projectId,
            dispatchId: dispatch.id,
            dispatchGeneration: dispatchAttempt.leaseGeneration,
            dispatchWorkerId: dispatchAttempt.workerId,
            attemptNo: (latest?.attemptNo ?? 0) + 1,
            providerRequestKey: input.providerRequestKey,
            requestBodyDigest: input.requestBodyDigest,
            state: 'prepared',
            reservationDeltaMicros,
            preparedAt: input.now,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
        if (!created) throw new Error('Agent provider attempt insert returned no row')
        return durableProviderAttempt(created, input.idempotencyMode)
      })
    },
    markAgentProviderAttemptStarted(actorId, attemptId, dispatchAttempt, now) {
      if (isTransitionProviderAttemptFence(dispatchAttempt)) {
        return withActor(actorId, async tx => {
          const [attempt] = await tx
            .update(agentProviderAttempts)
            .set({ state: 'started', startedAt: now, updatedAt: now })
            .where(
              and(
                eq(agentProviderAttempts.id, attemptId),
                eq(agentProviderAttempts.actorId, actorId),
                eq(agentProviderAttempts.taskTransitionId, dispatchAttempt.transitionId),
                eq(agentProviderAttempts.transitionLeaseGeneration, dispatchAttempt.leaseGeneration),
                eq(agentProviderAttempts.transitionLeaseToken, dispatchAttempt.leaseToken),
                eq(agentProviderAttempts.transitionWorkerId, dispatchAttempt.workerId),
                eq(agentProviderAttempts.state, 'prepared'),
                sql`exists (select 1 from ${agentTaskTransitions} transition where transition.id=${dispatchAttempt.transitionId}
                and transition.status='leased' and transition.lease_generation=${dispatchAttempt.leaseGeneration}
                and transition.lease_token=${dispatchAttempt.leaseToken} and transition.lease_owner=${dispatchAttempt.workerId}
                and transition.lease_until>${now})`,
              ),
            )
            .returning()
          return attempt ? durableProviderAttempt(attempt, 'unsupported') : null
        })
      }
      return withActor(actorId, async tx => {
        const [attempt] = await tx
          .update(agentProviderAttempts)
          .set({ state: 'started', startedAt: now, updatedAt: now })
          .where(
            and(
              eq(agentProviderAttempts.id, attemptId),
              eq(agentProviderAttempts.actorId, actorId),
              eq(agentProviderAttempts.dispatchId, dispatchAttempt.dispatchId),
              eq(agentProviderAttempts.dispatchGeneration, dispatchAttempt.leaseGeneration),
              eq(agentProviderAttempts.dispatchWorkerId, dispatchAttempt.workerId),
              eq(agentProviderAttempts.state, 'prepared'),
              sql`exists (
                select 1 from ${agentRunDispatches} dispatch
                where dispatch.id = ${dispatchAttempt.dispatchId}
                  and dispatch.actor_id = ${actorId}
                  and dispatch.state = 'running'
                  and dispatch.desired_state = 'running'
                  and dispatch.lease_owner = ${dispatchAttempt.workerId}
                  and dispatch.generation = ${dispatchAttempt.leaseGeneration}
                  and dispatch.lease_until > ${now}
              )`,
            ),
          )
          .returning()
        if (!attempt) return null
        const [dispatch] = await tx
          .select({ providerIdempotency: agentRunDispatches.providerIdempotency })
          .from(agentRunDispatches)
          .where(eq(agentRunDispatches.id, dispatchAttempt.dispatchId))
          .limit(1)
        return durableProviderAttempt(attempt, dispatch?.providerIdempotency ?? 'unsupported')
      })
    },
    completeAgentProviderAttempt(actorId, attemptId, dispatchAttempt, input) {
      if (isTransitionProviderAttemptFence(dispatchAttempt)) {
        return withActor(actorId, async tx => {
          const [transition] = await tx
            .select()
            .from(agentTaskTransitions)
            .where(
              and(
                eq(agentTaskTransitions.id, dispatchAttempt.transitionId),
                eq(agentTaskTransitions.actorId, actorId),
                eq(agentTaskTransitions.leaseGeneration, dispatchAttempt.leaseGeneration),
                eq(agentTaskTransitions.leaseToken, dispatchAttempt.leaseToken),
                eq(agentTaskTransitions.leaseOwner, dispatchAttempt.workerId),
              ),
            )
            .for('update')
            .limit(1)
          if (!transition) return 'stale'
          const [attempt] = await tx
            .select()
            .from(agentProviderAttempts)
            .where(
              and(
                eq(agentProviderAttempts.id, attemptId),
                eq(agentProviderAttempts.taskTransitionId, dispatchAttempt.transitionId),
                eq(agentProviderAttempts.transitionLeaseGeneration, dispatchAttempt.leaseGeneration),
                eq(agentProviderAttempts.transitionLeaseToken, dispatchAttempt.leaseToken),
                eq(agentProviderAttempts.transitionWorkerId, dispatchAttempt.workerId),
              ),
            )
            .for('update')
            .limit(1)
          if (
            !attempt ||
            attempt.requestBodyDigest !== input.providerAttempt.requestBodyDigest ||
            attempt.providerRequestKey !== (input.providerAttempt.providerRequestKey ?? null)
          )
            return 'stale'
          const [run] = await tx
            .select()
            .from(agentTaskRuns)
            .where(eq(agentTaskRuns.id, transition.taskRunId))
            .for('update')
            .limit(1)
          if (!run) return 'stale'
          const budgetEventKey = `task-budget-exceeded:${attempt.id}`
          const terminalFailureEventKey = `provider-terminal-failure:${attempt.id}`
          if (['succeeded', 'failed_definite', 'outcome_unknown'].includes(attempt.state)) {
            if (attempt.state === 'outcome_unknown') {
              const paused = await pauseTransitionForUnknownProviderOutcome(
                tx,
                actorId,
                transition,
                attempt,
                input.now,
                { accountingAlreadyApplied: unknownProviderOutcomeAccountingAlreadyApplied(attempt) },
              )
              if (typeof paused === 'string') return 'stale'
              return {
                attempt: durableProviderAttempt(paused.attempt, input.providerAttempt.idempotencyMode),
                cost: null,
                taskOutcomeClassification: 'provider_outcome_unknown_paused',
              }
            }
            const [budgetEvent] = await tx
              .select({ id: agentTaskOperationalEvents.id })
              .from(agentTaskOperationalEvents)
              .where(eq(agentTaskOperationalEvents.dedupeKey, budgetEventKey))
              .limit(1)
            const [terminalFailureEvent] = await tx
              .select({ seq: agentTaskEvents.seq })
              .from(agentTaskEvents)
              .where(
                and(
                  eq(agentTaskEvents.taskRunId, transition.taskRunId),
                  eq(agentTaskEvents.eventKey, terminalFailureEventKey),
                ),
              )
              .limit(1)
            return {
              attempt: durableProviderAttempt(attempt, input.providerAttempt.idempotencyMode),
              cost: null,
              taskOutcomeClassification: budgetEvent
                ? 'task_budget_exceeded_paused'
                : terminalFailureEvent
                  ? 'transition_failed_terminal'
                  : 'within_budget',
            }
          }
          if (transition.status !== 'leased' || !transition.leaseUntil || transition.leaseUntil <= input.now)
            return 'stale'
          if (agentTaskTransitionRequiresProjectLease(transition.kind)) {
            const [projectLease] = await tx
              .select({ projectId: agentProjectTaskLeases.projectId })
              .from(agentProjectTaskLeases)
              .where(
                and(
                  eq(agentProjectTaskLeases.projectId, transition.projectId),
                  eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                  eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                  eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                  eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
                  gt(agentProjectTaskLeases.leaseUntil, input.now),
                ),
              )
              .for('update')
              .limit(1)
            if (!projectLease) return 'stale'
          }
          if (attempt.state !== 'started' && input.state !== 'failed_definite') return 'stale'
          if (input.terminalTransitionFailure && (input.state !== 'succeeded' || transition.kind !== 'planning')) {
            return 'stale'
          }
          const attemptWasStarted = attempt.state === 'started'
          if (input.state === 'outcome_unknown') {
            const paused = await pauseTransitionForUnknownProviderOutcome(tx, actorId, transition, attempt, input.now, {
              providerObservation: {
                promptTokens: input.promptTokens,
                completionTokens: input.completionTokens,
                cachedTokens: input.cachedTokens,
                durationMs: input.providerAttempt.durationMs,
                upstreamRequestId: input.providerAttempt.upstreamRequestId,
              },
            })
            if (typeof paused === 'string') return 'stale'
            return {
              attempt: durableProviderAttempt(paused.attempt, input.providerAttempt.idempotencyMode),
              cost: null,
              taskOutcomeClassification: 'provider_outcome_unknown_paused',
            }
          }
          let amountMicros = 0
          let accuracy: 'actual' | 'billing_indeterminate' | 'estimated' = 'estimated'
          if (input.state === 'succeeded' || (input.state === 'failed_definite' && attemptWasStarted)) {
            amountMicros = input.providerAmountMicros ?? input.estimatedMicros ?? 0
            if (input.providerAmountMicros !== undefined) accuracy = 'actual'
          }
          const [completed] = await tx
            .update(agentProviderAttempts)
            .set({
              state: input.state,
              costAccuracy: accuracy,
              amountMicros,
              minimumMicros: amountMicros,
              maximumMicros: amountMicros,
              promptTokens: attemptWasStarted ? (input.promptTokens ?? null) : null,
              completionTokens: attemptWasStarted ? (input.completionTokens ?? null) : null,
              cachedTokens: attemptWasStarted ? (input.cachedTokens ?? null) : null,
              durationMs: input.providerAttempt.durationMs ?? null,
              upstreamRequestId: input.providerAttempt.upstreamRequestId ?? null,
              errorCode: input.state === 'succeeded' ? null : (input.providerAttempt.reason ?? input.state),
              errorMessage: null,
              completedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(agentProviderAttempts.id, attempt.id),
                inArray(agentProviderAttempts.state, ['prepared', 'started']),
              ),
            )
            .returning()
          if (!completed) return 'stale'
          if (input.state === 'succeeded') {
            const [checkpointed] = await tx
              .update(agentTaskTransitions)
              .set({
                output: {
                  ...(transition.output ?? {}),
                  providerResult: {
                    attemptId: completed.id,
                    decisionOutput: input.decisionOutput ?? null,
                    decisionUsage: input.decisionUsage ?? null,
                    decisionTrace: input.decisionTrace ?? null,
                  },
                },
                updatedAt: input.now,
              })
              .where(
                and(
                  eq(agentTaskTransitions.id, transition.id),
                  eq(agentTaskTransitions.status, 'leased'),
                  eq(agentTaskTransitions.leaseGeneration, dispatchAttempt.leaseGeneration),
                  eq(agentTaskTransitions.leaseToken, dispatchAttempt.leaseToken),
                  eq(agentTaskTransitions.leaseOwner, dispatchAttempt.workerId),
                ),
              )
              .returning({ id: agentTaskTransitions.id })
            if (!checkpointed) return 'stale'
          }
          let taskOutcomeClassification:
            | 'within_budget'
            | 'task_budget_exceeded_paused'
            | 'transition_failed_terminal' = 'within_budget'
          let taskBudgetExceeded = false
          if (attemptWasStarted) {
            const nextProviderTurns = run.providerTurns + 1
            const nextPromptTokens = run.promptTokens + (input.promptTokens ?? 0)
            const nextCompletionTokens = run.completionTokens + (input.completionTokens ?? 0)
            const nextCostMicros = run.costMicros + amountMicros
            const taskBounds = run.bounds as unknown as AgentTaskRunBounds
            const actualOverage = nextCostMicros > taskBounds.costLimitMicros
            taskBudgetExceeded = actualOverage
            taskOutcomeClassification = actualOverage ? 'task_budget_exceeded_paused' : 'within_budget'
            await tx
              .update(agentTaskRuns)
              .set({
                providerTurns: nextProviderTurns,
                promptTokens: nextPromptTokens,
                completionTokens: nextCompletionTokens,
                costMicros: nextCostMicros,
                status: actualOverage ? 'paused' : run.status,
                currentTransitionKey: actualOverage ? null : run.currentTransitionKey,
                nextEventSequence: actualOverage ? run.nextEventSequence + 1 : run.nextEventSequence,
                updatedAt: input.now,
              })
              .where(eq(agentTaskRuns.id, transition.taskRunId))
            if (actualOverage) {
              await tx
                .update(agentTaskTransitions)
                .set({
                  status: 'failed',
                  completionDigest: canonicalJsonSha256({ code: 'task_budget_exceeded', attemptId: completed.id }),
                  error: { code: 'task_budget_exceeded' },
                  completedAt: input.now,
                  updatedAt: input.now,
                })
                .where(
                  and(
                    eq(agentTaskTransitions.id, transition.id),
                    eq(agentTaskTransitions.status, 'leased'),
                    eq(agentTaskTransitions.leaseGeneration, dispatchAttempt.leaseGeneration),
                    eq(agentTaskTransitions.leaseToken, dispatchAttempt.leaseToken),
                    eq(agentTaskTransitions.leaseOwner, dispatchAttempt.workerId),
                  ),
                )
              await tx
                .insert(agentTaskEvents)
                .values({
                  taskRunId: run.id,
                  seq: run.nextEventSequence,
                  eventKey: budgetEventKey,
                  stepId: transition.stepId,
                  type: 'waiting_user',
                  summary: '本次模型调用达到任务费用预算，任务已安全暂停。',
                  publicPayload: { code: 'task_budget_exceeded', action: 'review_budget_before_resume' },
                  technicalPayload: {},
                  redactionVersion: 1,
                  createdAt: input.now,
                })
                .onConflictDoNothing()
              await tx
                .insert(agentTaskOperationalEvents)
                .values({
                  dedupeKey: budgetEventKey,
                  actorId,
                  projectId: run.projectId,
                  taskRunId: run.id,
                  transitionId: transition.id,
                  code: 'task_budget_exceeded_actual',
                  severity: 'warning',
                  details: {
                    providerTurns: nextProviderTurns,
                    promptTokens: nextPromptTokens,
                    completionTokens: nextCompletionTokens,
                    costMicros: nextCostMicros,
                  },
                  createdAt: input.now,
                })
                .onConflictDoNothing()
              if (agentTaskTransitionRequiresProjectLease(transition.kind))
                await tx
                  .update(agentProjectTaskLeases)
                  .set({ leaseUntil: input.now, heartbeatAt: input.now, updatedAt: input.now })
                  .where(
                    and(
                      eq(agentProjectTaskLeases.projectId, transition.projectId),
                      eq(agentProjectTaskLeases.taskRunId, transition.taskRunId),
                      eq(agentProjectTaskLeases.leaseGeneration, transition.projectLeaseGeneration!),
                      eq(agentProjectTaskLeases.leaseToken, transition.projectLeaseToken!),
                      eq(agentProjectTaskLeases.leaseOwner, transition.projectLeaseWorkerId!),
                    ),
                  )
            }
          }
          if (input.terminalTransitionFailure && !taskBudgetExceeded) {
            const publicEvent = sanitizePublicAgentTaskEvent({
              summary: input.terminalTransitionFailure.summary,
              publicPayload: {
                code: input.terminalTransitionFailure.code,
                ...input.terminalTransitionFailure.publicPayload,
              },
            })
            const [failedTransition] = await tx
              .update(agentTaskTransitions)
              .set({
                status: 'failed',
                completionDigest: canonicalJsonSha256({
                  code: input.terminalTransitionFailure.code,
                  attemptId: completed.id,
                }),
                error: { code: input.terminalTransitionFailure.code },
                completedAt: input.now,
                updatedAt: input.now,
              })
              .where(
                and(
                  eq(agentTaskTransitions.id, transition.id),
                  eq(agentTaskTransitions.status, 'leased'),
                  eq(agentTaskTransitions.leaseGeneration, dispatchAttempt.leaseGeneration),
                  eq(agentTaskTransitions.leaseToken, dispatchAttempt.leaseToken),
                  eq(agentTaskTransitions.leaseOwner, dispatchAttempt.workerId),
                ),
              )
              .returning({ id: agentTaskTransitions.id })
            if (!failedTransition) return 'stale'
            await tx
              .update(agentTaskRuns)
              .set({
                status: 'failed',
                currentTransitionKey: null,
                nextEventSequence: run.nextEventSequence + 1,
                updatedAt: input.now,
                completedAt: input.now,
              })
              .where(eq(agentTaskRuns.id, run.id))
            await tx
              .insert(agentTaskEvents)
              .values({
                taskRunId: run.id,
                seq: run.nextEventSequence,
                eventKey: terminalFailureEventKey,
                stepId: transition.stepId,
                type: 'task_failed',
                summary: publicEvent.summary,
                publicPayload: publicEvent.publicPayload,
                technicalPayload: input.terminalTransitionFailure.technicalPayload,
                redactionVersion: 1,
                createdAt: input.now,
              })
              .onConflictDoNothing()
            taskOutcomeClassification = 'transition_failed_terminal'
          }
          return {
            attempt: durableProviderAttempt(completed, input.providerAttempt.idempotencyMode),
            cost: null,
            taskOutcomeClassification,
          }
        })
      }
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, dispatchAttempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.desiredState, 'running'),
              eq(agentRunDispatches.leaseOwner, dispatchAttempt.workerId),
              eq(agentRunDispatches.generation, dispatchAttempt.leaseGeneration),
              gt(agentRunDispatches.leaseUntil, input.now),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch || !dispatch.turnId || !dispatch.providerIdempotency) return 'stale'
        const [attempt] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(
            and(
              eq(agentProviderAttempts.id, attemptId),
              eq(agentProviderAttempts.actorId, actorId),
              eq(agentProviderAttempts.dispatchId, dispatch.id),
              eq(agentProviderAttempts.dispatchGeneration, dispatchAttempt.leaseGeneration),
              eq(agentProviderAttempts.dispatchWorkerId, dispatchAttempt.workerId),
            ),
          )
          .for('update')
          .limit(1)
        if (
          !attempt ||
          attempt.requestBodyDigest !== input.providerAttempt.requestBodyDigest ||
          attempt.providerRequestKey !== (input.providerAttempt.providerRequestKey ?? null) ||
          dispatch.providerIdempotency !== input.providerAttempt.idempotencyMode
        ) {
          return 'stale'
        }
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, dispatch.projectId),
              eq(agentRunCosts.turnId, dispatch.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (!cost) return 'stale'
        if (['succeeded', 'failed_definite', 'outcome_unknown'].includes(attempt.state)) {
          return {
            attempt: durableProviderAttempt(attempt, dispatch.providerIdempotency),
            cost: cost as AgentRunCostRecord,
            taskOutcomeClassification: 'within_budget',
          }
        }
        if (attempt.state !== 'started' && input.state !== 'failed_definite') return 'stale'

        const publicCost =
          input.state === 'outcome_unknown'
            ? derivePublicCost({
                lifecycle: 'settled',
                outcome: 'unknown',
                reservedMicros: input.estimatedMicros ?? cost.reservedMicros,
                ...(input.observedTokens !== undefined
                  ? { observedTokens: input.observedTokens, microsPerToken: 1 }
                  : {}),
              })
            : input.state === 'succeeded'
              ? input.providerAmountMicros !== undefined
                ? derivePublicCost({
                    lifecycle: 'settled',
                    outcome: 'success',
                    providerAmountMicros: input.providerAmountMicros,
                  })
                : {
                    lifecycle: 'settled' as const,
                    accuracy: 'estimated' as const,
                    amountMicros: input.estimatedMicros ?? 0,
                    minimumMicros: input.estimatedMicros ?? 0,
                    maximumMicros: input.estimatedMicros ?? 0,
                    estimateInProgress: false,
                  }
              : {
                  lifecycle: 'settled' as const,
                  accuracy: 'estimated' as const,
                  amountMicros: 0,
                  minimumMicros: 0,
                  maximumMicros: 0,
                  estimateInProgress: false,
                }
        const [completed] = await tx
          .update(agentProviderAttempts)
          .set({
            state: input.state,
            costAccuracy: publicCost.accuracy,
            amountMicros: publicCost.amountMicros ?? 0,
            minimumMicros: publicCost.minimumMicros,
            maximumMicros: publicCost.maximumMicros,
            promptTokens: input.promptTokens ?? null,
            completionTokens: input.completionTokens ?? null,
            cachedTokens: input.cachedTokens ?? null,
            durationMs: input.providerAttempt.durationMs ?? null,
            upstreamRequestId: input.providerAttempt.upstreamRequestId ?? null,
            errorCode: input.state === 'succeeded' ? null : (input.providerAttempt.reason ?? input.state),
            errorMessage: null,
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(agentProviderAttempts.id, attempt.id))
          .returning()
        if (!completed) return 'stale'
        const [settledCost] = await tx
          .update(agentRunCosts)
          .set({
            state: input.state === 'failed_definite' ? 'released' : 'settled',
            accuracy: input.state === 'failed_definite' ? null : publicCost.accuracy,
            settledMicros: publicCost.amountMicros ?? 0,
            minimumMicros: input.state === 'failed_definite' ? null : publicCost.minimumMicros,
            maximumMicros: input.state === 'failed_definite' ? null : publicCost.maximumMicros,
            promptTokens: input.promptTokens ?? null,
            completionTokens: input.completionTokens ?? null,
            decisionOutput: input.decisionOutput ?? null,
            decisionUsage: input.decisionUsage ?? null,
            decisionTrace: input.decisionTrace ?? null,
            updatedAt: input.now,
          })
          .where(eq(agentRunCosts.id, cost.id))
          .returning()
        if (!settledCost) return 'stale'
        const asksUser =
          input.decisionOutput?.output &&
          typeof input.decisionOutput.output === 'object' &&
          !Array.isArray(input.decisionOutput.output) &&
          (input.decisionOutput.output as Record<string, unknown>).action === 'ask_user'
        await tx
          .update(agentRunDispatches)
          .set({ phase: asksUser ? 'waiting_input' : 'executing', updatedAt: input.now })
          .where(eq(agentRunDispatches.id, dispatch.id))
        return {
          attempt: durableProviderAttempt(completed, dispatch.providerIdempotency),
          cost: settledCost as AgentRunCostRecord,
          taskOutcomeClassification: 'within_budget',
        }
      })
    },
    reconcileAgentProviderAttempt: ((actorId: string, dispatchAttempt: AgentProviderAttemptFence, now: Date) => {
      if (isTransitionProviderAttemptFence(dispatchAttempt)) {
        return withActor(actorId, async tx => {
          const [transition] = await tx
            .select()
            .from(agentTaskTransitions)
            .where(
              and(eq(agentTaskTransitions.id, dispatchAttempt.transitionId), eq(agentTaskTransitions.actorId, actorId)),
            )
            .for('update')
            .limit(1)
          if (!transition || !matchesAgentTaskLease(transition, dispatchAttempt)) return 'stale'
          const [attempt] = await tx
            .select()
            .from(agentProviderAttempts)
            .where(
              and(
                eq(agentProviderAttempts.taskTransitionId, transition.id),
                inArray(agentProviderAttempts.state, ['prepared', 'started', 'failed_definite', 'outcome_unknown']),
              ),
            )
            .orderBy(desc(agentProviderAttempts.attemptNo))
            .for('update')
            .limit(1)
          if (!attempt) return null
          if (attempt.state === 'outcome_unknown') {
            const paused = await pauseTransitionForUnknownProviderOutcome(tx, actorId, transition, attempt, now, {
              accountingAlreadyApplied: unknownProviderOutcomeAccountingAlreadyApplied(attempt),
            })
            if (paused === 'invalid_state') return 'stale'
            if (paused === 'stale') return paused
            return {
              attempt: durableProviderAttempt(paused.attempt, 'unsupported'),
              classification: 'started_outcome_unknown' as const,
            }
          }
          if (attempt.state === 'failed_definite')
            return {
              attempt: durableProviderAttempt(attempt, 'unsupported'),
              classification: 'prepared_failed_definite' as const,
            }
          if (transition.status === 'leased' && transition.leaseUntil && transition.leaseUntil > now)
            return {
              attempt: durableProviderAttempt(attempt, 'unsupported'),
              classification: 'lease_live' as const,
            }
          if (attempt.state === 'started') {
            const paused = await pauseTransitionForUnknownProviderOutcome(tx, actorId, transition, attempt, now)
            if (paused === 'invalid_state') return 'stale'
            if (paused === 'stale') return paused
            return {
              attempt: durableProviderAttempt(paused.attempt, 'unsupported'),
              classification: 'started_outcome_unknown' as const,
            }
          }
          const [reconciled] = await tx
            .update(agentProviderAttempts)
            .set({
              state: 'failed_definite',
              costAccuracy: 'estimated',
              amountMicros: 0,
              minimumMicros: 0,
              maximumMicros: 0,
              errorCode: 'transition_attempt_stale',
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(agentProviderAttempts.id, attempt.id))
            .returning()
          if (!reconciled) return 'stale'
          return {
            attempt: durableProviderAttempt(reconciled, 'unsupported'),
            classification: 'prepared_failed_definite' as const,
          }
        })
      }
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, dispatchAttempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.generation, dispatchAttempt.leaseGeneration),
              eq(agentRunDispatches.leaseOwner, dispatchAttempt.workerId),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch || !dispatch.turnId || !dispatch.providerIdempotency) return 'stale'
        const [attempt] = await tx
          .select()
          .from(agentProviderAttempts)
          .where(
            and(
              eq(agentProviderAttempts.actorId, actorId),
              eq(agentProviderAttempts.dispatchId, dispatch.id),
              inArray(agentProviderAttempts.state, ['prepared', 'started']),
            ),
          )
          .orderBy(desc(agentProviderAttempts.attemptNo))
          .for('update')
          .limit(1)
        if (!attempt) return null
        const sameDispatchAttempt =
          attempt.dispatchGeneration === dispatchAttempt.leaseGeneration &&
          attempt.dispatchWorkerId === dispatchAttempt.workerId
        if (sameDispatchAttempt && dispatch.leaseUntil && dispatch.leaseUntil > now && dispatch.state === 'running') {
          return durableProviderAttempt(attempt, dispatch.providerIdempotency)
        }
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, dispatch.projectId),
              eq(agentRunCosts.turnId, dispatch.turnId),
            ),
          )
          .for('update')
          .limit(1)
        if (!cost) return 'stale'
        const nextState = attempt.state === 'started' ? 'outcome_unknown' : 'failed_definite'
        const [reconciled] = await tx
          .update(agentProviderAttempts)
          .set({
            state: nextState,
            costAccuracy: nextState === 'outcome_unknown' ? 'billing_indeterminate' : 'estimated',
            amountMicros: nextState === 'outcome_unknown' ? cost.reservedMicros : 0,
            minimumMicros: 0,
            maximumMicros: nextState === 'outcome_unknown' ? cost.reservedMicros : 0,
            errorCode: 'dispatch_attempt_stale',
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(agentProviderAttempts.id, attempt.id))
          .returning()
        if (!reconciled) return 'stale'
        if (nextState === 'outcome_unknown') {
          await tx
            .update(agentRunCosts)
            .set({
              state: 'settled',
              accuracy: 'billing_indeterminate',
              settledMicros: sql`${agentRunCosts.reservedMicros}`,
              minimumMicros: 0,
              maximumMicros: sql`${agentRunCosts.reservedMicros}`,
              updatedAt: now,
            })
            .where(
              and(
                eq(agentRunCosts.actorId, actorId),
                eq(agentRunCosts.projectId, dispatch.projectId),
                eq(agentRunCosts.turnId, dispatch.turnId),
                eq(agentRunCosts.state, 'reserved'),
              ),
            )
        } else {
          await tx
            .update(agentRunCosts)
            .set({
              state: 'released',
              accuracy: null,
              settledMicros: 0,
              minimumMicros: null,
              maximumMicros: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(agentRunCosts.actorId, actorId),
                eq(agentRunCosts.projectId, dispatch.projectId),
                eq(agentRunCosts.turnId, dispatch.turnId),
                eq(agentRunCosts.state, 'reserved'),
              ),
            )
        }
        return durableProviderAttempt(reconciled, dispatch.providerIdempotency)
      })
    }) as NonNullable<Repository['reconcileAgentProviderAttempt']>,
    respondToAgentTask(actorId, input) {
      return withActor(actorId, async tx => {
        const [membership] = await tx
          .select({ role: projectMembers.role })
          .from(projectMembers)
          .innerJoin(projects, eq(projects.id, projectMembers.projectId))
          .where(
            and(
              eq(projectMembers.projectId, input.projectId),
              eq(projectMembers.userId, actorId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        if (!membership) return null
        if (membership.role !== 'owner' && membership.role !== 'editor') return 'forbidden'
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-turn:${input.projectId}:${input.turnId}`}, 0))`,
        )
        const [existing] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              eq(agentRunDispatches.turnId, input.turnId),
            ),
          )
          .limit(1)
        if (existing) {
          return existing.taskId === input.taskId &&
            existing.conversationId === input.conversationId &&
            existing.inputSnapshot?.prompt === input.response &&
            existing.inputSnapshot?.responseToQuestionId === input.questionId &&
            Array.isArray(existing.inputSnapshot.responseAttachmentIds) &&
            JSON.stringify(existing.inputSnapshot.responseAttachmentIds) === JSON.stringify(input.attachmentIds)
            ? { dispatch: existing as AgentRunDispatchRecord }
            : 'conflict'
        }

        const [source] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, input.projectId),
              eq(agentRunDispatches.taskId, input.taskId),
              eq(agentRunDispatches.phase, 'waiting_input'),
              eq(agentRunDispatches.state, 'paused'),
              eq(agentRunDispatches.waitingReason, 'user'),
            ),
          )
          .orderBy(desc(agentRunDispatches.createdAt))
          .for('update')
          .limit(1)
        if (
          !source ||
          source.conversationId !== input.conversationId ||
          !source.inputSnapshot ||
          !source.frozenProvider ||
          !source.frozenModel ||
          !source.frozenProfile ||
          !source.frozenConfigDigest ||
          !source.billingScope ||
          !source.payerId ||
          source.taskLimitMicros === null ||
          source.projectLimitMicros === null ||
          source.warningRatio === null ||
          !source.providerIdempotency ||
          typeof source.inputSnapshot.projectDraftVersion !== 'number' ||
          typeof source.inputSnapshot.maximumRateMicrosPerToken !== 'number' ||
          source.inputSnapshot.maximumRateMicrosPerToken <= 0
        ) {
          return 'invalid_question'
        }
        if (!durableProviderInputSnapshot(source.inputSnapshot.providerInputSnapshot)) return 'invalid_question'
        const providerInputSnapshot = durableProviderInputSnapshot(input.providerInputSnapshot)
        if (!providerInputSnapshot) return 'invalid_question'
        const [sourceCost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.turnId, source.turnId ?? ''),
            ),
          )
          .for('update')
          .limit(1)
        const output = sourceCost?.decisionOutput?.output
        const question =
          output && typeof output === 'object' && !Array.isArray(output)
            ? (output as Record<string, unknown>).question
            : null
        if (
          !question ||
          typeof question !== 'object' ||
          Array.isArray(question) ||
          (question as Record<string, unknown>).id !== input.questionId
        ) {
          return 'invalid_question'
        }
        const reservedMicros = Math.ceil(
          estimateAgentProviderInputTokens(providerInputSnapshot) * source.inputSnapshot.maximumRateMicrosPerToken,
        )
        if (reservedMicros !== input.reservedMicros) return 'conflict'
        const chargedMicros = sql<number>`case
          when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
          when ${agentRunCosts.accuracy} = 'billing_indeterminate'
            then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
          else ${agentRunCosts.settledMicros}
        end`
        const [usage] = await tx
          .select({
            taskMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.actorId} = ${actorId}
                and ${agentRunCosts.projectId} = ${input.projectId}
                and ${agentRunCosts.taskId} = ${input.taskId}
                then ${chargedMicros}
              else 0
            end), 0)`,
            projectMonthMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.billingScope} = ${source.billingScope}
                and ${agentRunCosts.payerId} = ${source.payerId}
                and (${source.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                and ${agentRunCosts.createdAt} >= date_trunc('month', ${input.now} at time zone 'UTC') at time zone 'UTC'
                then ${chargedMicros}
              else 0
            end), 0)`,
          })
          .from(agentRunCosts)
          .where(ne(agentRunCosts.state, 'released'))
        if (Number(usage?.taskMicros ?? 0) + reservedMicros > source.taskLimitMicros) {
          return 'task_budget_exceeded'
        }
        if (Number(usage?.projectMonthMicros ?? 0) + reservedMicros > source.projectLimitMicros) {
          return 'project_budget_exceeded'
        }
        const operationId = `operation-${randomUUID()}`
        const endpoint = typeof source.inputSnapshot.endpoint === 'string' ? source.inputSnapshot.endpoint : null
        if (!endpoint) return 'invalid_question'
        const nextSnapshot = {
          prompt: input.response,
          attachmentIds: [
            ...new Set([
              ...(Array.isArray(source.inputSnapshot.attachmentIds)
                ? source.inputSnapshot.attachmentIds.filter((id): id is string => typeof id === 'string')
                : []),
              ...input.attachmentIds,
            ]),
          ],
          projectContext: Array.isArray(source.inputSnapshot.projectContext)
            ? structuredClone(source.inputSnapshot.projectContext)
            : [],
          endpoint,
          projectDraftVersion: source.inputSnapshot.projectDraftVersion,
          reservedMicros,
          maximumRateMicrosPerToken: source.inputSnapshot.maximumRateMicrosPerToken,
          providerInputSnapshot,
          providerRequestKey: null,
          responseToQuestionId: input.questionId,
          responseAttachmentIds: [...input.attachmentIds],
        }
        const responseDigest = agentRunInputDigest({
          projectId: input.projectId,
          conversationId: source.conversationId,
          taskId: input.taskId,
          turnId: input.turnId,
          prompt: input.response,
          attachmentIds: nextSnapshot.attachmentIds,
          projectContext: nextSnapshot.projectContext.filter(
            (item): item is { title: string; content: string; status: 'confirmed' } =>
              item &&
              typeof item === 'object' &&
              !Array.isArray(item) &&
              item.status === 'confirmed' &&
              typeof item.title === 'string' &&
              typeof item.content === 'string',
          ),
        })
        const [dispatch] = await tx
          .insert(agentRunDispatches)
          .values({
            actorId,
            projectId: input.projectId,
            conversationId: source.conversationId,
            taskId: input.taskId,
            turnId: input.turnId,
            operationId,
            inputDigest: responseDigest,
            inputSnapshot: nextSnapshot,
            phase: 'planning',
            frozenProvider: source.frozenProvider,
            frozenModel: source.frozenModel,
            frozenProfile: source.frozenProfile,
            frozenConfigDigest: source.frozenConfigDigest,
            billingScope: source.billingScope,
            payerId: source.payerId,
            taskLimitMicros: source.taskLimitMicros,
            projectLimitMicros: source.projectLimitMicros,
            warningRatio: source.warningRatio,
            providerIdempotency: source.providerIdempotency,
            kind: 'run',
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning()
        if (!dispatch) throw new Error('Agent response dispatch insert returned no row')
        await tx.insert(agentRunCosts).values({
          actorId,
          projectId: input.projectId,
          taskId: input.taskId,
          turnId: input.turnId,
          inputDigest: responseDigest,
          operationId,
          provider: source.frozenProvider,
          model: source.frozenModel,
          profile: source.frozenProfile,
          state: 'reserved',
          accuracy: null,
          reservedMicros,
          billingScope: source.billingScope,
          payerId: source.payerId,
          reservationExpiresAt: new Date(input.now.getTime() + 10 * 60_000),
          createdAt: input.now,
          updatedAt: input.now,
        })
        await tx
          .update(agentRunDispatches)
          .set({ phase: 'terminal', updatedAt: input.now })
          .where(eq(agentRunDispatches.id, source.id))
        return { dispatch: dispatch as AgentRunDispatchRecord }
      })
    },
    getAgentRunDispatch(actorId, projectId, operationId) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
            ),
          )
          .limit(1)
        return (dispatch as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    getAgentRunDispatchByTask(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunDispatches.createdAt))
          .limit(1)
        return (dispatch as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    async claimAgentRunDispatch(workerId, now, leaseUntil) {
      if (!workerId.trim()) throw new Error('Agent run dispatch worker id is required')
      if (leaseUntil.getTime() <= now.getTime()) throw new Error('Agent run dispatch lease must end after claim time')
      const result = (await db.execute(sql`
        select
          claimed.id,
          claimed.actor_id as "actorId",
          claimed.project_id as "projectId",
          claimed.conversation_id as "conversationId",
          claimed.task_id as "taskId",
          claimed.operation_id as "operationId",
          claimed.kind,
          claimed.waiting_reason as "waitingReason",
          claimed.state,
          claimed.desired_state as "desiredState",
          claimed.generation,
          claimed.lease_owner as "leaseOwner",
          claimed.lease_until as "leaseUntil",
          claimed.heartbeat_at as "heartbeatAt",
          claimed.attempt_count as "attemptCount",
          claimed.error_code as "errorCode",
          claimed.error_message as "errorMessage",
          claimed.created_at as "createdAt",
          claimed.updated_at as "updatedAt",
          claimed.completed_at as "completedAt"
        from app.claim_agent_run_dispatch(${workerId}, ${now}, ${leaseUntil}) as claimed
      `)) as unknown as { rows?: AgentRunDispatchRecord[] }
      return result.rows?.[0] ?? null
    },
    heartbeatAgentRunDispatch(actorId, id, workerId, generation, now, leaseUntil) {
      if (leaseUntil.getTime() <= now.getTime()) throw new Error('Agent run dispatch lease must end after heartbeat')
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            leaseUntil,
            heartbeatAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunDispatches.id, id),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.leaseOwner, workerId),
              eq(agentRunDispatches.generation, generation),
              gt(agentRunDispatches.leaseUntil, now),
            ),
          )
          .returning()
        return (updated as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    controlAgentRunDispatch(actorId, projectId, operationId, action, now) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch) return null

        const activeLease =
          dispatch.state === 'running' && dispatch.leaseUntil !== null && dispatch.leaseUntil.getTime() > now.getTime()
        if (action === 'pause' && dispatch.desiredState === 'paused' && activeLease)
          return dispatch as AgentRunDispatchRecord
        if (action === 'resume' && dispatch.desiredState === 'running' && dispatch.state !== 'paused')
          return dispatch as AgentRunDispatchRecord
        if (action === 'cancel' && dispatch.desiredState === 'canceled' && activeLease)
          return dispatch as AgentRunDispatchRecord

        if (['succeeded', 'failed', 'canceled', 'indeterminate'].includes(dispatch.state)) return 'invalid_state'

        let nextState = dispatch.state
        let nextDesiredState = dispatch.desiredState
        let releaseLease = false
        let completedAt = dispatch.completedAt
        let reconciledOperation: AgentSpikeOperationRecord | null | undefined
        if ((action === 'pause' || action === 'cancel') && !activeLease) {
          await lockAgentSpikeOperation(tx, actorId, operationId)
          reconciledOperation = await selectAgentSpikeOperation(tx, actorId, operationId, true)
          if (reconciledOperation && reconciledOperation.projectId !== projectId) return 'invalid_state'
          if (
            action === 'pause' &&
            dispatch.state === 'paused' &&
            dispatch.desiredState === 'paused' &&
            reconciledDispatchState(reconciledOperation?.status ?? null) === null
          ) {
            return dispatch as AgentRunDispatchRecord
          }
        }

        if (action === 'pause') {
          nextDesiredState = 'paused'
          if (dispatch.state !== 'running' || !activeLease) {
            nextState = reconciledDispatchState(reconciledOperation?.status ?? null) ?? 'paused'
            releaseLease = true
            completedAt = nextState === 'paused' ? null : now
          }
        } else if (action === 'resume') {
          nextDesiredState = 'running'
          if (dispatch.state === 'paused') {
            nextState = 'queued'
            releaseLease = true
          }
        } else {
          nextDesiredState = 'canceled'
          if (dispatch.state !== 'running' || !activeLease) {
            const operation = reconciledOperation
            const terminalState = reconciledDispatchState(operation?.status ?? null)
            if (terminalState) {
              nextState = terminalState
              releaseLease = true
              completedAt = now
            } else if (operation) {
              await tx
                .update(agentSpikeOperations)
                .set({
                  status: 'failed_not_applied',
                  outcome: { status: 'failed_not_applied', reason: 'user_canceled' },
                  completedAt: now,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(agentSpikeOperations.id, operation.id),
                    inArray(agentSpikeOperations.status, ['issued', 'prepared']),
                  ),
                )
              nextState = 'canceled'
              releaseLease = true
              completedAt = now
            } else {
              nextState = 'indeterminate'
              releaseLease = true
              completedAt = now
            }
          }
        }

        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            state: nextState,
            desiredState: nextDesiredState,
            leaseOwner: releaseLease ? null : dispatch.leaseOwner,
            leaseUntil: releaseLease ? null : dispatch.leaseUntil,
            completedAt,
            ...(nextState === 'indeterminate'
              ? {
                  errorCode: 'operation_state_indeterminate',
                  errorMessage: 'Durable operation state could not be reconciled',
                }
              : {}),
            ...(action === 'resume' ? { errorCode: null, errorMessage: null } : {}),
            ...(action === 'resume' ? { waitingReason: null } : {}),
            updatedAt: now,
          })
          .where(eq(agentRunDispatches.id, dispatch.id))
          .returning()
        return (updated as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    finalizeAgentRunAttachments(actorId, projectId, operationId, now) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select()
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
            ),
          )
          .for('update')
          .limit(1)
        if (!dispatch) return null

        const waitingForInitialUpload =
          dispatch.kind === 'initial' &&
          dispatch.state === 'paused' &&
          dispatch.desiredState === 'paused' &&
          dispatch.waitingReason === 'upload'
        if (!waitingForInitialUpload) {
          return { dispatch: dispatch as AgentRunDispatchRecord, transitioned: false }
        }

        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            state: 'queued',
            desiredState: 'running',
            waitingReason: null,
            leaseOwner: null,
            leaseUntil: null,
            heartbeatAt: null,
            errorCode: null,
            errorMessage: null,
            completedAt: null,
            updatedAt: now,
          })
          .where(eq(agentRunDispatches.id, dispatch.id))
          .returning()
        if (!updated) return null
        return { dispatch: updated as AgentRunDispatchRecord, transitioned: true }
      })
    },
    markAgentRunDispatchWaiting(actorId, projectId, operationId, reason, now) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(agentRunDispatches)
          .set({
            state: 'paused',
            desiredState: 'paused',
            waitingReason: reason,
            errorCode: reason === 'user' ? 'waiting_user' : null,
            errorMessage: reason === 'user' ? '等待用户补充信息' : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
              eq(agentRunDispatches.kind, 'initial'),
              eq(agentRunDispatches.state, 'paused'),
            ),
          )
          .returning()
        return (updated as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    validateAgentRunDispatchAttempt(actorId, projectId, operationId, attempt, now) {
      return withActor(actorId, async tx => {
        const [dispatch] = await tx
          .select({ id: agentRunDispatches.id })
          .from(agentRunDispatches)
          .where(
            and(
              eq(agentRunDispatches.id, attempt.dispatchId),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.projectId, projectId),
              eq(agentRunDispatches.operationId, operationId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.desiredState, 'running'),
              eq(agentRunDispatches.leaseOwner, attempt.workerId),
              eq(agentRunDispatches.generation, attempt.leaseGeneration),
              gt(agentRunDispatches.leaseUntil, now),
            ),
          )
          .limit(1)
        return Boolean(dispatch)
      })
    },
    finishAgentRunDispatch(actorId, id, workerId, generation, state, error, now) {
      return withActor(actorId, async tx => {
        const [finished] = await tx
          .update(agentRunDispatches)
          .set({
            state,
            ...(state === 'paused'
              ? { desiredState: 'paused' as const }
              : state === 'canceled'
                ? { desiredState: 'canceled' as const }
                : {}),
            leaseOwner: null,
            leaseUntil: null,
            heartbeatAt: now,
            errorCode: error?.code ?? null,
            errorMessage: error?.message ?? null,
            waitingReason: state === 'paused' && error?.code === 'waiting_user' ? 'user' : null,
            completedAt: state === 'paused' ? null : now,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunDispatches.id, id),
              eq(agentRunDispatches.actorId, actorId),
              eq(agentRunDispatches.state, 'running'),
              eq(agentRunDispatches.leaseOwner, workerId),
              eq(agentRunDispatches.generation, generation),
              gt(agentRunDispatches.leaseUntil, now),
            ),
          )
          .returning()
        return (finished as AgentRunDispatchRecord | undefined) ?? null
      })
    },
    getAgentRunCost(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        const costs = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunCosts.createdAt), desc(agentRunCosts.id))
        return aggregateAgentRunCostRows(costs as AgentRunCostRecord[])
      })
    },
    getAgentRunCostByTurn(actorId, projectId, turnId) {
      return withActor(actorId, async tx => {
        const [cost] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.turnId, turnId),
            ),
          )
          .limit(1)
        return (cost as AgentRunCostRecord | undefined) ?? null
      })
    },
    reconcileAgentRunCost(actorId, projectId, taskId, now) {
      return withActor(actorId, async tx => {
        await tx.execute(sql`
          update app.agent_run_costs as cost
          set state = 'settled',
              accuracy = 'billing_indeterminate',
              settled_micros = cost.reserved_micros,
              minimum_micros = 0,
              maximum_micros = cost.reserved_micros,
              updated_at = ${now}
          where cost.actor_id = ${actorId}
            and cost.project_id = ${projectId}
            and cost.task_id = ${taskId}
            and cost.state = 'reserved'
            and cost.reservation_expires_at <= ${now}
            and exists (
              select 1
              from app.agent_run_dispatches as dispatch
              join app.agent_provider_attempts as attempt on attempt.dispatch_id = dispatch.id
              where dispatch.actor_id = cost.actor_id
                and dispatch.project_id = cost.project_id
                and dispatch.turn_id = cost.turn_id
                and attempt.attempt_no = (
                  select max(latest.attempt_no)
                  from app.agent_provider_attempts as latest
                  where latest.dispatch_id = dispatch.id
                )
                and attempt.state in ('started', 'outcome_unknown')
            )
        `)
        await tx
          .update(agentRunCosts)
          .set({
            state: 'released',
            accuracy: null,
            settledMicros: 0,
            minimumMicros: null,
            maximumMicros: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
              eq(agentRunCosts.state, 'reserved'),
              lte(agentRunCosts.reservationExpiresAt, now),
            ),
          )
        const costs = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunCosts.createdAt), desc(agentRunCosts.id))
        return aggregateAgentRunCostRows(costs as AgentRunCostRecord[])
      })
    },
    failAgentSpikeOperation(actorId, binding, outcome) {
      return withActor(actorId, async tx => {
        await lockAgentSpikeOperation(tx, actorId, binding.operationId)
        const operation = await selectAgentSpikeOperation(tx, actorId, binding.operationId, true)
        if (!operation) return null
        if (!agentSpikeBindingMatches(operation, binding)) return 'integrity_conflict'
        if (operation.status === 'committed' || operation.status === 'rejected_stale') return operation
        if (operation.status === 'failed_not_applied' || operation.status === 'indeterminate') return operation
        if (operation.status !== 'issued' && operation.status !== 'prepared') return 'invalid_state'
        const completedAt = new Date()
        const [failed] = await tx
          .update(agentSpikeOperations)
          .set({
            status: 'failed_not_applied',
            outcome: { ...outcome, status: 'failed_not_applied' },
            completedAt,
            updatedAt: completedAt,
          })
          .where(and(eq(agentSpikeOperations.id, operation.id), eq(agentSpikeOperations.status, operation.status)))
          .returning()
        return failed ?? 'invalid_state'
      })
    },
    async undoAgentSpikeOperation(actorId, projectId, operationId) {
      try {
        return await withActor(actorId, async tx => {
          await lockAgentSpikeOperation(tx, actorId, operationId)
          const operation = await selectAgentSpikeOperation(tx, actorId, operationId, true)
          if (!operation || operation.projectId !== projectId) return null
          if (operation.rolledBackAt && operation.rollbackReceipt) {
            const currentProject = await selectProjectDetail(tx, actorId, projectId)
            if (!currentProject) return null
            return {
              project: currentProject,
              rolledBackAt: operation.rolledBackAt,
              receipt: operation.rollbackReceipt,
            }
          }
          if (
            operation.status !== 'committed' ||
            !operation.rollbackRevisionId ||
            operation.committedDraftVersion === null ||
            !operation.candidateSchema
          ) {
            return 'invalid_state'
          }
          const [project] = await tx
            .select({ draftVersion: projects.draftVersion, draftSchema: projects.draftSchema })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!project) return null
          const [rollback] = await tx
            .select({ schema: projectRevisions.schema })
            .from(projectRevisions)
            .where(
              and(
                eq(projectRevisions.id, operation.rollbackRevisionId),
                eq(projectRevisions.projectId, projectId),
                eq(projectRevisions.kind, 'agent'),
              ),
            )
            .limit(1)
          if (!rollback) return 'invalid_state'
          const undo = safeAgentUndo(rollback.schema, operation.candidateSchema, project.draftSchema)
          if (!undo.ok) return 'conflict'

          const restoredAt = new Date()
          await insertRevision(tx, {
            actorId,
            projectId,
            schema: project.draftSchema,
            kind: 'pre_restore',
            sourceDraftVersion: project.draftVersion,
            label: `撤销 Agent 执行 · ${operation.taskId}`.slice(0, 120),
          })
          const nextDraftVersion = project.draftVersion + 1
          const [restored] = await tx
            .update(projects)
            .set({
              draftSchema: undo.schema,
              draftVersion: nextDraftVersion,
              draftSavedAt: restoredAt,
              ...projectMetadata(undo.schema),
              thumbnailStatus: sql`case
                when ${projects.thumbnailMode} = 'auto' then 'queued'
                when ${projects.thumbnailPath} is not null then 'ready'
                else 'failed'
              end`,
              thumbnailRequestedVersion: thumbnailRequestedVersionCase(nextDraftVersion),
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
              thumbnailErrorCode: sql`case
                when ${projects.thumbnailMode} = 'auto' then null
                when ${projects.thumbnailPath} is not null then null
                else 'draft-version-changed'
              end`,
              updatedAt: restoredAt,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.draftVersion, project.draftVersion),
                isNull(projects.deletedAt),
              ),
            )
            .returning({ id: projects.id })
          if (!restored) throw new AgentUndoConflictRollback()
          const receipt = {
            receiptVersion: 'easy-dashboard.agent-undo-receipt.v2',
            operationId,
            rollbackRevisionId: operation.rollbackRevisionId,
            revertedPaths: undo.revertedPaths,
            sourceCommittedDraftVersion: operation.committedDraftVersion,
            preUndoDraftVersion: project.draftVersion,
            restoredDraftVersion: nextDraftVersion,
          }
          const [recorded] = await tx
            .update(agentSpikeOperations)
            .set({ rolledBackAt: restoredAt, rollbackReceipt: receipt, updatedAt: restoredAt })
            .where(and(eq(agentSpikeOperations.id, operation.id), isNull(agentSpikeOperations.rolledBackAt)))
            .returning({ rolledBackAt: agentSpikeOperations.rolledBackAt })
          if (!recorded?.rolledBackAt) throw new Error('Agent undo receipt was not persisted')
          const restoredProject = await selectProjectDetail(tx, actorId, projectId)
          if (!restoredProject) throw new Error('Undone Agent project could not be read')
          return { project: restoredProject, rolledBackAt: recorded.rolledBackAt, receipt }
        })
      } catch (error) {
        if (error instanceof AgentUndoConflictRollback) return 'conflict'
        throw error
      }
    },
    updateProject(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        return updated ? selectProjectDetail(tx, actorId, projectId) : null
      })
    },
    setProjectFavorite(actorId, projectId, isFavorite) {
      return withActor(actorId, async tx => {
        const [visible] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!visible) return null
        if (isFavorite) {
          await tx
            .insert(projectFavorites)
            .values({ projectId, userId: actorId })
            .onConflictDoNothing({ target: [projectFavorites.projectId, projectFavorites.userId] })
        } else {
          await tx
            .delete(projectFavorites)
            .where(and(eq(projectFavorites.projectId, projectId), eq(projectFavorites.userId, actorId)))
        }
        const [project] = await tx
          .select(projectSummarySelection(actorId))
          .from(projects)
          .leftJoin(
            projectPublications,
            and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
          )
          .leftJoin(
            projectReleases,
            and(
              eq(projectReleases.projectId, projects.id),
              eq(projectReleases.revisionId, projectPublications.revisionId),
            ),
          )
          .where(eq(projects.id, projectId))
          .limit(1)
        return project ?? null
      })
    },
    duplicateProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [source] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!source) return null
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const copyId = randomUUID()
        await tx.insert(projects).values({
          id: copyId,
          ownerId: actorId,
          spaceId,
          name: `${source.name} copy`.slice(0, 120),
          description: source.description,
          coverUrl: source.coverUrl,
          draftSchema: source.draftSchema,
          ...projectMetadata(source.draftSchema),
        })
        await insertProjectOwnerMembership(tx, copyId, actorId)
        return selectProjectDetail(tx, actorId, copyId)
      })
    },
    async trashProject(actorId, accessToken, projectId) {
      const trashed = await withActor(actorId, async tx => {
        const now = new Date()
        const [project] = await tx
          .update(projects)
          .set({
            deletedAt: now,
            thumbnailPath: null,
            thumbnailUrl: null,
            thumbnailDraftVersion: null,
            thumbnailStatus: 'queued',
            thumbnailErrorCode: null,
            thumbnailRequestedVersion: null,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            updatedAt: now,
          })
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        if (!project) return false
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, ${now})`,
            updatedAt: now,
          })
          .where(
            and(eq(projectThumbnailArtifacts.projectId, projectId), ne(projectThumbnailArtifacts.status, 'deleted')),
          )
        await tx
          .update(projectPublications)
          .set({ isPublished: false, updatedAt: now })
          .where(eq(projectPublications.projectId, projectId))
        return true
      })
      if (trashed) await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      return trashed
    },
    async permanentlyDeleteProject(actorId, accessToken, projectId) {
      const state = await withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            deletedAt: projects.deletedAt,
            permanentDeleteToken: projects.permanentDeleteToken,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canOwnProject(actorId)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (!project.deletedAt) return 'conflict' as const
        const deleteToken = project.permanentDeleteToken ?? randomUUID()
        const prepared = (await tx.execute(sql`
          select storage_path
          from app.prepare_project_agent_asset_cleanup(${projectId}, ${project.deletedAt}, ${deleteToken})
        `)) as unknown as { rows?: Array<{ storage_path?: unknown }> }
        const assetPaths = (prepared.rows ?? []).flatMap(row =>
          typeof row.storage_path === 'string' ? [row.storage_path] : [],
        )
        return { deletedAt: project.deletedAt, deleteToken, assetPaths }
      })
      if (state === null || state === 'conflict') return state

      const finishAgentAssetCleanup = async (succeeded: boolean, failureMessage: string | null) =>
        withActor(actorId, async tx => {
          const result = (await tx.execute(sql`
            select app.finish_project_agent_asset_cleanup(
              ${projectId},
              ${state.deletedAt},
              ${state.deleteToken},
              ${succeeded},
              ${failureMessage}
            ) as finished
          `)) as unknown as { rows?: Array<{ finished?: unknown }> }
          return result.rows?.[0]?.finished === true
        })

      // The owner-only cleanup policy can remove every collaborator-owned
      // object only after the security-definer preparation function has
      // tombstoned and scrubbed the complete project ledger. Partial batches
      // are safe to retry because Storage deletion is idempotent and the
      // project row is retained until settlement succeeds.
      for (let index = 0; index < state.assetPaths.length; index += 100) {
        const { error } = await agentAssetStorage(accessToken).remove(state.assetPaths.slice(index, index + 100))
        if (error) {
          await finishAgentAssetCleanup(
            false,
            (error.message || 'Unable to delete project Agent assets').slice(0, 1000),
          ).catch(() => false)
          throw new Error(error.message || 'Unable to delete project Agent assets')
        }
      }
      if (!(await finishAgentAssetCleanup(true, null))) return 'conflict'

      // Trash already clears project thumbnail references. Reconciliation
      // preserves signed-upload expiry guarantees, marks the remaining ledger
      // rows for cleanup, and makes a best-effort storage deletion before the
      // project aggregate is removed.
      await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)

      return withActor(actorId, async tx => {
        const [deleted] = await tx
          .delete(projects)
          .where(
            and(
              eq(projects.id, projectId),
              canOwnProject(actorId),
              eq(projects.deletedAt, state.deletedAt),
              eq(projects.permanentDeleteToken, state.deleteToken),
            ),
          )
          .returning({ id: projects.id })
        if (deleted) return true

        const [existing] = await tx
          .select({ id: projects.id, deletedAt: projects.deletedAt })
          .from(projects)
          .where(and(eq(projects.id, projectId), canOwnProject(actorId)))
          .limit(1)
        return existing ? ('conflict' as const) : null
      })
    },
    restoreProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              isNotNull(projects.deletedAt),
              isNull(projects.permanentDeleteToken),
            ),
          )
          .returning({ id: projects.id })
        if (updated) return selectProjectDetail(tx, actorId, projectId)

        const [deleting] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              isNotNull(projects.deletedAt),
              isNotNull(projects.permanentDeleteToken),
            ),
          )
          .limit(1)
        return deleting ? ('deletion_in_progress' as const) : null
      })
    },
    saveDraft(actorId, projectId, expectedVersion, draftSchema) {
      return withActor(actorId, async tx => {
        const savedAt = new Date()
        const [updated] = await tx
          .update(projects)
          .set({
            draftSchema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: savedAt,
            ...projectMetadata(draftSchema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: savedAt,
          })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              eq(projects.draftVersion, expectedVersion),
              isNull(projects.deletedAt),
            ),
          )
          .returning()
        if (updated) {
          const [latestAuto] = await tx
            .select({ createdAt: projectRevisions.createdAt })
            .from(projectRevisions)
            .where(and(eq(projectRevisions.projectId, projectId), eq(projectRevisions.kind, 'auto')))
            .orderBy(desc(projectRevisions.createdAt))
            .limit(1)
          if (!latestAuto || savedAt.getTime() - latestAuto.createdAt.getTime() >= 5 * 60 * 1000) {
            await insertRevision(tx, {
              actorId,
              projectId,
              schema: draftSchema,
              kind: 'auto',
              sourceDraftVersion: expectedVersion + 1,
            })
          }
          const project = await selectProjectDetail(tx, actorId, projectId)
          if (!project) throw new Error('Saved project could not be read')
          return project
        }
        const [existing] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return existing ? 'conflict' : null
      })
    },
    listRevisions(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [owned] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!owned) return null
        return tx
          .select({
            id: projectRevisions.id,
            projectId: projectRevisions.projectId,
            revisionNumber: projectRevisions.revisionNumber,
            kind: projectRevisions.kind,
            label: projectRevisions.label,
            sourceDraftVersion: projectRevisions.sourceDraftVersion,
            schema: projectRevisions.schema,
            createdAt: projectRevisions.createdAt,
          })
          .from(projectRevisions)
          .where(and(eq(projectRevisions.projectId, projectId), ne(projectRevisions.kind, 'publish')))
          .orderBy(desc(projectRevisions.revisionNumber))
      })
    },
    listReleases(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [visible] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId)))
          .limit(1)
        if (!visible) return null
        return tx
          .select({
            projectId: projectReleases.projectId,
            releaseNumber: projectReleases.releaseNumber,
            revisionId: projectReleases.revisionId,
            revisionNumber: projectRevisions.revisionNumber,
            name: projectReleases.name,
            description: projectReleases.description,
            publishedAt: projectReleases.publishedAt,
            slug: projectPublications.slug,
            isCurrent: sql<boolean>`${projectPublications.revisionId} = ${projectReleases.revisionId}`,
            isPublished: sql<boolean>`coalesce(${projectPublications.isPublished}, false)`,
          })
          .from(projectReleases)
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .leftJoin(projectPublications, eq(projectPublications.projectId, projectReleases.projectId))
          .where(eq(projectReleases.projectId, projectId))
          .orderBy(desc(projectReleases.releaseNumber))
      })
    },
    createRestorePoint(actorId, projectId, kind, label) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            draftSchema: projects.draftSchema,
            draftVersion: projects.draftVersion,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        return insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind,
          sourceDraftVersion: project.draftVersion,
          label,
        })
      })
    },
    restoreRevision(actorId, projectId, revisionId, expectedVersion) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== expectedVersion) return 'conflict'
        const [revision] = await tx
          .select({ schema: projectRevisions.schema })
          .from(projectRevisions)
          .where(
            and(
              eq(projectRevisions.id, revisionId),
              eq(projectRevisions.projectId, projectId),
              ne(projectRevisions.kind, 'publish'),
            ),
          )
          .limit(1)
        if (!revision) return null
        await insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind: 'pre_restore',
          sourceDraftVersion: project.draftVersion,
        })
        const [restored] = await tx
          .update(projects)
          .set({
            draftSchema: revision.schema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: new Date(),
            ...projectMetadata(revision.schema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: new Date(),
          })
          .where(and(eq(projects.id, projectId), eq(projects.draftVersion, expectedVersion)))
          .returning({ id: projects.id })
        if (!restored) return 'conflict'
        const detail = await selectProjectDetail(tx, actorId, projectId)
        if (!detail) throw new Error('Restored project could not be read')
        return detail
      })
    },
    restoreRelease(actorId, projectId, releaseNumber, expectedVersion) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== expectedVersion) return 'conflict'

        const [release] = await tx
          .select({ schema: projectRevisions.schema })
          .from(projectReleases)
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .where(
            and(
              eq(projectReleases.projectId, projectId),
              eq(projectReleases.releaseNumber, releaseNumber),
              eq(projectRevisions.projectId, projectId),
              eq(projectRevisions.kind, 'publish'),
            ),
          )
          .limit(1)
        if (!release) return null

        await insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind: 'pre_restore',
          sourceDraftVersion: project.draftVersion,
        })
        const savedAt = new Date()
        const [restored] = await tx
          .update(projects)
          .set({
            draftSchema: release.schema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: savedAt,
            ...projectMetadata(release.schema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: savedAt,
          })
          .where(and(eq(projects.id, projectId), eq(projects.draftVersion, expectedVersion)))
          .returning({ id: projects.id })
        if (!restored) return 'conflict'

        const detail = await selectProjectDetail(tx, actorId, projectId)
        if (!detail) throw new Error('Restored release draft could not be read')
        return detail
      })
    },
    createPublishSnapshot(actorId, projectId, draftVersion) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            draftSchema: projects.draftSchema,
            draftVersion: projects.draftVersion,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== draftVersion) return 'conflict'

        const documentSha256 = canonicalJsonSha256(project.draftSchema)
        const inserted = await tx
          .insert(projectPublishSnapshots)
          .values({
            projectId,
            draftVersion,
            document: project.draftSchema,
            documentSha256,
            createdBy: actorId,
          })
          .onConflictDoNothing()
          .returning()
        const [snapshot] = inserted.length
          ? inserted
          : await tx
              .select()
              .from(projectPublishSnapshots)
              .where(
                and(
                  eq(projectPublishSnapshots.projectId, projectId),
                  eq(projectPublishSnapshots.draftVersion, draftVersion),
                ),
              )
              .limit(1)
        if (!snapshot) throw new Error('Publish snapshot insert returned no row')
        if (snapshot.documentSha256 !== documentSha256) return 'conflict'

        const [existingPreview] = await tx
          .select()
          .from(projectPreviewRuns)
          .where(eq(projectPreviewRuns.publishSnapshotId, snapshot.id))
          .limit(1)
        if (existingPreview) return { snapshot, previewRun: existingPreview }

        const [operation] = await tx
          .select({
            id: agentSpikeOperations.id,
            compatibility: agentSpikeOperations.compatibility,
            evidence: agentSpikeOperations.evidence,
          })
          .from(agentSpikeOperations)
          .where(
            and(
              eq(agentSpikeOperations.projectId, projectId),
              eq(agentSpikeOperations.status, 'committed'),
              eq(agentSpikeOperations.candidateDigest, documentSha256),
            ),
          )
          .orderBy(desc(agentSpikeOperations.completedAt))
          .limit(1)
        const rendererVersion = operation?.compatibility.rendererVersion
        const rendererSha256 = operation?.compatibility.rendererSha256
        if (
          operation &&
          cleanAgentPreviewEvidence(operation.evidence) &&
          typeof rendererVersion === 'string' &&
          typeof rendererSha256 === 'string' &&
          /^[a-f0-9]{64}$/.test(rendererSha256)
        ) {
          const [previewRun] = await tx
            .insert(projectPreviewRuns)
            .values({
              projectId,
              publishSnapshotId: snapshot.id,
              source: 'agent_executor',
              status: 'verified',
              documentSha256,
              rendererVersion,
              rendererSha256,
              evidence: operation.evidence ?? {},
              agentOperationId: operation.id,
              createdBy: actorId,
            })
            .returning()
          if (!previewRun) throw new Error('Agent preview evidence insert returned no row')
          return { snapshot, previewRun }
        }

        const [rendererArtifact] = await tx
          .select({
            id: projectThumbnailArtifacts.id,
            path: projectThumbnailArtifacts.path,
            size: projectThumbnailArtifacts.expectedSize,
            draftVersion: projectThumbnailArtifacts.draftVersion,
          })
          .from(projectThumbnailArtifacts)
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.status, 'current'),
              eq(projectThumbnailArtifacts.draftVersion, draftVersion),
              or(
                and(
                  eq(projectThumbnailArtifacts.source, 'renderer'),
                  eq(projectThumbnailArtifacts.contentType, 'image/webp'),
                ),
                and(
                  eq(projectThumbnailArtifacts.source, 'blueprint'),
                  eq(projectThumbnailArtifacts.contentType, 'image/svg+xml'),
                ),
              ),
            ),
          )
          .orderBy(desc(projectThumbnailArtifacts.updatedAt))
          .limit(1)
        if (rendererArtifact) {
          const isBlueprint = rendererArtifact.path.endsWith('.svg')
          const evidence = {
            artifactId: rendererArtifact.id,
            path: rendererArtifact.path,
            size: rendererArtifact.size,
            draftVersion: rendererArtifact.draftVersion,
            documentSha256,
          }
          const [previewRun] = await tx
            .insert(projectPreviewRuns)
            .values({
              projectId,
              publishSnapshotId: snapshot.id,
              source: isBlueprint ? 'editor_blueprint_artifact' : 'editor_renderer_artifact',
              status: 'verified',
              documentSha256,
              rendererVersion: isBlueprint ? EDITOR_BLUEPRINT_ARTIFACT_VERSION : EDITOR_RENDERER_ARTIFACT_VERSION,
              rendererSha256: isBlueprint ? EDITOR_BLUEPRINT_ARTIFACT_SHA256 : EDITOR_RENDERER_ARTIFACT_SHA256,
              evidence,
              thumbnailArtifactId: rendererArtifact.id,
              artifactPath: rendererArtifact.path,
              artifactSize: rendererArtifact.size,
              artifactDraftVersion: rendererArtifact.draftVersion,
              createdBy: actorId,
            })
            .returning()
          if (!previewRun) throw new Error('Editor renderer preview evidence insert returned no row')
          return { snapshot, previewRun }
        }
        return { snapshot, previewRun: null }
      })
    },
    approvePublishSnapshot(actorId, projectId, snapshotId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id, isOwner: canOwnProject(actorId) })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        if (!project.isOwner) return 'forbidden'
        const [previewRun] = await tx
          .select()
          .from(projectPreviewRuns)
          .where(
            and(
              eq(projectPreviewRuns.projectId, projectId),
              eq(projectPreviewRuns.publishSnapshotId, snapshotId),
              eq(projectPreviewRuns.status, 'verified'),
              inArray(projectPreviewRuns.source, [
                'agent_executor',
                'editor_renderer_artifact',
                'editor_blueprint_artifact',
              ]),
            ),
          )
          .limit(1)
        if (!previewRun) return 'preview_required'
        const inserted = await tx
          .insert(projectPublishApprovals)
          .values({
            projectId,
            publishSnapshotId: snapshotId,
            previewRunId: previewRun.id,
            approvedBy: actorId,
          })
          .onConflictDoNothing()
          .returning()
        const [approval] = inserted.length
          ? inserted
          : await tx
              .select()
              .from(projectPublishApprovals)
              .where(eq(projectPublishApprovals.publishSnapshotId, snapshotId))
              .limit(1)
        if (!approval) throw new Error('Publish approval insert returned no row')
        return approval
      })
    },
    publish(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            ownerId: projects.ownerId,
            name: projects.name,
            description: projects.description,
            isOwner: canOwnProject(actorId),
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (!project.isOwner) return 'forbidden'

        const [existingRelease] = await tx
          .select({
            releaseNumber: projectReleases.releaseNumber,
            revisionId: projectReleases.revisionId,
            revisionNumber: projectRevisions.revisionNumber,
            document: projectPublishSnapshots.document,
            name: projectReleases.name,
            description: projectReleases.description,
            publishedAt: projectReleases.publishedAt,
            slug: projectPublications.slug,
            publicationRevisionId: projectPublications.revisionId,
            publicationIsPublished: projectPublications.isPublished,
          })
          .from(projectReleases)
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .innerJoin(projectPublishSnapshots, eq(projectPublishSnapshots.id, projectReleases.publishSnapshotId))
          .leftJoin(projectPublications, eq(projectPublications.projectId, projectReleases.projectId))
          .where(and(eq(projectReleases.projectId, projectId), eq(projectReleases.publishSnapshotId, input.snapshotId)))
          .limit(1)
        if (existingRelease?.slug) {
          return {
            ...toPublicProject({
              slug: existingRelease.slug,
              projectId,
              name: existingRelease.name,
              description: existingRelease.description,
              revisionId: existingRelease.revisionId,
              revisionNumber: existingRelease.revisionNumber,
              releaseNumber: existingRelease.releaseNumber,
              schema: existingRelease.document,
              publishedAt: existingRelease.publishedAt,
            }),
            isCurrent: existingRelease.publicationRevisionId === existingRelease.revisionId,
            isPublished:
              existingRelease.publicationRevisionId === existingRelease.revisionId &&
              existingRelease.publicationIsPublished === true,
          }
        }

        const [approval] = await tx
          .select({ id: projectPublishApprovals.id, previewRunId: projectPublishApprovals.previewRunId })
          .from(projectPublishApprovals)
          .where(
            and(
              eq(projectPublishApprovals.publishSnapshotId, input.snapshotId),
              eq(projectPublishApprovals.projectId, projectId),
              isNull(projectPublishApprovals.consumedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!approval) return 'approval_required'

        const [gate] = await tx
          .select({ snapshot: projectPublishSnapshots })
          .from(projectPublishSnapshots)
          .innerJoin(projectPreviewRuns, eq(projectPreviewRuns.id, approval.previewRunId))
          .where(
            and(
              eq(projectPublishSnapshots.id, input.snapshotId),
              eq(projectPublishSnapshots.projectId, projectId),
              eq(projectPreviewRuns.status, 'verified'),
              eq(projectPreviewRuns.documentSha256, projectPublishSnapshots.documentSha256),
              inArray(projectPreviewRuns.source, [
                'agent_executor',
                'editor_renderer_artifact',
                'editor_blueprint_artifact',
              ]),
            ),
          )
          .limit(1)
        if (!gate) return 'approval_required'

        const revision = await insertRevision(tx, {
          actorId,
          projectId,
          schema: gate.snapshot.document,
          kind: 'publish',
          sourceDraftVersion: gate.snapshot.draftVersion,
        })
        const [latestRelease] = await tx
          .select({ value: max(projectReleases.releaseNumber) })
          .from(projectReleases)
          .where(eq(projectReleases.projectId, projectId))
        const releaseNumber = (latestRelease?.value ?? 0) + 1
        const [release] = await tx
          .insert(projectReleases)
          .values({
            projectId,
            releaseNumber,
            revisionId: revision.id,
            name: project.name,
            description: project.description,
            publishedBy: actorId,
            publishSnapshotId: gate.snapshot.id,
          })
          .returning()
        if (!release) throw new Error('Release insert returned no row')

        const [existingPublication] = await tx
          .select({ slug: projectPublications.slug })
          .from(projectPublications)
          .where(eq(projectPublications.projectId, projectId))
          .limit(1)
        const slug = existingPublication?.slug ?? slugify(project.name, project.id)
        const [publication] = await tx
          .insert(projectPublications)
          .values({ projectId, ownerId: project.ownerId, revisionId: revision.id, slug })
          .onConflictDoUpdate({
            target: projectPublications.projectId,
            set: {
              revisionId: revision.id,
              isPublished: true,
              publishedAt: release.publishedAt,
              updatedAt: release.publishedAt,
            },
          })
          .returning()
        if (!publication) throw new Error('Publication upsert returned no row')
        const consumed = await tx
          .update(projectPublishApprovals)
          .set({ consumedAt: release.publishedAt, consumedReleaseId: release.id })
          .where(and(eq(projectPublishApprovals.id, approval.id), isNull(projectPublishApprovals.consumedAt)))
          .returning({ id: projectPublishApprovals.id })
        if (consumed.length !== 1) throw new Error('Publish approval was not consumed exactly once')
        return {
          ...toPublicProject({
            slug: publication.slug,
            projectId: project.id,
            name: release.name,
            description: release.description,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            releaseNumber: release.releaseNumber,
            schema: revision.schema,
            publishedAt: release.publishedAt,
          }),
          isCurrent: true,
          isPublished: true,
        }
      })
    },
    unpublish(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id, isOwner: canOwnProject(actorId) })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId)))
          .for('update')
          .limit(1)
        if (!project) return false
        if (!project.isOwner) return 'forbidden'

        const removed = await tx
          .update(projectPublications)
          .set({ isPublished: false, updatedAt: new Date() })
          .where(and(eq(projectPublications.projectId, projectId), eq(projectPublications.isPublished, true)))
          .returning({ projectId: projectPublications.projectId })
        return removed.length > 0
      })
    },
    async isPublicProjectAvailable(slug, releaseNumber) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        let query = tx
          .select({ projectId: projects.id })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))

        if (releaseNumber !== undefined) {
          query = query.innerJoin(projectReleases, eq(projectReleases.projectId, projects.id))
        }

        const [row] = await query
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              releaseNumber === undefined ? undefined : eq(projectReleases.releaseNumber, releaseNumber),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return Boolean(row)
      })
    },
    async getPublicProject(slug) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        const [row] = await tx
          .select({
            slug: projectPublications.slug,
            projectId: projects.id,
            name: projectReleases.name,
            description: projectReleases.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            releaseNumber: projectReleases.releaseNumber,
            schema: projectRevisions.schema,
            publishedAt: projectReleases.publishedAt,
          })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectPublications.revisionId))
          .innerJoin(projectReleases, eq(projectReleases.revisionId, projectRevisions.id))
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return row ? toPublicProject(row) : null
      })
    },
    async getPublicProjectVersion(slug, releaseNumber) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        const [row] = await tx
          .select({
            slug: projectPublications.slug,
            projectId: projects.id,
            name: projectReleases.name,
            description: projectReleases.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            releaseNumber: projectReleases.releaseNumber,
            schema: projectRevisions.schema,
            publishedAt: projectReleases.publishedAt,
          })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))
          .innerJoin(projectReleases, eq(projectReleases.projectId, projects.id))
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              eq(projectReleases.releaseNumber, releaseNumber),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return row ? toPublicProject(row) : null
      })
    },
    async createThumbnailUpload(actorId, accessToken, projectId, input) {
      const validArtifact =
        input.size > 0 &&
        input.size <= MAX_THUMBNAIL_BYTES &&
        ((input.mode === 'auto' &&
          ((input.source === 'renderer' && input.contentType === 'image/webp') ||
            (input.source === 'blueprint' && input.contentType === 'image/svg+xml'))) ||
          (input.mode === 'custom' && input.source === 'custom' && input.contentType === 'image/webp'))
      if (!validArtifact) return null

      const reconciled = await reconcileThumbnailArtifacts(actorId, accessToken, projectId)
      if (!reconciled) return null

      const extension = input.contentType === 'image/webp' ? 'webp' : 'svg'
      const path = `${actorId}/${projectId}/${input.draftVersion}/${randomUUID()}.${extension}`
      // The ledger must exist before Supabase evaluates the signed-upload RLS
      // policy. Use a deliberately long staging deadline, then replace it with
      // the signed token's real expiry after signing completes. If signing or
      // persistence fails, the longer deadline can only delay cleanup; it can
      // never delete an object while a returned upload URL is still valid.
      const expiresAt = new Date(Date.now() + THUMBNAIL_UPLOAD_STAGING_EXPIRES_MS)
      let prepared: true | 'conflict' | null
      try {
        prepared = await withActor(actorId, async tx => {
          const [locked] = await tx
            .select({ id: projects.id, draftVersion: projects.draftVersion })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!locked) return null
          if (locked.draftVersion !== input.draftVersion) return 'conflict'

          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'superseded',
              updatedAt: new Date(),
            })
            .where(
              and(eq(projectThumbnailArtifacts.projectId, projectId), eq(projectThumbnailArtifacts.status, 'pending')),
            )
          await tx.insert(projectThumbnailArtifacts).values({
            projectId,
            path,
            status: 'pending',
            draftVersion: input.draftVersion,
            mode: input.mode,
            source: input.source,
            contentType: input.contentType,
            expectedSize: input.size,
            expiresAt,
            createdBy: actorId,
          })
          const [updated] = await tx
            .update(projects)
            .set({
              thumbnailMode: input.mode,
              thumbnailStatus: 'rendering',
              thumbnailRequestedVersion: input.draftVersion,
              thumbnailPendingPath: path,
              thumbnailPendingContentType: input.contentType,
              thumbnailPendingSize: input.size,
              thumbnailErrorCode: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                isNull(projects.deletedAt),
                eq(projects.draftVersion, input.draftVersion),
              ),
            )
            .returning({ id: projects.id })
          if (!updated) throw new ThumbnailConflictRollback()
          return true
        })
      } catch (error) {
        if (error instanceof ThumbnailConflictRollback) prepared = 'conflict'
        else throw error
      }
      if (prepared !== true) return prepared

      const { data, error } = await thumbnailStorage(accessToken).createSignedUploadUrl(path)
      if (error || !data) {
        await withActor(actorId, async tx => {
          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'upload-signing-failed',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, path),
                eq(projectThumbnailArtifacts.status, 'pending'),
              ),
            )
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-signing-failed',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.thumbnailPendingPath, path),
              ),
            )
        })
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
        throw new Error(error?.message ?? 'Supabase did not return a signed thumbnail upload URL')
      }
      const signedExpiresAt = signedThumbnailUploadCleanupExpiry(data.token)
      const signedExpiryPersisted = await withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projectThumbnailArtifacts)
          .set({
            expiresAt: signedExpiresAt,
            nextCleanupAt: sql`case
              when ${projectThumbnailArtifacts.status} = 'cleanup_pending'
                then greatest(
                  coalesce(${projectThumbnailArtifacts.nextCleanupAt}, ${signedExpiresAt}),
                  ${signedExpiresAt}
                )
              else ${projectThumbnailArtifacts.nextCleanupAt}
            end`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, path),
              or(
                eq(projectThumbnailArtifacts.status, 'pending'),
                eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
              ),
            ),
          )
          .returning({ id: projectThumbnailArtifacts.id })
        return Boolean(updated)
      })
      if (!signedExpiryPersisted) {
        throw new Error('Signed thumbnail upload was invalidated before its expiry could be recorded')
      }
      await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      return {
        bucket: THUMBNAIL_BUCKET,
        path,
        signedUrl: data.signedUrl,
        token: data.token,
        draftVersion: input.draftVersion,
        mode: input.mode,
        contentType: input.contentType,
        maxBytes: MAX_THUMBNAIL_BYTES,
        expiresIn: 7200,
      }
    },
    async completeThumbnailUpload(actorId, accessToken, projectId, input) {
      const pending = await withActor(actorId, async tx => {
        const [artifact] = await tx
          .select({
            draftVersion: projectThumbnailArtifacts.draftVersion,
            path: projectThumbnailArtifacts.path,
            contentType: projectThumbnailArtifacts.contentType,
            size: projectThumbnailArtifacts.expectedSize,
            expiresAt: projectThumbnailArtifacts.expiresAt,
          })
          .from(projectThumbnailArtifacts)
          .innerJoin(projects, eq(projects.id, projectThumbnailArtifacts.projectId))
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, input.path),
              eq(projectThumbnailArtifacts.status, 'pending'),
              canEditProject(actorId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return artifact ?? null
      })
      if (!pending) return null
      if (pending.expiresAt.getTime() <= Date.now()) {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
        return 'conflict'
      }
      if (pending.draftVersion !== input.draftVersion || pending.path !== input.path) {
        return 'conflict'
      }

      const { data: info, error } = await thumbnailStorage(accessToken).info(input.path)
      if (
        error ||
        !info ||
        info.size !== pending.size ||
        info.contentType !== pending.contentType ||
        info.size > MAX_THUMBNAIL_BYTES
      ) {
        await withActor(actorId, async tx => {
          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'upload-validation-failed',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, input.path),
                eq(projectThumbnailArtifacts.status, 'pending'),
              ),
            )
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-validation-failed',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.thumbnailPendingPath, input.path),
                eq(projects.thumbnailRequestedVersion, input.draftVersion),
              ),
            )
        })
        return 'invalid'
      }

      let completed: Awaited<ReturnType<Repository['completeThumbnailUpload']>>
      try {
        completed = await withActor(actorId, async tx => {
          const [locked] = await tx
            .select({
              id: projects.id,
              draftVersion: projects.draftVersion,
              requestedVersion: projects.thumbnailRequestedVersion,
              pendingPath: projects.thumbnailPendingPath,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!locked) return null
          if (
            locked.draftVersion !== input.draftVersion ||
            locked.requestedVersion !== input.draftVersion ||
            locked.pendingPath !== input.path
          ) {
            return 'conflict'
          }

          const [promoted] = await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'current',
              nextCleanupAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, input.path),
                eq(projectThumbnailArtifacts.status, 'pending'),
                eq(projectThumbnailArtifacts.draftVersion, input.draftVersion),
              ),
            )
            .returning({ id: projectThumbnailArtifacts.id })
          if (!promoted) return 'conflict'

          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'replaced',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.status, 'current'),
                ne(projectThumbnailArtifacts.path, input.path),
              ),
            )
          const [updated] = await tx
            .update(projects)
            .set({
              thumbnailStatus: 'ready',
              thumbnailPath: input.path,
              thumbnailUrl: `/api/projects/${projectId}/thumbnail/content`,
              thumbnailDraftVersion: input.draftVersion,
              thumbnailErrorCode: null,
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                isNull(projects.deletedAt),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.draftVersion, input.draftVersion),
                eq(projects.thumbnailRequestedVersion, input.draftVersion),
                eq(projects.thumbnailPendingPath, input.path),
              ),
            )
            .returning({ id: projects.id })
          if (!updated) throw new ThumbnailConflictRollback()
          const project = await selectProjectDetail(tx, actorId, projectId)
          if (!project) throw new Error('Completed thumbnail project could not be read')
          return project
        })
      } catch (error) {
        if (error instanceof ThumbnailConflictRollback) completed = 'conflict'
        else throw error
      }
      if (completed && completed !== 'conflict') {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      }
      return completed
    },
    async failThumbnailUpload(actorId, accessToken, projectId, input) {
      const failed = await withActor(actorId, async tx => {
        const [artifact] = await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
            lastError: input.errorCode,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, input.path),
              eq(projectThumbnailArtifacts.status, 'pending'),
              eq(projectThumbnailArtifacts.draftVersion, input.draftVersion),
            ),
          )
          .returning({ id: projectThumbnailArtifacts.id })
        if (!artifact) {
          const [existing] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .limit(1)
          return existing ? 'conflict' : false
        }
        const [updated] = await tx
          .update(projects)
          .set({
            thumbnailStatus: 'failed',
            thumbnailErrorCode: input.errorCode,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
          })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              isNull(projects.deletedAt),
              eq(projects.thumbnailStatus, 'rendering'),
              eq(projects.thumbnailRequestedVersion, input.draftVersion),
              eq(projects.thumbnailPendingPath, input.path),
            ),
          )
          .returning({ id: projects.id })
        if (updated) return true
        return 'conflict'
      })
      if (failed === true) {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      }
      return failed
    },
    reconcileThumbnailArtifacts,
    async getThumbnailDownloadUrl(actorId, accessToken, projectId) {
      const path = await withActor(actorId, async tx => {
        const [project] = await tx
          .select({ thumbnailPath: projects.thumbnailPath })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return project?.thumbnailPath ?? null
      })
      if (!path) return null
      const { data, error } = await thumbnailStorage(accessToken).createSignedUrl(path, 60)
      if (error || !data) throw new Error(error?.message ?? 'Supabase did not return a signed thumbnail URL')
      return data.signedUrl
    },
    async createAgentAssetUpload(actorId, accessToken, projectId, input) {
      if (input.size > MAX_AGENT_ASSET_BYTES) return 'quota'
      const allowed = new Set([
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
        'application/pdf',
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ])
      if (!allowed.has(input.contentType)) return null
      let staleStoragePaths: string[] = []
      const result = await withActor(actorId, async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-asset:${input.idempotencyKey}`}, 0))`,
        )
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${actorId}:agent-asset-quota:${projectId}`}, 0))`,
        )
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const staleUploads = await tx.execute(sql`
          update app.agent_assets
          set status = 'failed', updated_at = now()
          where actor_id = ${actorId}
            and project_id = ${projectId}
            and status = 'uploading'
            and created_at <= now() - (${AGENT_ASSET_UPLOAD_STALE_HOURS} * interval '1 hour')
          returning storage_path
        `)
        staleStoragePaths = (
          (staleUploads as { rows?: Array<{ storage_path?: unknown }> } | undefined)?.rows ?? []
        ).flatMap(row => (typeof row.storage_path === 'string' ? [row.storage_path] : []))
        const [existing] = await tx
          .select()
          .from(agentAssets)
          .where(and(eq(agentAssets.actorId, actorId), eq(agentAssets.idempotencyKey, input.idempotencyKey)))
          .limit(1)
        if (existing) {
          const expectedConversationId = input.scope === 'conversation' ? (input.conversationId ?? null) : null
          const identityMatches =
            existing.projectId === projectId &&
            existing.conversationId === expectedConversationId &&
            existing.originalName === input.name &&
            existing.contentType === input.contentType &&
            existing.size === input.size
          if (!identityMatches || !['uploading', 'ready'].includes(existing.status)) return 'conflict' as const
          return existing.status === 'ready'
            ? {
                id: existing.id,
                path: existing.storagePath,
                alreadyCompleted: true as const,
                asset: {
                  id: existing.id,
                  originalName: existing.originalName,
                  contentType: existing.contentType,
                  size: existing.size,
                },
              }
            : { id: existing.id, path: existing.storagePath }
        }
        const [usage] = await tx
          .select({ count: sql<number>`count(*)`, size: sql<number>`coalesce(sum(${agentAssets.size}),0)` })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              inArray(agentAssets.status, ['uploading', 'processing', 'ready']),
            ),
          )
        if (
          Number(usage?.count ?? 0) >= MAX_AGENT_ASSET_COUNT ||
          Number(usage?.size ?? 0) + input.size > 200 * 1024 * 1024
        )
          return 'quota' as const
        const id = randomUUID()
        const path = `${actorId}/${projectId}/${id}/${input.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        await tx.insert(agentAssets).values({
          id,
          actorId,
          idempotencyKey: input.idempotencyKey,
          projectId,
          conversationId: input.scope === 'conversation' ? input.conversationId : null,
          originalName: input.name,
          contentType: input.contentType,
          size: input.size,
          storagePath: path,
        })
        return { id, path }
      })
      if (staleStoragePaths.length > 0) {
        await agentAssetStorage(accessToken)
          .remove(staleStoragePaths)
          .catch(() => undefined)
      }
      if (!result || result === 'quota' || result === 'conflict') return result
      if (result.alreadyCompleted === true) return result
      const { data, error } = await agentAssetStorage(accessToken).createSignedUploadUrl(result.path)
      if (error || !data) {
        await failAgentAssetUpload(actorId, accessToken, result.id)
        throw new Error(error?.message ?? 'Unable to sign agent asset upload')
      }
      return {
        id: result.id,
        bucket: AGENT_ASSET_BUCKET,
        path: result.path,
        signedUrl: data.signedUrl,
        token: data.token,
        maxBytes: MAX_AGENT_ASSET_BYTES,
        expiresIn: 7200,
      }
    },
    async completeAgentAssetUpload(actorId, accessToken, projectId, input) {
      const row = await withActor(actorId, async tx => {
        const [asset] = await tx
          .select()
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, input.id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              canEditAgentAssetProject(actorId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        return asset ?? null
      })
      if (!row || row.storagePath !== input.path) return null
      if (row.status === 'ready') {
        const { modelInputStatus, modelInputBytes, modelInputContentType, modelInputSha256, modelInputSize, ...asset } =
          row
        void modelInputStatus
        void modelInputBytes
        void modelInputContentType
        void modelInputSha256
        void modelInputSize
        return asset as import('../types.js').AgentAssetRecord
      }
      if (row.status !== 'uploading') return 'invalid'
      const { data: info, error } = await agentAssetStorage(accessToken).info(input.path)
      if (error) throw new Error(error.message || 'Unable to inspect agent asset')
      if (!info || info.size !== row.size || info.contentType !== row.contentType) {
        await failAgentAssetUpload(actorId, accessToken, row.id)
        return 'invalid'
      }
      const { data: downloaded, error: downloadError } = await agentAssetStorage(accessToken).download(input.path)
      if (downloadError) throw new Error(downloadError.message || 'Unable to download agent asset')
      if (!downloaded) {
        await failAgentAssetUpload(actorId, accessToken, row.id)
        return 'invalid'
      }
      const bytes = new Uint8Array(await downloaded.arrayBuffer())
      const digest = createHash('sha256').update(bytes).digest('hex')
      const { extractAssetText, detectAssetType } = await import('../agent/asset-extractor.js')
      if (!detectAssetType(row.contentType, bytes)) {
        await failAgentAssetUpload(actorId, accessToken, row.id)
        return 'invalid'
      }
      const extracted = extractAssetText(row.contentType, bytes)
      const updated = await withActor(actorId, async tx => {
        const [completed] = await tx
          .update(agentAssets)
          .set({
            sha256: digest,
            status: 'ready',
            extractedText: extracted.text,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, row.id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'uploading'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .returning(agentAssetPublicSelection)
        if (completed) return completed
        const [replayed] = await tx
          .select(agentAssetPublicSelection)
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, row.id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'ready'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .limit(1)
        return replayed ?? null
      })
      return updated ? ({ ...updated, status: updated.status } as import('../types.js').AgentAssetRecord) : null
    },
    async getAgentAsset(actorId, projectId, id) {
      return withActor(actorId, async tx => {
        const [row] = await tx
          .select(agentAssetPublicSelection)
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        return (row as import('../types.js').AgentAssetRecord | undefined) ?? null
      })
    },
    getAgentAssetModelInput(actorId, projectId, assetId) {
      return withActor(actorId, async tx => {
        const [asset] = await tx
          .select({
            contentType: agentAssets.contentType,
            size: agentAssets.size,
            status: agentAssets.status,
            modelInputStatus: agentAssets.modelInputStatus,
            modelInputBytes: agentAssets.modelInputBytes,
            modelInputContentType: agentAssets.modelInputContentType,
            modelInputSha256: agentAssets.modelInputSha256,
            modelInputSize: agentAssets.modelInputSize,
          })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, assetId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.projectId, projectId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        if (!asset) return null
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.contentType)) return 'unsupported'
        if (asset.size > 4 * 1024 * 1024 || asset.modelInputStatus === 'failed') return 'oversize'
        if (
          asset.status !== 'ready' ||
          asset.modelInputStatus !== 'ready' ||
          !asset.modelInputBytes ||
          !asset.modelInputContentType ||
          !asset.modelInputSha256 ||
          asset.modelInputSize === null
        ) {
          return null
        }
        return {
          record: {
            contentType: asset.modelInputContentType,
            size: asset.modelInputSize,
            sha256: asset.modelInputSha256,
          },
          bytes: new Uint8Array(asset.modelInputBytes),
        }
      })
    },
    persistAgentAssetModelInput(actorId, projectId, assetId, input) {
      return withActor(actorId, async tx => {
        const bytes = Buffer.from(input.bytes)
        if (bytes.byteLength !== input.record.size || bytes.byteLength > 4 * 1024 * 1024) return false
        const [persisted] = await tx
          .update(agentAssets)
          .set({
            modelInputStatus: 'ready',
            modelInputBytes: bytes,
            modelInputContentType: input.record.contentType,
            modelInputSha256: input.record.sha256,
            modelInputSize: input.record.size,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, assetId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.status, 'ready'),
              eq(agentAssets.contentType, input.record.contentType),
              isNull(agentAssets.modelInputStatus),
              isNull(agentAssets.modelInputBytes),
            ),
          )
          .returning({ id: agentAssets.id })
        if (persisted) return true
        const [existing] = await tx
          .select({
            status: agentAssets.modelInputStatus,
            bytes: agentAssets.modelInputBytes,
            contentType: agentAssets.modelInputContentType,
            sha256: agentAssets.modelInputSha256,
            size: agentAssets.modelInputSize,
          })
          .from(agentAssets)
          .where(
            and(eq(agentAssets.id, assetId), eq(agentAssets.actorId, actorId), eq(agentAssets.projectId, projectId)),
          )
          .limit(1)
        return Boolean(
          existing?.status === 'ready' &&
            existing.contentType === input.record.contentType &&
            existing.sha256 === input.record.sha256 &&
            existing.size === input.record.size &&
            existing.bytes?.equals(bytes),
        )
      })
    },
    async listAgentAssets(actorId, projectId, conversationId) {
      return withActor(actorId, async tx => {
        const rows = await tx
          .select(agentAssetPublicSelection)
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
              conversationId
                ? or(eq(agentAssets.conversationId, conversationId), isNull(agentAssets.conversationId))
                : isNull(agentAssets.conversationId),
            ),
          )
          .orderBy(desc(agentAssets.createdAt))
        return rows as import('../types.js').AgentAssetRecord[]
      })
    },
    async getAgentAssetDownloadUrl(actorId, accessToken, projectId, id) {
      const asset = await withActor(actorId, async tx => {
        const [row] = await tx
          .select()
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
            ),
          )
          .limit(1)
        return row ?? null
      })
      if (!asset) return null
      const { data, error } = await agentAssetStorage(accessToken).createSignedUrl(asset.storagePath, 60)
      if (error || !data) return null
      return data.signedUrl
    },
    async deleteAgentAsset(actorId, accessToken, projectId, id) {
      const cleanup = await withActor(actorId, async tx => {
        const [row] = await tx
          .select({
            id: agentAssets.id,
            status: agentAssets.status,
            storagePath: agentAssets.storagePath,
            storageCleanupStatus: agentAssets.storageCleanupStatus,
          })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              canEditAgentAssetProject(actorId),
            ),
          )
          .for('update')
          .limit(1)
        if (!row) return null
        if (row.status === 'deleted') {
          return {
            storagePath: row.storagePath,
            pending: row.storageCleanupStatus !== 'completed',
          }
        }
        const [deleted] = await tx
          .update(agentAssets)
          .set({
            status: 'deleted',
            modelInputStatus: null,
            modelInputBytes: null,
            modelInputContentType: null,
            modelInputSha256: null,
            modelInputSize: null,
            storageCleanupStatus: 'pending',
            storageCleanupAttempts: 0,
            storageCleanupLastError: null,
            storageCleanupCompletedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              ne(agentAssets.status, 'deleted'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .returning({ storagePath: agentAssets.storagePath })
        return deleted ? { storagePath: deleted.storagePath, pending: true } : null
      })
      if (!cleanup) return false
      if (!cleanup.pending) return true
      const { error } = await agentAssetStorage(accessToken).remove([cleanup.storagePath])
      if (error) {
        await withActor(actorId, tx =>
          tx
            .update(agentAssets)
            .set({
              storageCleanupAttempts: sql`${agentAssets.storageCleanupAttempts} + 1`,
              storageCleanupLastError: (error.message || 'Unable to delete agent asset').slice(0, 1000),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(agentAssets.id, id),
                eq(agentAssets.projectId, projectId),
                eq(agentAssets.actorId, actorId),
                eq(agentAssets.status, 'deleted'),
                eq(agentAssets.storageCleanupStatus, 'pending'),
                canEditAgentAssetProject(actorId),
              ),
            ),
        ).catch(() => undefined)
        throw new Error(error.message || 'Unable to delete agent asset')
      }
      const completed = await withActor(actorId, async tx => {
        const [updated] = await tx
          .update(agentAssets)
          .set({
            storageCleanupStatus: 'completed',
            storageCleanupAttempts: sql`${agentAssets.storageCleanupAttempts} + 1`,
            storageCleanupLastError: null,
            storageCleanupCompletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'deleted'),
              eq(agentAssets.storageCleanupStatus, 'pending'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .returning({ id: agentAssets.id })
        if (updated) return true
        const [replayed] = await tx
          .select({ id: agentAssets.id })
          .from(agentAssets)
          .where(
            and(
              eq(agentAssets.id, id),
              eq(agentAssets.projectId, projectId),
              eq(agentAssets.actorId, actorId),
              eq(agentAssets.status, 'deleted'),
              eq(agentAssets.storageCleanupStatus, 'completed'),
              canEditAgentAssetProject(actorId),
            ),
          )
          .limit(1)
        return Boolean(replayed)
      })
      if (!completed) throw new Error('Unable to finalize agent asset deletion')
      return true
    },
    async reserveAgentRunCost(actorId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        await tx.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(
            ${`agent-budget:${input.billingScope}:${input.payerId}:`} ||
            to_char(now() at time zone 'UTC', 'YYYY-MM'),
            0
          ))
        `)
        await tx.execute(sql`
          update app.agent_run_costs as cost
          set state = 'settled',
              accuracy = 'billing_indeterminate',
              settled_micros = cost.reserved_micros,
              minimum_micros = 0,
              maximum_micros = cost.reserved_micros,
              updated_at = ${input.now}
          where cost.actor_id = ${actorId}
            and cost.project_id = ${input.projectId}
            and cost.state = 'reserved'
            and cost.reservation_expires_at <= ${input.now}
            and exists (
              select 1
              from app.agent_run_dispatches as dispatch
              join app.agent_provider_attempts as attempt on attempt.dispatch_id = dispatch.id
              where dispatch.actor_id = cost.actor_id
                and dispatch.project_id = cost.project_id
                and dispatch.turn_id = cost.turn_id
                and attempt.attempt_no = (
                  select max(latest.attempt_no)
                  from app.agent_provider_attempts as latest
                  where latest.dispatch_id = dispatch.id
                )
                and attempt.state in ('started', 'outcome_unknown')
            )
        `)
        await tx
          .update(agentRunCosts)
          .set({
            state: 'released',
            accuracy: null,
            settledMicros: 0,
            minimumMicros: null,
            maximumMicros: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.state, 'reserved'),
              lte(agentRunCosts.reservationExpiresAt, input.now),
            ),
          )
        const [existing] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .limit(1)
        if (existing && (existing.taskId !== input.taskId || existing.inputDigest !== input.inputDigest)) {
          return 'conflict'
        }
        if (existing && existing.state !== 'released') return existing as import('../types.js').AgentRunCostRecord
        if (input.estimatedMicros > input.taskLimitMicros) return 'task_budget_exceeded'
        const [usage] = await tx
          .select({
            taskMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.actorId} = ${actorId}
                and ${agentRunCosts.projectId} = ${input.projectId}
                and ${agentRunCosts.taskId} = ${input.taskId}
                then case
                  when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
                  when ${agentRunCosts.accuracy} = 'billing_indeterminate' then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
                  else ${agentRunCosts.settledMicros}
                end
              else 0
            end), 0)`,
            projectMonthMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.billingScope} = ${input.billingScope}
                and ${agentRunCosts.payerId} = ${input.payerId}
                and (${input.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                and ${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
                then case
              when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
              when ${agentRunCosts.accuracy} = 'billing_indeterminate' then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
              else ${agentRunCosts.settledMicros}
                end
              else 0
            end), 0)`,
          })
          .from(agentRunCosts)
          .where(
            and(
              ne(agentRunCosts.state, 'released'),
              or(
                and(eq(agentRunCosts.actorId, actorId), eq(agentRunCosts.taskId, input.taskId)),
                and(
                  eq(agentRunCosts.billingScope, input.billingScope),
                  eq(agentRunCosts.payerId, input.payerId),
                  input.billingScope === 'project' ? eq(agentRunCosts.projectId, input.projectId) : undefined,
                  sql`${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`,
                ),
              ),
            ),
          )
        if (Number(usage?.taskMicros ?? 0) + input.estimatedMicros > input.taskLimitMicros) {
          return 'task_budget_exceeded'
        }
        if (Number(usage?.projectMonthMicros ?? 0) + input.estimatedMicros > input.projectMonthLimitMicros) {
          return 'project_budget_exceeded'
        }
        if (existing) {
          const [reactivated] = await tx
            .update(agentRunCosts)
            .set({
              state: 'reserved',
              reservedMicros: input.estimatedMicros,
              settledMicros: 0,
              minimumMicros: null,
              maximumMicros: null,
              operationId: input.operationId,
              provider: input.provider,
              model: input.model,
              profile: input.profile,
              promptTokens: null,
              completionTokens: null,
              traceId: input.traceId,
              decisionOutput: null,
              decisionUsage: null,
              decisionTrace: null,
              billingScope: input.billingScope,
              payerId: input.payerId,
              reservationExpiresAt: input.reservationExpiresAt,
              updatedAt: input.now,
            })
            .where(eq(agentRunCosts.id, existing.id))
            .returning()
          if (!reactivated) throw new Error('Agent cost reservation reactivation returned no row')
          return reactivated as import('../types.js').AgentRunCostRecord
        }
        const [row] = await tx
          .insert(agentRunCosts)
          .values({
            actorId,
            projectId: input.projectId,
            taskId: input.taskId,
            turnId: input.turnId,
            inputDigest: input.inputDigest,
            reservedMicros: input.estimatedMicros,
            operationId: input.operationId,
            provider: input.provider,
            model: input.model,
            profile: input.profile,
            traceId: input.traceId,
            billingScope: input.billingScope,
            payerId: input.payerId,
            reservationExpiresAt: input.reservationExpiresAt,
            state: 'reserved',
          })
          .returning()
        return row as import('../types.js').AgentRunCostRecord
      })
    },
    async settleAgentRunCost(actorId, input) {
      return withActor(actorId, async tx => {
        const [settled] = await tx
          .update(agentRunCosts)
          .set({
            state: 'settled',
            accuracy: input.indeterminate ? 'billing_indeterminate' : 'estimated',
            settledMicros: input.settledMicros,
            minimumMicros: input.minimumMicros,
            maximumMicros: input.maximumMicros,
            promptTokens: input.promptTokens,
            completionTokens: input.completionTokens,
            decisionOutput: input.decisionOutput ?? null,
            decisionUsage: input.decisionUsage ?? null,
            decisionTrace: input.decisionTrace ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.taskId, input.taskId),
              eq(agentRunCosts.turnId, input.turnId),
              eq(agentRunCosts.state, 'reserved'),
            ),
          )
          .returning()
        if (settled) return settled as AgentRunCostRecord
        const [existing] = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, input.projectId),
              eq(agentRunCosts.taskId, input.taskId),
              eq(agentRunCosts.turnId, input.turnId),
            ),
          )
          .limit(1)
        return (existing as AgentRunCostRecord | undefined) ?? null
      })
    },
    async releaseAgentRunCost(actorId, projectId, taskId) {
      return withActor(actorId, async tx => {
        await tx
          .update(agentRunCosts)
          .set({ state: 'released', accuracy: null, updatedAt: new Date() })
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
              eq(agentRunCosts.state, 'reserved'),
            ),
          )
        const costs = await tx
          .select()
          .from(agentRunCosts)
          .where(
            and(
              eq(agentRunCosts.actorId, actorId),
              eq(agentRunCosts.projectId, projectId),
              eq(agentRunCosts.taskId, taskId),
            ),
          )
          .orderBy(desc(agentRunCosts.createdAt), desc(agentRunCosts.id))
        return aggregateAgentRunCostRows(costs as AgentRunCostRecord[])
      })
    },
    async getAgentBudgetUsage(actorId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, input.projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const chargedMicros = sql<number>`case
          when ${agentRunCosts.state} = 'reserved' then ${agentRunCosts.reservedMicros}
          when ${agentRunCosts.accuracy} = 'billing_indeterminate' then coalesce(${agentRunCosts.maximumMicros}, ${agentRunCosts.settledMicros})
          else ${agentRunCosts.settledMicros}
        end`
        const [usage] = await tx
          .select({
            taskMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.actorId} = ${actorId}
                and ${agentRunCosts.projectId} = ${input.projectId}
                and ${agentRunCosts.taskId} = ${input.taskId}
                then ${chargedMicros}
              else 0
            end), 0)`,
            projectMonthMicros: sql<number>`coalesce(sum(case
              when ${agentRunCosts.billingScope} = ${input.billingScope}
                and ${agentRunCosts.payerId} = ${input.payerId}
                and (${input.billingScope} = 'user' or ${agentRunCosts.projectId} = ${input.projectId})
                and ${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
                then ${chargedMicros}
              else 0
            end), 0)`,
          })
          .from(agentRunCosts)
          .where(
            and(
              ne(agentRunCosts.state, 'released'),
              or(
                and(eq(agentRunCosts.actorId, actorId), eq(agentRunCosts.taskId, input.taskId)),
                and(
                  eq(agentRunCosts.billingScope, input.billingScope),
                  eq(agentRunCosts.payerId, input.payerId),
                  input.billingScope === 'project' ? eq(agentRunCosts.projectId, input.projectId) : undefined,
                  sql`${agentRunCosts.createdAt} >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`,
                ),
              ),
            ),
          )
        return {
          taskMicros: Number(usage?.taskMicros ?? 0),
          projectMonthMicros: Number(usage?.projectMonthMicros ?? 0),
        }
      })
    },
    async listTemplates() {
      return db.select().from(templates).where(eq(templates.isOfficial, true)).orderBy(asc(templates.name))
    },
    getSettings(actorId) {
      return withActor(actorId, async tx => {
        const [row] = await tx.select().from(userSettings).where(eq(userSettings.userId, actorId)).limit(1)
        return row?.settings ?? {}
      })
    },
    updateSettings(actorId, settings) {
      return withActor(actorId, async tx => {
        await lockUserSettings(tx, actorId)
        const [current] = await tx
          .select({ settings: userSettings.settings })
          .from(userSettings)
          .where(eq(userSettings.userId, actorId))
          .for('update')
          .limit(1)
        const { agentPreferenceMemory: _reservedPreferenceMemory, ...patch } = settings
        const nextSettings = { ...(current?.settings ?? {}), ...patch }
        const [row] = await tx
          .insert(userSettings)
          .values({ userId: actorId, settings: nextSettings })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { settings: nextSettings, updatedAt: new Date() },
          })
          .returning()
        return row?.settings ?? nextSettings
      })
    },
    getAgentUserPreferenceMemory(actorId) {
      return withActor(actorId, async tx => {
        const [row] = await tx
          .select({ settings: userSettings.settings })
          .from(userSettings)
          .where(eq(userSettings.userId, actorId))
          .limit(1)
        return readAgentUserPreferenceMemory(row?.settings ?? {})
      })
    },
    compareAndSetAgentUserPreferenceMemory(actorId, expectedRevision, memory) {
      return withActor(actorId, async tx => {
        await lockUserSettings(tx, actorId)
        const [row] = await tx
          .select({ settings: userSettings.settings })
          .from(userSettings)
          .where(eq(userSettings.userId, actorId))
          .limit(1)
        const settings = row?.settings ?? {}
        if (readAgentUserPreferenceMemory(settings).revision !== expectedRevision) return false
        const nextSettings = { ...settings, agentPreferenceMemory: memory }
        await tx
          .insert(userSettings)
          .values({ userId: actorId, settings: nextSettings })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { settings: nextSettings, updatedAt: new Date() },
          })
        return true
      })
    },
    compareAndSetAgentUserModelConfig(actorId, expected, config) {
      return withActor(actorId, async tx => {
        await lockUserSettings(tx, actorId)
        const [updated] = await tx
          .update(userSettings)
          .set({
            settings: sql`jsonb_set(${userSettings.settings}, '{agentModelConfiguration,user}', ${JSON.stringify(config)}::jsonb, false)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(userSettings.userId, actorId),
              sql`${userSettings.settings} -> 'agentModelConfiguration' -> 'user' = ${JSON.stringify(expected)}::jsonb`,
            ),
          )
          .returning({ userId: userSettings.userId })
        return Boolean(updated)
      })
    },
    getAgentWorkspace(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [row] = await tx
          .select({
            ownerId: agentWorkspaces.ownerId,
            projectId: agentWorkspaces.projectId,
            revision: agentWorkspaces.revision,
            payload: agentWorkspaces.payload,
            createdAt: agentWorkspaces.createdAt,
            updatedAt: agentWorkspaces.updatedAt,
          })
          .from(agentWorkspaces)
          .innerJoin(projects, eq(projects.id, agentWorkspaces.projectId))
          .where(
            and(
              eq(agentWorkspaces.ownerId, actorId),
              eq(agentWorkspaces.projectId, projectId),
              canReadProject(actorId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        if (!row) return null
        return row as AgentWorkspaceRecord
      })
    },
    upsertAgentWorkspace(actorId, projectId, payload, expectedRevision) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const [existing] = await tx
          .select({ id: agentWorkspaces.id, revision: agentWorkspaces.revision })
          .from(agentWorkspaces)
          .where(and(eq(agentWorkspaces.ownerId, actorId), eq(agentWorkspaces.projectId, projectId)))
          .limit(1)
        if (existing) {
          if (expectedRevision === undefined || existing.revision !== expectedRevision) return 'conflict'
          const [updated] = await tx
            .update(agentWorkspaces)
            .set({ payload, revision: expectedRevision + 1, updatedAt: new Date() })
            .where(and(eq(agentWorkspaces.id, existing.id), eq(agentWorkspaces.revision, expectedRevision)))
            .returning()
          return updated ? (updated as AgentWorkspaceRecord) : ('conflict' as const)
        }
        if (expectedRevision !== undefined) return 'conflict'
        const [created] = await tx
          .insert(agentWorkspaces)
          .values({ ownerId: actorId, projectId, payload })
          .onConflictDoNothing({ target: [agentWorkspaces.ownerId, agentWorkspaces.projectId] })
          .returning()
        return created ? (created as AgentWorkspaceRecord) : ('conflict' as const)
      })
    },
    listAgentProjectContexts(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!project) return null
        const rows = await tx
          .select()
          .from(agentProjectContexts)
          .where(and(eq(agentProjectContexts.projectId, projectId), isNull(agentProjectContexts.deletedAt)))
          .orderBy(asc(agentProjectContexts.createdAt))
        return rows.map(toAgentProjectContextRecord)
      })
    },
    upsertAgentProjectContext(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const now = new Date()
        if (!input.id) {
          if (input.expectedRevision !== undefined) return 'conflict'
          const [created] = await tx
            .insert(agentProjectContexts)
            .values({
              projectId,
              title: input.title,
              content: input.content,
              sourceTaskId: input.sourceTaskId,
              provenance: input.provenance,
              createdBy: actorId,
              confirmedAt: now,
              updatedAt: now,
            })
            .returning()
          if (!created) throw new Error('Agent project context insert returned no row')
          return toAgentProjectContextRecord(created)
        }
        const [current] = await tx
          .select()
          .from(agentProjectContexts)
          .where(
            and(
              eq(agentProjectContexts.id, input.id),
              eq(agentProjectContexts.projectId, projectId),
              isNull(agentProjectContexts.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return null
        if (input.expectedRevision === undefined || current.revision !== input.expectedRevision) return 'conflict'
        const [updated] = await tx
          .update(agentProjectContexts)
          .set({
            title: input.title,
            content: input.content,
            revision: current.revision + 1,
            history: [
              ...current.history,
              {
                revision: current.revision,
                title: current.title,
                content: current.content,
                status: 'confirmed' as const,
                ...(current.sourceTaskId ? { sourceTaskId: current.sourceTaskId } : {}),
                ...(current.provenance ? { provenance: current.provenance } : {}),
                createdAt: current.updatedAt.toISOString(),
              },
            ],
            sourceTaskId: input.sourceTaskId ?? current.sourceTaskId,
            provenance: input.provenance ?? current.provenance,
            confirmedAt: now,
            updatedAt: now,
          })
          .where(and(eq(agentProjectContexts.id, current.id), eq(agentProjectContexts.revision, current.revision)))
          .returning()
        return updated ? toAgentProjectContextRecord(updated) : ('conflict' as const)
      })
    },
    rollbackAgentProjectContext(actorId, projectId, id, expectedRevision, targetRevision) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const [current] = await tx
          .select()
          .from(agentProjectContexts)
          .where(
            and(
              eq(agentProjectContexts.id, id),
              eq(agentProjectContexts.projectId, projectId),
              isNull(agentProjectContexts.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return null
        if (current.revision !== expectedRevision) return 'conflict'
        const target = current.history.find(item => item.revision === targetRevision)
        if (!target) return null
        const now = new Date()
        const [updated] = await tx
          .update(agentProjectContexts)
          .set({
            title: target.title,
            content: target.content,
            revision: current.revision + 1,
            history: [
              ...current.history,
              {
                revision: current.revision,
                title: current.title,
                content: current.content,
                status: 'confirmed' as const,
                ...(current.sourceTaskId ? { sourceTaskId: current.sourceTaskId } : {}),
                ...(current.provenance ? { provenance: current.provenance } : {}),
                createdAt: current.updatedAt.toISOString(),
              },
            ],
            sourceTaskId: target.sourceTaskId ?? null,
            provenance: target.provenance ?? null,
            confirmedAt: now,
            updatedAt: now,
          })
          .where(and(eq(agentProjectContexts.id, id), eq(agentProjectContexts.revision, expectedRevision)))
          .returning()
        return updated ? toAgentProjectContextRecord(updated) : ('conflict' as const)
      })
    },
    deleteAgentProjectContext(actorId, projectId, id, expectedRevision) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        const [current] = await tx
          .select({ revision: agentProjectContexts.revision })
          .from(agentProjectContexts)
          .where(
            and(
              eq(agentProjectContexts.id, id),
              eq(agentProjectContexts.projectId, projectId),
              isNull(agentProjectContexts.deletedAt),
            ),
          )
          .for('update')
          .limit(1)
        if (!current) return null
        if (current.revision !== expectedRevision) return 'conflict'
        const [deleted] = await tx
          .update(agentProjectContexts)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(agentProjectContexts.id, id), eq(agentProjectContexts.revision, expectedRevision)))
          .returning({ id: agentProjectContexts.id })
        return deleted ? true : ('conflict' as const)
      })
    },
  }
}
