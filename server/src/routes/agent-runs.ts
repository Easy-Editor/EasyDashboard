import { randomUUID } from 'node:crypto'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import {
  type AgentUserPreference,
  agentUserPreferenceTextLength,
  agentUserPreferencesForModel,
} from '../agent/agent-user-preferences.js'
import { decodeAssetModelInput } from '../agent/asset-model-input.js'
import {
  InvalidDashboardDocumentError,
  resolveDashboardActiveDocumentId,
  resolveDashboardActiveRootNodeId,
} from '../agent/canonical-dashboard-document.js'
import {
  type AgentChangeSetModelResult,
  AgentChangeSetProviderError,
  AgentChangeSetProviderResponseError,
  agentAllowedOperationTypesForProviderInput,
  agentAllowedOperationTypesForRequest,
  agentRequiresRemoveForProviderInput,
  agentRequiresRemoveForRequest,
  agentRunInputDigest,
  createAgentClarificationHistoryProviderInputSnapshot,
  createAgentProviderInputSnapshot,
  createAgentResponseProviderInputSnapshot,
  estimateAgentProviderInputTokens,
  requestAgentChangeSet,
} from '../agent/change-set-model.js'
import { agentChangeSetModelOutputSchema, planStrictChangeSet } from '../agent/change-set-planner.js'
import { derivePublicCost } from '../agent/cost-accuracy.js'
import {
  type AgentTaskPlanningDecision,
  AgentTaskPlanningProviderError,
  AgentTaskPlanningProviderResponseError,
  agentTaskPlanningDecisionSchema,
  requestAgentTaskPlanningDecision,
} from '../agent/task-planning-model.js'
import { parseAgentProjectWorkspacePayload } from '../agent/workspace-contract.js'
import { canonicalJsonSha256 } from '../db/agent-stage-commit.js'
import type { AppEnv } from '../env.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentExecutorRunner } from '../services/agent-executor-runner.js'
import type { AgentRunDispatchControl, AgentRunDispatcher } from '../services/agent-run-dispatcher.js'
import type { AgentTaskTransitionClaim } from '../services/agent-task-orchestrator.js'
import { AgentTaskPlanningFailure, type AgentTaskPlanningResult } from '../services/agent-task-orchestrator.js'
import type {
  AgentAssetRecord,
  AgentProviderInputSnapshot,
  AgentRunCostRecord,
  AgentRunDispatchRecord,
  AgentSpikeOperationRecord,
  AgentTaskEventRecord,
  AgentTaskEventTechnicalDetails,
  AgentTaskPublicEventRecord,
  AgentTaskRunDetailRecord,
  DurableAgentTurnRecord as DurableAgentTurnRecordType,
  DurableProviderAttemptRecord,
  Repository,
} from '../types.js'
import {
  type AgentConfigRouteOptions,
  type ResolvedAgentModelRuntime,
  resolveAgentModelRuntime,
} from './agent-config.js'
import { type AgentSpikeRouteOptions, issueAgentSpikeOperation, operationOutcome } from './agent-spike.js'

const agentSelectionContextSchema = z
  .object({
    pageId: z.string().trim().min(1).max(160).optional(),
    pageLabel: z.string().trim().min(1).max(160).optional(),
    selectedRefs: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(160),
            title: z.string().trim().min(1).max(160).optional(),
            componentName: z.string().trim().min(1).max(120).optional(),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    viewport: z
      .object({
        width: z.number().positive().max(32_768),
        height: z.number().positive().max(32_768),
      })
      .strict()
      .optional(),
  })
  .strict()

const requestSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(160),
    taskId: z.string().trim().min(1).max(160),
    turnId: z.string().trim().min(1).max(160).optional(),
    prompt: z.string().trim().min(1).max(4_000),
    attachmentIds: z.array(z.uuid()).max(12).default([]),
    selectionContext: agentSelectionContextSchema.optional(),
    projectContext: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(160),
            content: z.string().trim().min(1).max(2_000),
            status: z.literal('confirmed'),
          })
          .strict(),
      )
      .max(24)
      .default([]),
  })
  .strict()

const respondSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(160),
    questionId: z.string().trim().min(1).max(160),
    turnId: z.string().trim().min(1).max(160),
    response: z.string().trim().min(1).max(4_000),
    attachmentIds: z.array(z.uuid()).max(12).default([]),
    selectionContext: agentSelectionContextSchema.optional(),
  })
  .strict()

const taskRunRequestSchema = requestSchema.extend({
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
})

const taskRunContinueSchema = z
  .object({
    questionId: z.string().trim().min(1).max(160),
    response: z.string().trim().min(1).max(4_000),
    attachmentIds: z.array(z.uuid()).max(12).default([]),
    idempotencyKey: z.string().trim().min(1).max(160).optional(),
  })
  .strict()

const taskRunEventsQuerySchema = z
  .object({
    afterSeq: z.coerce.number().int().nonnegative().default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()

const checkpointUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cachedTokens: z.number().int().nonnegative().optional(),
  })
  .strict()

const providerAttemptEvidenceSchema = z
  .object({
    providerRequestKey: z.string().trim().min(1).max(160).optional(),
    requestBodyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    idempotencyMode: z.enum(['unsupported', 'stable']),
    idempotencyHeaderSent: z.boolean(),
    upstreamRequestId: z.string().trim().min(1).max(200).optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict()

const checkpointTraceSchema = z
  .object({
    promptBundleId: z.string().trim().min(1).max(160),
    promptBundleVersion: z.string().trim().min(1).max(160),
    promptBundleHash: z.string().trim().min(1).max(200),
    skills: z.array(z.string().trim().min(1).max(200)).max(64),
  })
  .strict()

const decisionCheckpointSchema = z
  .object({
    version: z.literal(1),
    baseDraftVersion: z.number().int().nonnegative(),
    output: agentChangeSetModelOutputSchema,
  })
  .strict()

export const AGENT_RUN_RESERVATION_TTL_MS = 10 * 60 * 1_000
const AGENT_PROVIDER_RESPONSE_FAILURE_MESSAGE = '我没能安全地完成这次修改，请换一种说法，或选中要修改的内容后再试。'

export interface AgentRunRouteOptions {
  repository: Repository
  env: AppEnv
  /** Deprecated compatibility input. Execution is dispatcher-only. */
  runner?: AgentExecutorRunner | null
  dispatcher?: AgentRunDispatcher | null
  spike: AgentSpikeRouteOptions
  model?: typeof requestAgentChangeSet
  modelConfig?: Pick<AgentConfigRouteOptions, 'resolveHost' | 'now'>
  planningAttempt?: { dispatchId: string; workerId: string; leaseGeneration: number }
  wakeTaskOrchestrator?: () => void
  taskOrchestratorLogger?: Pick<Console, 'warn'>
}

export function agentRunRequiresRemove(input: {
  providerInputSnapshot?: AgentProviderInputSnapshot
  prompt: string
}): boolean {
  return input.providerInputSnapshot
    ? agentRequiresRemoveForProviderInput(input.providerInputSnapshot)
    : agentRequiresRemoveForRequest(input.prompt)
}

export type AgentDispatchAttempt = { dispatchId: string; workerId: string; leaseGeneration: number }

export function publicAgentProviderResponseFailure(error: AgentChangeSetProviderResponseError): ApiError {
  return new ApiError(error.status, 'AGENT_PROVIDER_RESPONSE_FAILED', AGENT_PROVIDER_RESPONSE_FAILURE_MESSAGE)
}

export type DurableAgentTurnRecord = DurableAgentTurnRecordType

/** Structural persistence boundary implemented by the database repository. */
type DurableTurnMethod =
  | 'enqueueAgentTurn'
  | 'getAgentTurnByDispatch'
  | 'prepareAgentProviderAttempt'
  | 'markAgentProviderAttemptStarted'
  | 'completeAgentProviderAttempt'
  | 'getAgentAssetModelInput'
  | 'respondToAgentTask'

export type DurableTurnRepository = Omit<Repository, DurableTurnMethod> & Required<Pick<Repository, DurableTurnMethod>>

function durableRepository(repository: Repository): DurableTurnRepository | null {
  const candidate = repository as Partial<DurableTurnRepository>
  return typeof candidate.enqueueAgentTurn === 'function' &&
    typeof candidate.getAgentTurnByDispatch === 'function' &&
    typeof candidate.prepareAgentProviderAttempt === 'function' &&
    typeof candidate.markAgentProviderAttemptStarted === 'function' &&
    typeof candidate.completeAgentProviderAttempt === 'function'
    ? (candidate as DurableTurnRepository)
    : null
}

type SemanticTaskRunRepository = Repository &
  Required<
    Pick<Repository, 'createAgentTaskRun' | 'getAgentTaskRunDetail' | 'listAgentTaskEventPage' | 'continueAgentTaskRun'>
  >

function semanticTaskRunRepository(repository: Repository): SemanticTaskRunRepository | null {
  const candidate = repository as Partial<SemanticTaskRunRepository>
  return typeof candidate.createAgentTaskRun === 'function' &&
    typeof candidate.getAgentTaskRunDetail === 'function' &&
    typeof candidate.listAgentTaskEventPage === 'function' &&
    typeof candidate.continueAgentTaskRun === 'function'
    ? (candidate as SemanticTaskRunRepository)
    : null
}

function publicTaskRunDetail(detail: AgentTaskRunDetailRecord) {
  const { run, activePlan, waitingReason, latestEventSequence } = detail
  const question = waitingReason?.publicPayload.question
  return {
    id: run.id,
    projectId: run.projectId,
    conversationId: run.conversationId,
    taskId: run.taskId,
    status: run.status,
    activePlanVersion: run.activePlanVersion,
    currentTransitionKey: run.currentTransitionKey,
    modelBinding: {
      id: run.modelBindingId,
      provider: run.provider,
      model: run.model,
      profileId: run.profileId,
      configDigest: run.configDigest,
    },
    bounds: run.bounds,
    accounting: {
      providerTurns: run.providerTurns,
      executorRetries: run.executorRetries,
      semanticRevisions: run.semanticRevisions,
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      costMicros: run.costMicros,
    },
    taskStartDocumentRevision: run.taskStartDocumentRevision,
    plan: activePlan?.plan ?? null,
    steps: activePlan?.steps ?? [],
    waiting:
      question && typeof question === 'object' && !Array.isArray(question)
        ? { summary: waitingReason.summary, question }
        : null,
    latestEventSequence,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
  }
}

const safeTechnicalIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const sensitiveTechnicalIdentifier =
  /(?:authorization|bearer|cookie|credential|password|secret|token|api[-_]?key)|(?:^sk-(?:proj-)?)|(?:^[\w-]+\.[\w-]+\.[\w-]+$)/iu

function allowlistedTechnicalIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return safeTechnicalIdentifier.test(normalized) && !sensitiveTechnicalIdentifier.test(normalized)
    ? normalized
    : undefined
}

function publicTaskEventTechnicalDetails(event: AgentTaskEventRecord): AgentTaskEventTechnicalDetails | undefined {
  const technical = event.technicalPayload
  const errorCode = allowlistedTechnicalIdentifier(technical.errorCode ?? event.publicPayload.code)
  const operationId = allowlistedTechnicalIdentifier(technical.operationId)
  const receiptId = allowlistedTechnicalIdentifier(technical.receiptId ?? technical.receipt)
  const rawCost =
    technical.cost && typeof technical.cost === 'object' && !Array.isArray(technical.cost)
      ? (technical.cost as Record<string, unknown>)
      : technical
  const amountMicros = rawCost.amountMicros ?? rawCost.costMicros
  const accuracy = rawCost.accuracy
  const cost: AgentTaskEventTechnicalDetails['cost'] =
    typeof amountMicros === 'number' && Number.isSafeInteger(amountMicros) && amountMicros >= 0
      ? {
          amountMicros,
          ...(accuracy === 'actual' || accuracy === 'estimated' || accuracy === 'billing_indeterminate'
            ? { accuracy }
            : {}),
        }
      : undefined
  const details = {
    ...(errorCode ? { errorCode } : {}),
    ...(operationId ? { operationId } : {}),
    ...(receiptId ? { receiptId } : {}),
    ...(cost ? { cost } : {}),
  }
  return Object.keys(details).length ? details : undefined
}

function publicTaskEvent(event: AgentTaskEventRecord): AgentTaskPublicEventRecord {
  const technicalDetails = publicTaskEventTechnicalDetails(event)
  return {
    taskRunId: event.taskRunId,
    seq: event.seq,
    eventKey: event.eventKey,
    stepId: event.stepId,
    type: event.type,
    summary: event.summary,
    publicPayload: event.publicPayload,
    ...(technicalDetails ? { technicalDetails } : {}),
    redactionVersion: event.redactionVersion,
    createdAt: event.createdAt,
  }
}

function agentTaskRuntimeConfigDigest(runtime: ResolvedAgentModelRuntime): string {
  return canonicalJsonSha256({
    provider: runtime.provider,
    model: runtime.model,
    profileId: runtime.profileId,
    endpoint: runtime.endpoint.toString(),
    capabilities: runtime.capabilities,
    budget: runtime.budget,
    billingScope: runtime.billingScope,
    payerId: runtime.payerId,
  })
}

function stablePlanningStepId(transition: AgentTaskTransitionClaim, ordinal: number, title: string): string {
  const hex = canonicalJsonSha256({
    taskRunId: transition.taskRunId,
    transitionKey: transition.transitionKey,
    ordinal,
    title,
  })
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function planningResultFromOutput(
  output: AgentTaskPlanningDecision,
  transition: AgentTaskTransitionClaim,
): AgentTaskPlanningResult {
  if (output.action === 'ask_user') {
    return { action: 'ask_user', summary: output.summary, question: output.question }
  }
  return {
    action: 'execute',
    summary: output.summary,
    assumptions: output.assumptions,
    risks: output.risks,
    verification: output.verification,
    steps: output.steps.map((step, index) => ({
      semanticId: stablePlanningStepId(transition, index + 1, step.semanticKey),
      ordinal: index + 1,
      title: step.title,
      intent: { purpose: step.semanticKey, description: step.intent },
    })),
  }
}

const persistedPlanningInputSchema = z
  .object({
    purpose: z.literal('planning'),
    prompt: z.string().trim().min(1).max(4_000),
    attachmentIds: z.array(z.uuid()).max(12),
    providerInputSnapshot: z.custom<AgentProviderInputSnapshot>(value =>
      Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    ),
    clarificationHistory: z
      .array(
        z
          .object({
            question: z.object({ id: z.string().min(1), text: z.string().min(1) }).strict(),
            response: z.string().trim().min(1).max(4_000),
            attachmentIds: z.array(z.uuid()).max(12),
            images: z
              .array(z.object({ assetId: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict())
              .max(12),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict()

type TaskPlannerRepository = Repository &
  Required<
    Pick<
      Repository,
      | 'getAgentTaskRun'
      | 'getAgentTaskTransitionProviderResult'
      | 'prepareAgentProviderAttempt'
      | 'markAgentProviderAttemptStarted'
      | 'completeAgentProviderAttempt'
    >
  >

function taskPlannerRepository(repository: Repository): TaskPlannerRepository | null {
  const candidate = repository as Partial<TaskPlannerRepository>
  return typeof candidate.getAgentTaskRun === 'function' &&
    typeof candidate.getAgentTaskTransitionProviderResult === 'function' &&
    typeof candidate.prepareAgentProviderAttempt === 'function' &&
    typeof candidate.markAgentProviderAttemptStarted === 'function' &&
    typeof candidate.completeAgentProviderAttempt === 'function'
    ? (candidate as TaskPlannerRepository)
    : null
}

/**
 * Real planner adapter for the durable task loop. Provider I/O is fenced by
 * the claimed transition and is accounted without an operation id.
 */
export function createAgentTaskPlanningProvider(options: {
  repository: Repository
  env: AppEnv
  workerId: string
  model?: typeof requestAgentTaskPlanningDecision
  modelConfig?: Pick<AgentConfigRouteOptions, 'resolveHost' | 'now'>
}): (transition: AgentTaskTransitionClaim) => Promise<AgentTaskPlanningResult> {
  const repository = taskPlannerRepository(options.repository)
  if (!repository) throw new Error('Agent task planner persistence is unavailable')
  const model = options.model ?? requestAgentTaskPlanningDecision

  return async transition => {
    if (!transition.leaseToken) throw new Error('Claimed Agent planning transition is missing its lease token')
    const frozen = persistedPlanningInputSchema.parse(transition.input)
    const [run, project] = await Promise.all([
      repository.getAgentTaskRun(transition.actorId, transition.taskRunId),
      repository.getProject(transition.actorId, transition.projectId),
    ])
    if (!run || run.projectId !== transition.projectId) {
      throw new ApiError(404, 'AGENT_TASK_RUN_NOT_FOUND', 'Agent task run not found')
    }
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    if (project.draftVersion !== run.taskStartDocumentRevision) {
      throw new ApiError(409, 'AGENT_TASK_PROJECT_STALE', 'Project changed before planning could complete')
    }
    const checkpoint = await repository.getAgentTaskTransitionProviderResult(
      transition.actorId,
      transition.taskRunId,
      transition.id,
    )
    if (checkpoint) {
      const outputEnvelope = checkpoint.decisionOutput
      const checkpointError =
        outputEnvelope.purpose === 'planning' &&
        outputEnvelope.error &&
        typeof outputEnvelope.error === 'object' &&
        !Array.isArray(outputEnvelope.error)
          ? (outputEnvelope.error as Record<string, unknown>)
          : null
      if (checkpointError?.code === 'provider_response_invalid') {
        throw new AgentTaskPlanningFailure('provider_response_invalid', false)
      }
      const parsedOutput =
        outputEnvelope.purpose === 'planning'
          ? agentTaskPlanningDecisionSchema.safeParse(outputEnvelope.output)
          : { success: false as const }
      if (!parsedOutput.success) {
        throw new AgentTaskPlanningFailure('provider_checkpoint_invalid', false)
      }
      return planningResultFromOutput(parsedOutput.data, transition)
    }
    const runtime = await resolveAgentModelRuntime(
      { repository, env: options.env, ...options.modelConfig },
      transition.actorId,
      transition.projectId,
    )
    if (
      runtime.provider !== run.provider ||
      runtime.model !== run.model ||
      runtime.profileId !== run.profileId ||
      agentTaskRuntimeConfigDigest(runtime) !== run.configDigest
    ) {
      throw new ApiError(409, 'AGENT_MODEL_BINDING_DRIFT', 'Conversation model binding changed after task creation')
    }
    const allAttachmentIds = [
      ...new Set([
        ...frozen.attachmentIds,
        ...frozen.clarificationHistory.flatMap(clarification => clarification.attachmentIds),
      ]),
    ]
    const attachments = await resolveAttachments(
      repository,
      transition.actorId,
      transition.projectId,
      run.conversationId,
      allAttachmentIds,
    )
    const images = await resolveModelImages(
      repository,
      transition.actorId,
      transition.projectId,
      attachments,
      runtime.capabilities.vision,
    )
    const baseSnapshot = frozen.providerInputSnapshot
    const expectedImages = [
      ...new Map(
        [...baseSnapshot.images, ...frozen.clarificationHistory.flatMap(clarification => clarification.images)].map(
          image => [image.assetId, image],
        ),
      ).values(),
    ]
    if (
      expectedImages.length !== images.length ||
      expectedImages.some(
        (image, index) => image.assetId !== images[index]?.assetId || image.sha256 !== images[index]?.sha256,
      )
    ) {
      throw new ApiError(409, 'AGENT_TASK_SNAPSHOT_INVALID', 'Frozen Agent image inputs changed after enqueue')
    }
    const providerInputSnapshot = frozen.clarificationHistory.length
      ? createAgentClarificationHistoryProviderInputSnapshot(
          baseSnapshot,
          frozen.clarificationHistory,
          attachments,
          images.map(image => ({ assetId: image.assetId, sha256: image.sha256 })),
        )
      : baseSnapshot
    const maximumRate = options.env.AGENT_BILLING_MAX_USD_PER_1M_TOKENS ?? 100
    const estimatedMicros = Math.min(
      2_147_483_647,
      Math.ceil(estimateAgentProviderInputTokens(providerInputSnapshot) * maximumRate),
    )
    const fence = {
      kind: 'transition' as const,
      transitionId: transition.id,
      workerId: options.workerId,
      leaseGeneration: transition.leaseGeneration,
      leaseToken: transition.leaseToken,
    }
    const attemptState: { current: DurableProviderAttemptRecord | null } = { current: null }
    try {
      const result = await model({
        runtime,
        images: images.map(image => ({ assetId: image.assetId, url: image.url })),
        providerInputSnapshot,
        resolveHost: options.modelConfig?.resolveHost,
        providerAttemptLifecycle: {
          async prepare(metadata) {
            const prepared = await repository.prepareAgentProviderAttempt(transition.actorId, fence, {
              projectId: transition.projectId,
              taskId: run.taskId,
              turnId: transition.transitionKey,
              providerRequestKey: metadata.providerRequestKey ?? null,
              requestBodyDigest: metadata.requestBodyDigest,
              idempotencyMode: metadata.idempotencyMode,
              reservedMicros: estimatedMicros,
              now: options.modelConfig?.now?.() ?? new Date(),
            })
            if (prepared === 'stale') {
              throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent planning lease is no longer current')
            }
            if (prepared === 'outcome_unknown') {
              throw new ApiError(409, 'AGENT_PROVIDER_BILLING_INDETERMINATE', 'Provider outcome is unknown')
            }
            if (prepared === 'task_budget_exceeded' || prepared === 'project_budget_exceeded') {
              throw new ApiError(429, 'AGENT_TASK_BUDGET_EXCEEDED', 'Agent task budget was exhausted before planning')
            }
            attemptState.current = prepared
            return {
              ...(prepared.providerRequestKey ? { providerRequestKey: prepared.providerRequestKey } : {}),
              requestBodyDigest: prepared.requestBodyDigest,
              idempotencyMode: prepared.idempotencyMode,
            }
          },
          async markStarted() {
            if (!attemptState.current) throw new Error('Provider attempt was not prepared')
            const started = await repository.markAgentProviderAttemptStarted(
              transition.actorId,
              attemptState.current.id,
              fence,
              options.modelConfig?.now?.() ?? new Date(),
            )
            if (!started) throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent planning lease is stale')
            attemptState.current = started
          },
        },
      })
      if (!attemptState.current || !result.providerAttempt) {
        throw new ApiError(503, 'AGENT_PROVIDER_ATTEMPT_UNAVAILABLE', 'Provider attempt result was not persisted')
      }
      const totalTokens =
        result.usage?.totalTokens ??
        ((result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0) || undefined)
      const settled = requireCurrentProviderAttemptCompletion(
        await repository.completeAgentProviderAttempt(transition.actorId, attemptState.current.id, fence, {
          state: 'succeeded',
          providerAttempt: result.providerAttempt,
          decisionOutput: { purpose: 'planning', output: result.output },
          decisionUsage: result.usage ? { ...result.usage } : null,
          decisionTrace: { purpose: 'planning', transitionKey: transition.transitionKey, ...result.trace },
          observedTokens: totalTokens,
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
          cachedTokens: result.usage?.cachedTokens,
          estimatedMicros: Math.min(
            2_147_483_647,
            providerSettlementEstimateMicros(estimatedMicros, totalTokens, maximumRate),
          ),
          now: options.modelConfig?.now?.() ?? new Date(),
        }),
      )
      if (settled.taskOutcomeClassification !== 'within_budget') {
        throw new AgentTaskPlanningFailure('task_budget_exceeded', false, true)
      }
      return planningResultFromOutput(result.output, transition)
    } catch (error) {
      if (error instanceof AgentTaskPlanningProviderResponseError && attemptState.current) {
        if (error.classification === 'transient') {
          const settled = requireCurrentProviderAttemptCompletion(
            await repository.completeAgentProviderAttempt(transition.actorId, attemptState.current.id, fence, {
              state: 'failed_definite',
              providerAttempt: { ...error.providerAttempt, reason: 'provider_response_transient' },
              estimatedMicros,
              now: options.modelConfig?.now?.() ?? new Date(),
            }),
          )
          if (settled.taskOutcomeClassification === 'task_budget_exceeded_paused') {
            throw new AgentTaskPlanningFailure('task_budget_exceeded', false, true)
          }
          throw new AgentTaskPlanningFailure('provider_response_transient', true)
        }
        const settled = requireCurrentProviderAttemptCompletion(
          await repository.completeAgentProviderAttempt(transition.actorId, attemptState.current.id, fence, {
            state: 'succeeded',
            providerAttempt: error.providerAttempt,
            decisionOutput: { purpose: 'planning', error: { code: 'provider_response_invalid' } },
            decisionUsage: null,
            decisionTrace: { purpose: 'planning', transitionKey: transition.transitionKey },
            terminalTransitionFailure: {
              code: 'provider_response_invalid',
              summary: '规划模型返回了无法安全使用的结果，任务已停止。',
              publicPayload: { code: 'provider_response_invalid' },
              technicalPayload: {},
            },
            estimatedMicros,
            now: options.modelConfig?.now?.() ?? new Date(),
          }),
        )
        if (settled.taskOutcomeClassification !== 'transition_failed_terminal') {
          throw new AgentTaskPlanningFailure('provider_failure_persistence_incomplete', false)
        }
        throw new AgentTaskPlanningFailure('provider_response_invalid', false, true)
      }
      if (error instanceof AgentTaskPlanningProviderError && attemptState.current) {
        const settled = requireCurrentProviderAttemptCompletion(
          await repository.completeAgentProviderAttempt(transition.actorId, attemptState.current.id, fence, {
            state: error.providerAttempt.outcome,
            providerAttempt: error.providerAttempt,
            estimatedMicros,
            now: options.modelConfig?.now?.() ?? new Date(),
          }),
        )
        if (settled.taskOutcomeClassification === 'provider_outcome_unknown_paused') {
          throw new AgentTaskPlanningFailure('provider_outcome_unknown', false, true)
        }
        throw new AgentTaskPlanningFailure('provider_failed_definite', true)
      }
      if (error instanceof ApiError) throw new AgentTaskPlanningFailure(error.code, false)
      throw error
    }
  }
}

function durableCost(cost: AgentRunCostRecord | null | undefined) {
  if (!cost || cost.state === 'released') return undefined
  const publicCost =
    cost.state === 'reserved'
      ? derivePublicCost({ lifecycle: 'reserved', reservedMicros: cost.reservedMicros })
      : cost.accuracy === 'billing_indeterminate'
        ? derivePublicCost({
            lifecycle: 'settled',
            outcome: 'unknown',
            reservedMicros: cost.reservedMicros,
            observedTokens: cost.maximumMicros ?? cost.settledMicros,
            microsPerToken: 1,
          })
        : cost.accuracy === 'actual'
          ? derivePublicCost({ lifecycle: 'settled', outcome: 'success', providerAmountMicros: cost.settledMicros })
          : derivePublicCost({
              lifecycle: 'settled',
              outcome: 'success',
              observedTokens: cost.settledMicros,
              microsPerToken: 1,
            })
  if (publicCost.lifecycle === 'released') return undefined
  return {
    amount: publicCost.amountMicros / 1_000_000,
    currency: 'USD',
    accuracy: publicCost.accuracy,
    minimumAmount: publicCost.minimumMicros / 1_000_000,
    maximumAmount: publicCost.maximumMicros / 1_000_000,
  }
}

function durableUsage(cost: AgentRunCostRecord | null | undefined) {
  if (!cost || (cost.promptTokens === null && cost.completionTokens === null)) return undefined
  const promptTokens = cost.promptTokens ?? undefined
  const completionTokens = cost.completionTokens ?? undefined
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...((promptTokens ?? 0) + (completionTokens ?? 0) > 0
      ? { totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0) }
      : {}),
  }
}

export function durablePendingQuestion(cost: AgentRunCostRecord | null | undefined) {
  if (!cost) return undefined
  const checkpoint = restoreModelCheckpoint(cost)
  if (!checkpoint) return undefined
  const result = checkpoint.result
  const output = result.output
  if (output.action !== 'ask_user') return undefined
  const usage = durableUsage(cost) ?? result.usage
  const plan = visiblePlan(output.message, output.plan)
  return {
    turnId: cost.turnId,
    message: output.message,
    question: output.question,
    ...(plan ? { plan } : {}),
    ...(usage ? { usage } : {}),
  }
}

function durableAssistantMessage(cost: AgentRunCostRecord | null | undefined) {
  if (!cost) return undefined
  const checkpoint = restoreModelCheckpoint(cost)
  if (!checkpoint || checkpoint.result.output.action !== 'execute') return undefined
  return checkpoint.result.output.summary
}

function dispatchRunStatus(dispatch: AgentRunDispatchRecord | null | undefined) {
  if (!dispatch) return undefined
  if (dispatch.state === 'paused') return 'paused'
  if (dispatch.state === 'canceled') return 'canceled'
  if (dispatch.state === 'failed') return 'failed_not_applied'
  if (dispatch.state === 'indeterminate') return 'indeterminate'
  if (dispatch.state === 'queued') return dispatch.kind === 'initial' ? 'planning' : 'queued'
  if (dispatch.state === 'running') return 'running'
  return undefined
}

function durableRun(
  operation: AgentSpikeOperationRecord | null,
  cost: AgentRunCostRecord | null,
  dispatch?: AgentRunDispatchRecord | null,
) {
  const outcome = operation ? operationOutcome(operation) : undefined
  const operationId = operation?.operationId ?? dispatch?.operationId ?? cost?.operationId
  if (!operationId) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
  const assistantMessage = durableAssistantMessage(cost)
  const failureMessage = dispatch?.state === 'failed' ? dispatch.errorMessage : null
  return {
    operationId,
    taskId: operation?.taskId ?? dispatch?.taskId ?? cost?.taskId,
    status:
      dispatchRunStatus(dispatch) ??
      operation?.status ??
      (dispatch?.state === 'running' ? 'running' : cost?.state === 'reserved' ? 'planning' : 'indeterminate'),
    ...(assistantMessage ? { message: assistantMessage } : {}),
    ...(failureMessage ? { message: failureMessage } : {}),
    ...(outcome ? { outcome, receipt: outcome.commitReceipt } : {}),
    ...(operation?.skillTrace ? { trace: operation.skillTrace } : {}),
    ...(durableCost(cost) ? { cost: durableCost(cost) } : {}),
    ...(durableUsage(cost) ? { usage: durableUsage(cost) } : {}),
    ...(durablePendingQuestion(cost) ? { pendingQuestion: durablePendingQuestion(cost) } : {}),
    ...(operation?.rollbackRevisionId
      ? {
          rollback: { revisionId: operation.rollbackRevisionId },
          rollbackRevisionId: operation.rollbackRevisionId,
        }
      : {}),
    rolledBackAt: operation?.rolledBackAt ?? null,
    rollbackReceipt: operation?.rollbackReceipt ?? null,
    completedAt: operation?.completedAt ?? null,
    ...(dispatch
      ? {
          control: {
            state: dispatch.state,
            desiredState: dispatch.desiredState,
            waitingReason: dispatch.waitingReason,
            canPause: dispatch.state === 'queued' || dispatch.state === 'running',
            canResume: dispatch.state === 'paused',
            canCancel: dispatch.state === 'queued' || dispatch.state === 'running' || dispatch.state === 'paused',
          },
        }
      : {}),
  }
}

function visiblePlan(summary: string, steps: readonly string[] | undefined) {
  if (!steps?.length) return undefined
  return {
    summary,
    steps: steps.map((title, index) => ({
      id: `plan-${index + 1}`,
      title,
      status: index === 0 ? ('running' as const) : ('pending' as const),
    })),
  }
}

function restoreModelCheckpoint(
  cost: AgentRunCostRecord,
): { result: AgentChangeSetModelResult; baseDraftVersion: number | null } | null {
  const checkpoint = decisionCheckpointSchema.safeParse(cost.decisionOutput)
  const legacyOutput = checkpoint.success ? null : agentChangeSetModelOutputSchema.safeParse(cost.decisionOutput)
  const output = checkpoint.success ? checkpoint.data.output : legacyOutput?.success ? legacyOutput.data : null
  const trace = checkpointTraceSchema.safeParse(cost.decisionTrace)
  const usage = cost.decisionUsage === null ? null : checkpointUsageSchema.safeParse(cost.decisionUsage)
  if (!output || !trace.success || (usage && !usage.success)) return null
  return {
    result: {
      output,
      ...(usage?.success ? { usage: usage.data } : {}),
      trace: trace.data,
    },
    baseDraftVersion: checkpoint.success ? checkpoint.data.baseDraftVersion : null,
  }
}

export function validateModelResult(result: AgentChangeSetModelResult): AgentChangeSetModelResult {
  const output = agentChangeSetModelOutputSchema.safeParse(result.output)
  const trace = checkpointTraceSchema.safeParse(result.trace)
  const usage = result.usage === undefined ? null : checkpointUsageSchema.safeParse(result.usage)
  const providerAttempt =
    result.providerAttempt === undefined ? null : providerAttemptEvidenceSchema.safeParse(result.providerAttempt)
  if (!output.success || !trace.success || (usage && !usage.success) || (providerAttempt && !providerAttempt.success)) {
    throw new ApiError(422, 'AGENT_MODEL_OUTPUT_INVALID', 'Agent model proposed an invalid decision')
  }
  return {
    output: output.data,
    ...(usage?.success ? { usage: usage.data } : {}),
    trace: trace.data,
    ...(providerAttempt?.success ? { providerAttempt: providerAttempt.data } : {}),
  }
}

function waitingUserResponse(
  turnId: string,
  taskId: string,
  result: AgentChangeSetModelResult,
  cost: AgentRunCostRecord,
) {
  if (result.output.action !== 'ask_user') {
    throw new ApiError(409, 'AGENT_TURN_CHECKPOINT_INVALID', 'Agent turn checkpoint is not a clarification')
  }
  return {
    kind: 'waiting_user' as const,
    turnId,
    taskId,
    message: result.output.message,
    question: result.output.question,
    ...(visiblePlan(result.output.message, result.output.plan)
      ? { plan: visiblePlan(result.output.message, result.output.plan) }
      : {}),
    ...(durableUsage(cost) ? { usage: durableUsage(cost) } : result.usage ? { usage: result.usage } : {}),
    ...(durableCost(cost) ? { cost: durableCost(cost) } : {}),
  }
}

function checkpointRecord(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>
}

export function assertFrozenAgentTurnRuntime(
  turn: DurableAgentTurnRecord,
  runtime: ResolvedAgentModelRuntime,
  maximumRateMicrosPerToken?: number,
): void {
  const unchanged =
    turn.provider === runtime.provider &&
    turn.model === runtime.model &&
    turn.profileId === runtime.profileId &&
    turn.endpoint === runtime.endpoint.toString() &&
    turn.billingScope === runtime.billingScope &&
    turn.payerId === runtime.payerId &&
    turn.taskLimitMicros === runtime.budget.taskMicros &&
    turn.projectMonthLimitMicros === runtime.budget.projectMonthMicros &&
    (maximumRateMicrosPerToken === undefined || turn.maximumRateMicrosPerToken === maximumRateMicrosPerToken)
  if (!unchanged) {
    throw new ApiError(
      409,
      'AGENT_TURN_CONFIG_CHANGED',
      'The model or billing binding changed after this Agent turn was queued',
    )
  }
}

export function requireCurrentProviderAttemptCompletion<T>(completion: T | 'stale' | null): T {
  if (completion === 'stale') {
    throw new ApiError(409, 'AGENT_DISPATCH_ATTEMPT_STALE', 'Agent planning lease is no longer current')
  }
  if (!completion) {
    throw new ApiError(503, 'AGENT_PROVIDER_ATTEMPT_UNAVAILABLE', 'Provider attempt completion could not be persisted')
  }
  return completion
}

export function providerSettlementEstimateMicros(
  reservedMicros: number,
  totalTokens: number | undefined,
  maximumRateMicrosPerToken: number,
): number {
  return totalTokens === undefined ? reservedMicros : Math.ceil(totalTokens * maximumRateMicrosPerToken)
}

async function resolveAttachments(
  repository: Repository,
  actorId: string,
  projectId: string,
  conversationId: string,
  attachmentIds: readonly string[],
): Promise<AgentAssetRecord[]> {
  if (attachmentIds.length === 0) return []
  if (!repository.getAgentAsset) {
    throw new ApiError(503, 'AGENT_ASSETS_UNAVAILABLE', 'Agent attachment storage is unavailable')
  }
  const uniqueIds = [...new Set(attachmentIds)]
  if (uniqueIds.length !== attachmentIds.length) {
    throw new ApiError(422, 'AGENT_ASSET_DUPLICATE', 'Agent attachment IDs must be unique')
  }
  const assets = await Promise.all(uniqueIds.map(id => repository.getAgentAsset?.(actorId, projectId, id)))
  return assets.map((asset, index) => {
    if (!asset || asset.status !== 'ready') {
      throw new ApiError(404, 'AGENT_ASSET_NOT_READY', `Agent attachment ${uniqueIds[index]} is not ready`)
    }
    if (asset.conversationId !== null && asset.conversationId !== conversationId) {
      throw new ApiError(404, 'AGENT_ASSET_NOT_FOUND', 'Agent attachment does not belong to this conversation')
    }
    return asset
  })
}

async function resolveModelImages(
  repository: Repository,
  actorId: string,
  projectId: string,
  assets: readonly AgentAssetRecord[],
  visionEnabled: boolean,
): Promise<Array<{ assetId: string; url: string; sha256: string }>> {
  if (!visionEnabled) return []
  const images = assets.filter(asset => /^(?:image\/(?:png|jpeg|webp))$/iu.test(asset.contentType)).slice(0, 4)
  if (images.length === 0) return []
  const durable = repository as Partial<DurableTurnRepository>
  if (!durable.getAgentAssetModelInput) {
    throw new ApiError(503, 'AGENT_ASSETS_UNAVAILABLE', 'Agent image access is unavailable')
  }
  return Promise.all(
    images.map(async asset => {
      const persisted = await durable.getAgentAssetModelInput?.(actorId, projectId, asset.id)
      if (persisted === 'unsupported') {
        throw new ApiError(422, 'AGENT_IMAGE_UNSUPPORTED', 'Agent image attachment is unsupported')
      }
      if (persisted === 'oversize') {
        throw new ApiError(413, 'AGENT_IMAGE_TOO_LARGE', 'Agent image attachment exceeds the model input limit')
      }
      if (!persisted) throw new ApiError(404, 'AGENT_ASSET_NOT_FOUND', 'Agent image attachment is unavailable')
      return {
        assetId: asset.id,
        url: decodeAssetModelInput(persisted.record, persisted.bytes).dataUrl,
        sha256: persisted.record.sha256,
      }
    }),
  )
}

async function assertAgentRunWorkspaceAuthority(
  repository: Repository,
  actorId: string,
  projectId: string,
  conversationId: string,
  taskId: string,
): Promise<{
  workspaceVersion: 1 | 2
  conversationTurns: Array<{ role: 'user' | 'assistant'; content: string }>
  projectContext: Array<{ title: string; content: string; status: 'pending' | 'confirmed' }>
}> {
  const payload = await readAgentRunWorkspace(repository, actorId, projectId)
  const conversation = payload.conversations.find(candidate => candidate.id === conversationId)
  if (!conversation) {
    throw new ApiError(404, 'AGENT_CONVERSATION_NOT_FOUND', 'Agent conversation not found')
  }
  if (!conversation.tasks.some(task => task.id === taskId)) {
    throw new ApiError(404, 'AGENT_TASK_NOT_FOUND', 'Agent task not found')
  }
  const confirmed = payload.projectContexts.filter(context => context.status === 'confirmed').slice(-24)
  const pendingLimit = 24 - confirmed.length
  const pending =
    pendingLimit === 0
      ? []
      : payload.projectContexts.filter(context => context.status === 'pending').slice(-pendingLimit)
  const currentTaskMessageIndex = conversation.messages.findIndex(message => message.taskId === taskId)
  const priorMessages =
    currentTaskMessageIndex === -1 ? conversation.messages : conversation.messages.slice(0, currentTaskMessageIndex)
  return {
    workspaceVersion: payload.version,
    conversationTurns: priorMessages.flatMap(message =>
      message.role === 'user' || message.role === 'assistant' ? [{ role: message.role, content: message.content }] : [],
    ),
    projectContext: [...confirmed, ...pending].map(context => ({
      title: context.title,
      content: context.content.slice(0, 2_000),
      status: context.status,
    })),
  }
}

async function readAgentRunWorkspace(repository: Repository, actorId: string, projectId: string) {
  if (!repository.getAgentWorkspace) {
    throw new ApiError(503, 'AGENT_WORKSPACE_UNAVAILABLE', 'Agent workspace persistence is unavailable')
  }
  const workspace = await repository.getAgentWorkspace(actorId, projectId)
  if (!workspace) {
    throw new ApiError(404, 'AGENT_CONVERSATION_NOT_FOUND', 'Agent conversation not found')
  }

  let payload: ReturnType<typeof parseAgentProjectWorkspacePayload>
  try {
    payload = parseAgentProjectWorkspacePayload(workspace.payload, actorId, projectId)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(503, 'AGENT_WORKSPACE_INVALID', 'Persisted Agent workspace is invalid')
    }
    throw error
  }

  return payload
}

async function repairMissingAgentRunDispatch(
  options: AgentRunRouteOptions,
  actorId: string,
  projectId: string,
  operation: AgentSpikeOperationRecord | null,
  dispatch: AgentRunDispatchRecord | null,
): Promise<AgentRunDispatchRecord | null> {
  if (
    dispatch ||
    !options.dispatcher ||
    !operation ||
    (operation.status !== 'issued' && operation.status !== 'prepared')
  ) {
    return dispatch
  }
  const workspace = await readAgentRunWorkspace(options.repository, actorId, projectId)
  const conversation = workspace.conversations.find(candidate =>
    candidate.tasks.some(task => task.id === operation.taskId),
  )
  if (!conversation) {
    throw new ApiError(503, 'AGENT_RUN_RECOVERY_UNAVAILABLE', 'Agent run conversation could not be recovered')
  }
  return options.dispatcher.enqueue(actorId, {
    projectId,
    conversationId: conversation.id,
    taskId: operation.taskId,
    operationId: operation.operationId,
  })
}

export function createAgentRunRoutes(options: AgentRunRouteOptions) {
  const app = new Hono<{ Variables: AppVariables }>()

  const wakeTaskOrchestrator = (projectId: string, taskRunId: string) => {
    try {
      options.wakeTaskOrchestrator?.()
    } catch {
      ;(options.taskOrchestratorLogger ?? console).warn({
        code: 'AGENT_TASK_ORCHESTRATOR_WAKE_FAILED',
        projectId,
        taskRunId,
      })
    }
  }

  const requireSemanticTaskRuns = (): SemanticTaskRunRepository => {
    if (!options.env.AGENT_TASK_LOOP_V1) {
      throw new ApiError(404, 'AGENT_TASK_RUN_NOT_FOUND', 'Agent task run not found')
    }
    const repository = semanticTaskRunRepository(options.repository)
    if (!repository) {
      throw new ApiError(503, 'AGENT_TASK_LOOP_UNAVAILABLE', 'Agent task loop persistence is unavailable')
    }
    return repository
  }

  app.post('/:projectId/agent/task-runs', async c => {
    const repository = requireSemanticTaskRuns()
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const body = await readJson(c, taskRunRequestSchema)
    const project = await repository.getProject(actorId, projectId)
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const workspaceAuthority = await assertAgentRunWorkspaceAuthority(
      repository,
      actorId,
      projectId,
      body.conversationId,
      body.taskId,
    )
    if (workspaceAuthority.workspaceVersion !== 2) {
      throw new ApiError(
        409,
        'AGENT_WORKSPACE_UPGRADE_REQUIRED',
        'Historical Agent tasks remain readable but cannot start a semantic task run',
      )
    }
    const attachments = await resolveAttachments(
      repository,
      actorId,
      projectId,
      body.conversationId,
      body.attachmentIds,
    )
    const runtime = await resolveAgentModelRuntime(
      { repository, env: options.env, ...options.modelConfig },
      actorId,
      projectId,
    )
    const userPreferences = repository.getAgentUserPreferenceMemory
      ? agentUserPreferencesForModel(await repository.getAgentUserPreferenceMemory(actorId))
      : []
    const images = await resolveModelImages(repository, actorId, projectId, attachments, runtime.capabilities.vision)
    const providerInputSnapshot = createAgentProviderInputSnapshot({
      prompt: body.prompt,
      conversationTurns: workspaceAuthority.conversationTurns,
      selectionContext: body.selectionContext,
      project,
      conversationId: body.conversationId,
      taskId: body.taskId,
      attachments,
      projectContext: workspaceAuthority.projectContext,
      userPreferences,
      images: images.map(image => ({ assetId: image.assetId, sha256: image.sha256 })),
      linkedPieChartStyles: options.env.AGENT_ENABLE_LINKED_PIE_CHART_0_0_8,
    })
    const estimatedTokens = estimateAgentProviderInputTokens(providerInputSnapshot)
    const configDigest = agentTaskRuntimeConfigDigest(runtime)
    const createdAt = options.modelConfig?.now?.() ?? new Date()
    const idempotencyKey =
      body.idempotencyKey ??
      `task-run:${canonicalJsonSha256({ projectId, conversationId: body.conversationId, taskId: body.taskId })}`
    const created = await repository.createAgentTaskRun(actorId, {
      projectId,
      conversationId: body.conversationId,
      taskId: body.taskId,
      idempotencyKey,
      binding: {
        provider: runtime.provider,
        model: runtime.model,
        profileId: runtime.profileId,
        configDigest,
      },
      bounds: {
        maxProviderTurns: 12,
        maxStepRevisions: 2,
        maxExecutorRetries: 2,
        tokenLimit: Math.max(estimatedTokens, 64_000),
        costLimitMicros: runtime.budget.taskMicros,
      },
      taskStartDocumentRevision: project.draftVersion,
      planningInput: {
        purpose: 'planning',
        prompt: body.prompt,
        attachmentIds: body.attachmentIds,
        providerInputSnapshot,
        clarificationHistory: [],
      },
      now: createdAt,
    })
    if (created === 'configuration_drift') {
      throw new ApiError(409, 'AGENT_MODEL_BINDING_DRIFT', 'Conversation model binding changed after task creation')
    }
    if (created === 'conflict') {
      throw new ApiError(409, 'AGENT_TASK_IDEMPOTENCY_CONFLICT', 'Agent task input changed after it was submitted')
    }
    if (created === 'workspace_unavailable') {
      throw new ApiError(503, 'AGENT_TASK_RUN_BINDING_UNAVAILABLE', 'Agent task workspace is unavailable')
    }
    if (!created) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const detail = await repository.getAgentTaskRunDetail(actorId, projectId, created.id)
    if (!detail)
      throw new ApiError(503, 'AGENT_TASK_RUN_UNAVAILABLE', 'Agent task run could not be read after creation')
    wakeTaskOrchestrator(projectId, created.id)
    return c.json({ taskRun: publicTaskRunDetail(detail) }, 202)
  })

  app.get('/:projectId/agent/task-runs/:taskRunId', async c => {
    const repository = requireSemanticTaskRuns()
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const taskRunId = c.req.param('taskRunId')
    const detail = await repository.getAgentTaskRunDetail(actorId, projectId, taskRunId)
    if (!detail) throw new ApiError(404, 'AGENT_TASK_RUN_NOT_FOUND', 'Agent task run not found')
    return c.json({ taskRun: publicTaskRunDetail(detail) })
  })

  app.get('/:projectId/agent/task-runs/:taskRunId/events', async c => {
    const repository = requireSemanticTaskRuns()
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const taskRunId = c.req.param('taskRunId')
    const parsedQuery = taskRunEventsQuerySchema.safeParse(c.req.query())
    if (!parsedQuery.success) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Agent task event query is invalid')
    }
    const query = parsedQuery.data
    const page = await repository.listAgentTaskEventPage(actorId, projectId, taskRunId, query)
    if (!page) throw new ApiError(404, 'AGENT_TASK_RUN_NOT_FOUND', 'Agent task run not found')
    return c.json({
      events: page.events.map(publicTaskEvent),
      latestEventSequence: page.latestEventSequence,
      retentionPolicy: {
        version: 'unbounded_v1',
        earliestAvailableSequence: page.latestEventSequence === 0 ? 0 : 1,
      },
      artifactPolicy: { version: 'none_v1' },
    })
  })

  app.post('/:projectId/agent/task-runs/:taskRunId/continue', async c => {
    const repository = requireSemanticTaskRuns()
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const taskRunId = c.req.param('taskRunId')
    const body = await readJson(c, taskRunContinueSchema)
    const currentDetail = await repository.getAgentTaskRunDetail(actorId, projectId, taskRunId)
    if (!currentDetail) throw new ApiError(404, 'AGENT_TASK_RUN_NOT_FOUND', 'Agent task run not found')
    const attachments = await resolveAttachments(
      repository,
      actorId,
      projectId,
      currentDetail.run.conversationId,
      body.attachmentIds,
    )
    const runtime = await resolveAgentModelRuntime(
      { repository, env: options.env, ...options.modelConfig },
      actorId,
      projectId,
    )
    const images = await resolveModelImages(repository, actorId, projectId, attachments, runtime.capabilities.vision)
    const continuedAt = options.modelConfig?.now?.() ?? new Date()
    const idempotencyKey =
      body.idempotencyKey ??
      `continue:${canonicalJsonSha256({
        taskRunId,
        questionId: body.questionId,
        response: body.response,
        attachmentIds: body.attachmentIds,
      })}`
    const continued = await repository.continueAgentTaskRun(actorId, {
      projectId,
      taskRunId,
      questionId: body.questionId,
      response: body.response,
      attachmentIds: body.attachmentIds,
      imageInputs: images.map(image => ({ assetId: image.assetId, sha256: image.sha256 })),
      idempotencyKey,
      now: continuedAt,
    })
    if (continued === 'conflict') {
      throw new ApiError(409, 'AGENT_TASK_CONTINUE_CONFLICT', 'Agent task continuation input changed after submission')
    }
    if (continued === 'invalid_state') {
      throw new ApiError(409, 'AGENT_TASK_CONTINUE_INVALID_STATE', 'Agent task is not waiting for this response')
    }
    if (!continued) throw new ApiError(404, 'AGENT_TASK_RUN_NOT_FOUND', 'Agent task run not found')
    const detail = await repository.getAgentTaskRunDetail(actorId, projectId, taskRunId)
    if (!detail)
      throw new ApiError(503, 'AGENT_TASK_RUN_UNAVAILABLE', 'Agent task run could not be read after continue')
    wakeTaskOrchestrator(projectId, taskRunId)
    return c.json({ taskRun: publicTaskRunDetail(detail) }, 202)
  })

  app.post('/:projectId/agent/runs', async c => {
    if (!options.dispatcher) {
      throw new ApiError(503, 'AGENT_DISPATCHER_UNAVAILABLE', 'Durable Agent dispatcher is not configured')
    }
    if (!options.spike.grantSecret || !options.spike.expectedCompatibility) {
      throw new ApiError(503, 'AGENT_EXECUTOR_UNAVAILABLE', 'Agent executor artifact lock is not configured')
    }
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const body = await readJson(c, requestSchema)
    const project = await options.repository.getProject(actorId, projectId)
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const workspaceAuthority = await assertAgentRunWorkspaceAuthority(
      options.repository,
      actorId,
      projectId,
      body.conversationId,
      body.taskId,
    )
    const turnId = body.turnId ?? body.taskId
    const durableTurns = durableRepository(options.repository)
    const persistedTurn = options.planningAttempt
      ? await durableTurns?.getAgentTurnByDispatch(actorId, options.planningAttempt.dispatchId)
      : null
    if (!options.planningAttempt) {
      const repository = durableTurns
      if (!repository) {
        throw new ApiError(503, 'AGENT_DURABLE_TURNS_UNAVAILABLE', 'Durable Agent turn persistence is unavailable')
      }
      const attachments = await resolveAttachments(
        options.repository,
        actorId,
        projectId,
        body.conversationId,
        body.attachmentIds,
      )
      const runtime = await resolveAgentModelRuntime(
        { repository: options.repository, env: options.env, ...options.modelConfig },
        actorId,
        projectId,
      )
      const userPreferences = options.repository.getAgentUserPreferenceMemory
        ? agentUserPreferencesForModel(await options.repository.getAgentUserPreferenceMemory(actorId))
        : []
      const images = await resolveModelImages(
        options.repository,
        actorId,
        projectId,
        attachments,
        runtime.capabilities.vision,
      )
      const providerInputSnapshot = createAgentProviderInputSnapshot({
        prompt: body.prompt,
        conversationTurns: workspaceAuthority.conversationTurns,
        selectionContext: body.selectionContext,
        project,
        conversationId: body.conversationId,
        taskId: body.taskId,
        attachments,
        projectContext: workspaceAuthority.projectContext,
        userPreferences,
        images: images.map(image => ({ assetId: image.assetId, sha256: image.sha256 })),
        linkedPieChartStyles: options.env.AGENT_ENABLE_LINKED_PIE_CHART_0_0_8,
      })
      const inputDigest = agentRunInputDigest({
        projectId,
        conversationId: body.conversationId,
        taskId: body.taskId,
        turnId,
        prompt: body.prompt,
        attachmentIds: body.attachmentIds,
        projectContext: workspaceAuthority.projectContext,
        selectionContext: body.selectionContext,
      })
      const maximumRate = options.env.AGENT_BILLING_MAX_USD_PER_1M_TOKENS ?? 100
      const estimatedMicros = Math.ceil(estimateAgentProviderInputTokens(providerInputSnapshot) * maximumRate)
      const createdAt = options.modelConfig?.now?.() ?? new Date()
      const operationId = `operation-${randomUUID()}`
      const enqueued = await repository.enqueueAgentTurn(actorId, {
        projectId,
        conversationId: body.conversationId,
        taskId: body.taskId,
        turnId,
        operationId,
        inputDigest,
        prompt: body.prompt,
        attachmentIds: body.attachmentIds,
        projectContext: workspaceAuthority.projectContext,
        provider: runtime.provider,
        model: runtime.model,
        profileId: runtime.profileId,
        endpoint: runtime.endpoint.toString(),
        billingScope: runtime.billingScope,
        payerId: runtime.payerId,
        taskLimitMicros: runtime.budget.taskMicros,
        projectMonthLimitMicros: runtime.budget.projectMonthMicros,
        projectDraftVersion: project.draftVersion,
        reservedMicros: estimatedMicros,
        maximumRateMicrosPerToken: maximumRate,
        providerInputSnapshot,
        idempotencyMode: 'unsupported',
        providerRequestKey: null,
        now: createdAt,
        reservationExpiresAt: new Date(createdAt.getTime() + AGENT_RUN_RESERVATION_TTL_MS),
      })
      if (enqueued === 'conflict') {
        throw new ApiError(409, 'AGENT_TASK_IDEMPOTENCY_CONFLICT', 'Agent task input changed after it was submitted')
      }
      if (enqueued === 'task_budget_exceeded') {
        throw new ApiError(429, 'AGENT_TASK_BUDGET_EXCEEDED', 'This Agent run exceeds the configured task budget')
      }
      if (enqueued === 'project_budget_exceeded') {
        throw new ApiError(429, 'AGENT_PROJECT_BUDGET_EXCEEDED', 'This project has reached its monthly Agent budget')
      }
      if (!enqueued) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
      options.dispatcher.wake()
      return c.json(
        {
          kind: 'run',
          turnId,
          taskId: body.taskId,
          run: durableRun(null, enqueued.cost, enqueued.dispatch),
        },
        202,
      )
    }
    if (!options.repository.reserveAgentRunCost || !options.repository.settleAgentRunCost) {
      throw new ApiError(503, 'AGENT_COST_LEDGER_UNAVAILABLE', 'Agent budget ledger is unavailable')
    }
    const inputDigest =
      persistedTurn?.inputDigest ??
      agentRunInputDigest({
        projectId,
        conversationId: body.conversationId,
        taskId: body.taskId,
        turnId,
        prompt: body.prompt,
        attachmentIds: body.attachmentIds,
        projectContext: workspaceAuthority.projectContext,
        selectionContext: body.selectionContext,
      })
    const durableTurn = options.repository.getAgentRunCostByTurn
      ? await options.repository.getAgentRunCostByTurn(actorId, projectId, turnId)
      : null
    if (durableTurn && (durableTurn.taskId !== body.taskId || durableTurn.inputDigest !== inputDigest)) {
      throw new ApiError(409, 'AGENT_TASK_IDEMPOTENCY_CONFLICT', 'Agent task input changed after it was submitted')
    }

    const initialDispatch = options.dispatcher
      ? await options.dispatcher.getByTask(actorId, projectId, body.taskId)
      : null
    const requestedOperationId =
      persistedTurn?.operationId ??
      (initialDispatch?.kind === 'initial' && initialDispatch.waitingReason !== 'user'
        ? initialDispatch.operationId
        : `operation-${randomUUID()}`)
    if (options.planningAttempt) {
      const attemptValid = await options.repository.validateAgentRunDispatchAttempt?.(
        actorId,
        projectId,
        requestedOperationId,
        options.planningAttempt,
        options.modelConfig?.now?.() ?? new Date(),
      )
      if (!attemptValid) {
        throw new ApiError(409, 'AGENT_DISPATCH_ATTEMPT_STALE', 'Agent planning lease is no longer current')
      }
    }
    const maximumRate = options.env.AGENT_BILLING_MAX_USD_PER_1M_TOKENS ?? 100
    let attachments: AgentAssetRecord[] = []
    let images: Array<{ assetId: string; url: string; sha256: string }> = []
    let runtime: ResolvedAgentModelRuntime | null = null
    let userPreferences: AgentUserPreference[] = []
    let estimatedMicros = durableTurn?.reservedMicros ?? 0
    let reservation: AgentRunCostRecord | 'conflict' | 'task_budget_exceeded' | 'project_budget_exceeded' | null =
      durableTurn?.state === 'released' ? null : durableTurn

    if (!reservation) {
      attachments = await resolveAttachments(
        options.repository,
        actorId,
        projectId,
        body.conversationId,
        body.attachmentIds,
      )
      runtime = await resolveAgentModelRuntime(
        {
          repository: options.repository,
          env: options.env,
          ...options.modelConfig,
        },
        actorId,
        projectId,
      )
      if (!persistedTurn && options.repository.getAgentUserPreferenceMemory) {
        userPreferences = agentUserPreferencesForModel(await options.repository.getAgentUserPreferenceMemory(actorId))
      }
      images = await resolveModelImages(
        options.repository,
        actorId,
        projectId,
        attachments,
        runtime.capabilities.vision,
      )
      const promptCharacters =
        body.prompt.length +
        workspaceAuthority.projectContext.reduce((sum, item) => sum + item.title.length + item.content.length, 0) +
        agentUserPreferenceTextLength(userPreferences) +
        attachments.reduce((sum, asset) => sum + (asset.extractedText?.length ?? 0), 0)
      const estimatedTokens = Math.ceil(promptCharacters / 2) + 3_000 + images.length * 2_000
      estimatedMicros = Math.ceil(estimatedTokens * maximumRate)
      if (estimatedMicros > runtime.budget.taskMicros) {
        throw new ApiError(429, 'AGENT_TASK_BUDGET_EXCEEDED', 'This Agent run exceeds the configured task budget')
      }
      const reservedAt = options.modelConfig?.now?.() ?? new Date()
      reservation = await options.repository.reserveAgentRunCost(actorId, {
        projectId,
        taskId: body.taskId,
        turnId,
        inputDigest,
        estimatedMicros,
        taskLimitMicros: runtime.budget.taskMicros,
        projectMonthLimitMicros: runtime.budget.projectMonthMicros,
        operationId: requestedOperationId,
        provider: runtime.provider,
        model: runtime.model,
        profile: runtime.profileId,
        billingScope: runtime.billingScope,
        payerId: runtime.payerId,
        now: reservedAt,
        reservationExpiresAt: new Date(reservedAt.getTime() + AGENT_RUN_RESERVATION_TTL_MS),
      })
    }
    if (reservation === 'conflict') {
      throw new ApiError(409, 'AGENT_TASK_IDEMPOTENCY_CONFLICT', 'Agent task input changed after it was submitted')
    }
    if (reservation === 'task_budget_exceeded') {
      throw new ApiError(429, 'AGENT_TASK_BUDGET_EXCEEDED', 'This Agent run exceeds the configured task budget')
    }
    if (reservation === 'project_budget_exceeded') {
      throw new ApiError(429, 'AGENT_PROJECT_BUDGET_EXCEEDED', 'This project has reached its monthly Agent budget')
    }
    if (!reservation) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const operationId = reservation.operationId ?? requestedOperationId
    const repeatedTurn = operationId !== requestedOperationId
    let modelCheckpoint = restoreModelCheckpoint(reservation)
    let modelResult = modelCheckpoint?.result ?? null

    if (repeatedTurn) {
      const existing = await options.repository.getAgentSpikeOperationOutcome(actorId, operationId)
      if (modelResult?.output.action === 'ask_user') {
        if (existing) {
          throw new ApiError(409, 'AGENT_TURN_CHECKPOINT_INVALID', 'Agent clarification unexpectedly has an operation')
        }
        return c.json(waitingUserResponse(turnId, body.taskId, modelResult, reservation))
      }
      if (existing) {
        const dispatch = options.dispatcher
          ? await options.dispatcher.enqueue(actorId, {
              projectId,
              conversationId: body.conversationId,
              taskId: body.taskId,
              operationId,
            })
          : null
        const summary = modelResult?.output.action === 'execute' ? modelResult.output.summary : undefined
        return c.json(
          {
            kind: 'run',
            turnId,
            taskId: body.taskId,
            ...(modelResult?.output.action === 'execute'
              ? { plan: visiblePlan(modelResult.output.summary, modelResult.output.plan) }
              : {}),
            run: {
              ...durableRun(existing, reservation, dispatch),
              ...(summary ? { message: summary } : {}),
            },
          },
          202,
        )
      }
    }

    if (!modelResult && !runtime && options.planningAttempt) {
      attachments = await resolveAttachments(
        options.repository,
        actorId,
        projectId,
        body.conversationId,
        body.attachmentIds,
      )
      runtime = await resolveAgentModelRuntime(
        { repository: options.repository, env: options.env, ...options.modelConfig },
        actorId,
        projectId,
      )
      if (!persistedTurn && options.repository.getAgentUserPreferenceMemory) {
        userPreferences = agentUserPreferencesForModel(await options.repository.getAgentUserPreferenceMemory(actorId))
      }
      images = await resolveModelImages(
        options.repository,
        actorId,
        projectId,
        attachments,
        runtime.capabilities.vision,
      )
      if (
        persistedTurn &&
        (persistedTurn.providerInputSnapshot.images.length !== images.length ||
          persistedTurn.providerInputSnapshot.images.some(
            (image, index) => image.assetId !== images[index]?.assetId || image.sha256 !== images[index]?.sha256,
          ))
      ) {
        throw new ApiError(409, 'AGENT_TURN_SNAPSHOT_INVALID', 'Frozen Agent image inputs changed after enqueue')
      }
      estimatedMicros = reservation.reservedMicros
    }

    const conservativePlanningMaximum = (currentAttemptMaximumMicros: number) =>
      Math.min(2_147_483_647, currentAttemptMaximumMicros)
    let settled = reservation
    if (!modelResult) {
      if (!runtime) {
        throw new ApiError(409, 'AGENT_TURN_IN_PROGRESS', 'This Agent turn is still being planned')
      }
      if (persistedTurn) {
        assertFrozenAgentTurnRuntime(persistedTurn, runtime, maximumRate)
        if (persistedTurn.projectDraftVersion !== project.draftVersion) {
          throw new ApiError(
            409,
            'AGENT_TURN_PROJECT_STALE',
            'The project changed after this Agent turn was queued; submit a new turn to replan safely',
          )
        }
      }
      const durableAttemptLifecycleActive = Boolean(persistedTurn && durableTurns && options.planningAttempt)
      const providerAttemptState: { current: DurableProviderAttemptRecord | null } = { current: null }
      try {
        modelResult = validateModelResult(
          await (options.model ?? requestAgentChangeSet)({
            runtime,
            prompt: body.prompt,
            project,
            conversationId: body.conversationId,
            taskId: body.taskId,
            conversationTurns: workspaceAuthority.conversationTurns,
            selectionContext: body.selectionContext,
            attachments,
            images,
            projectContext: workspaceAuthority.projectContext,
            userPreferences,
            ...(persistedTurn ? { providerInputSnapshot: persistedTurn.providerInputSnapshot } : {}),
            resolveHost: options.modelConfig?.resolveHost,
            timeoutMs: options.env.AGENT_MODEL_TIMEOUT_MS,
            linkedPieChartStyles: options.env.AGENT_ENABLE_LINKED_PIE_CHART_0_0_8,
            ...(persistedTurn && durableTurns && options.planningAttempt
              ? {
                  providerRequestKey: persistedTurn.providerRequestKey ?? undefined,
                  idempotencyMode: persistedTurn.idempotencyMode,
                  providerAttemptLifecycle: {
                    async prepare(metadata) {
                      const prepared = await durableTurns.prepareAgentProviderAttempt(
                        actorId,
                        options.planningAttempt as AgentDispatchAttempt,
                        {
                          projectId,
                          taskId: body.taskId,
                          turnId,
                          providerRequestKey: metadata.providerRequestKey ?? null,
                          requestBodyDigest: metadata.requestBodyDigest,
                          idempotencyMode: metadata.idempotencyMode,
                          reservedMicros: reservation.reservedMicros,
                          now: options.modelConfig?.now?.() ?? new Date(),
                        },
                      )
                      if (prepared === 'stale') {
                        throw new ApiError(
                          409,
                          'AGENT_DISPATCH_ATTEMPT_STALE',
                          'Agent planning lease is no longer current',
                        )
                      }
                      if (prepared === 'outcome_unknown') {
                        throw new ApiError(
                          409,
                          'AGENT_PROVIDER_BILLING_INDETERMINATE',
                          'A prior started provider attempt has an unknown outcome; automatic resend is disabled',
                        )
                      }
                      if (prepared === 'task_budget_exceeded' || prepared === 'project_budget_exceeded') {
                        throw new ApiError(
                          429,
                          'AGENT_BUDGET_EXCEEDED',
                          'Agent budget was exhausted before provider I/O',
                        )
                      }
                      providerAttemptState.current = prepared
                      return {
                        ...(prepared.providerRequestKey ? { providerRequestKey: prepared.providerRequestKey } : {}),
                        requestBodyDigest: prepared.requestBodyDigest,
                        idempotencyMode: prepared.idempotencyMode,
                      }
                    },
                    async markStarted() {
                      if (!providerAttemptState.current) throw new Error('Provider attempt was not prepared')
                      const started = await durableTurns.markAgentProviderAttemptStarted(
                        actorId,
                        providerAttemptState.current.id,
                        options.planningAttempt as AgentDispatchAttempt,
                        options.modelConfig?.now?.() ?? new Date(),
                      )
                      if (!started) {
                        throw new ApiError(
                          409,
                          'AGENT_DISPATCH_ATTEMPT_STALE',
                          'Agent planning lease is no longer current',
                        )
                      }
                      providerAttemptState.current = started
                    },
                  },
                }
              : {}),
          }),
        )
      } catch (error) {
        if (error instanceof AgentChangeSetProviderResponseError) {
          if (providerAttemptState.current && durableTurns && options.planningAttempt) {
            requireCurrentProviderAttemptCompletion(
              await durableTurns.completeAgentProviderAttempt(
                actorId,
                providerAttemptState.current.id,
                options.planningAttempt,
                {
                  state: 'succeeded',
                  providerAttempt: error.providerAttempt,
                  estimatedMicros: conservativePlanningMaximum(estimatedMicros),
                  now: options.modelConfig?.now?.() ?? new Date(),
                },
              ),
            )
          }
          throw publicAgentProviderResponseFailure(error)
        }
        if (
          error instanceof AgentChangeSetProviderError &&
          providerAttemptState.current &&
          durableTurns &&
          options.planningAttempt
        ) {
          requireCurrentProviderAttemptCompletion(
            await durableTurns.completeAgentProviderAttempt(
              actorId,
              providerAttemptState.current.id,
              options.planningAttempt,
              {
                state: error.providerAttempt.outcome,
                providerAttempt: error.providerAttempt,
                estimatedMicros: conservativePlanningMaximum(estimatedMicros),
                now: options.modelConfig?.now?.() ?? new Date(),
              },
            ),
          )
          if (
            error.providerAttempt.outcome === 'outcome_unknown' &&
            error.providerAttempt.idempotencyMode === 'unsupported'
          ) {
            throw new ApiError(
              409,
              'AGENT_PROVIDER_BILLING_INDETERMINATE',
              'Provider outcome is unknown; automatic resend is disabled',
            )
          }
          throw new ApiError(
            503,
            error.providerAttempt.outcome === 'failed_definite'
              ? 'AGENT_PROVIDER_FAILED_DEFINITE'
              : 'AGENT_PROVIDER_RETRYABLE',
            'Provider attempt can be retried within dispatch bounds',
          )
        }
        if (durableAttemptLifecycleActive) throw error
        await options.repository.settleAgentRunCost(actorId, {
          projectId,
          taskId: body.taskId,
          turnId,
          settledMicros: conservativePlanningMaximum(estimatedMicros),
          minimumMicros: 0,
          maximumMicros: conservativePlanningMaximum(estimatedMicros),
          indeterminate: true,
        })
        throw error
      }
      const totalTokens =
        modelResult.usage?.totalTokens ??
        ((modelResult.usage?.promptTokens ?? 0) + (modelResult.usage?.completionTokens ?? 0) || undefined)
      const currentAttemptMaximumMicros = providerSettlementEstimateMicros(estimatedMicros, totalTokens, maximumRate)
      const settledMaximumMicros = conservativePlanningMaximum(currentAttemptMaximumMicros)
      const durableDecisionOutput = checkpointRecord({
        version: 1,
        baseDraftVersion: persistedTurn?.projectDraftVersion ?? project.draftVersion,
        output: modelResult.output,
      })
      const providerSettlement =
        providerAttemptState.current && modelResult.providerAttempt && durableTurns && options.planningAttempt
          ? requireCurrentProviderAttemptCompletion(
              await durableTurns.completeAgentProviderAttempt(
                actorId,
                providerAttemptState.current.id,
                options.planningAttempt,
                {
                  state: 'succeeded',
                  providerAttempt: modelResult.providerAttempt,
                  decisionOutput: durableDecisionOutput,
                  decisionUsage: modelResult.usage ? checkpointRecord(modelResult.usage) : null,
                  decisionTrace: checkpointRecord(modelResult.trace),
                  observedTokens: totalTokens,
                  promptTokens: modelResult.usage?.promptTokens,
                  completionTokens: modelResult.usage?.completionTokens,
                  cachedTokens: modelResult.usage?.cachedTokens,
                  estimatedMicros: settledMaximumMicros,
                  now: options.modelConfig?.now?.() ?? new Date(),
                },
              ),
            )
          : null
      const settlement = providerSettlement
        ? providerSettlement.cost
        : durableAttemptLifecycleActive
          ? (() => {
              throw new ApiError(
                503,
                'AGENT_PROVIDER_ATTEMPT_UNAVAILABLE',
                'Provider attempt result was not durably persisted',
              )
            })()
          : await options.repository.settleAgentRunCost(actorId, {
              projectId,
              taskId: body.taskId,
              turnId,
              settledMicros: settledMaximumMicros,
              minimumMicros: 0,
              maximumMicros: settledMaximumMicros,
              promptTokens: modelResult.usage?.promptTokens,
              completionTokens: modelResult.usage?.completionTokens,
              indeterminate: true,
              decisionOutput: durableDecisionOutput,
              decisionUsage: modelResult.usage ? checkpointRecord(modelResult.usage) : null,
              decisionTrace: checkpointRecord(modelResult.trace),
            })
      if (!settlement) {
        const reconciled = options.repository.reconcileAgentRunCost
          ? await options.repository.reconcileAgentRunCost(
              actorId,
              projectId,
              body.taskId,
              options.modelConfig?.now?.() ?? new Date(),
            )
          : null
        const reconciledTurn = options.repository.getAgentRunCostByTurn
          ? await options.repository.getAgentRunCostByTurn(actorId, projectId, turnId)
          : reconciled
        if (!reconciledTurn) {
          throw new ApiError(503, 'AGENT_COST_LEDGER_UNAVAILABLE', 'Agent run settlement could not be recovered')
        }
        return c.json({ kind: 'run', turnId, taskId: body.taskId, run: durableRun(null, reconciledTurn) }, 202)
      }
      settled = settlement
      const durableDecision = restoreModelCheckpoint(settled)
      if (!durableDecision) {
        return c.json({ kind: 'run', turnId, taskId: body.taskId, run: durableRun(null, settled) }, 202)
      }
      modelCheckpoint = durableDecision
      modelResult = durableDecision.result
    }

    if (modelResult.output.action === 'ask_user') {
      if (
        initialDispatch?.kind === 'initial' &&
        initialDispatch.state === 'paused' &&
        initialDispatch.waitingReason === 'upload'
      ) {
        await options.repository.markAgentRunDispatchWaiting?.(
          actorId,
          projectId,
          operationId,
          'user',
          options.modelConfig?.now?.() ?? new Date(),
        )
      }
      return c.json(waitingUserResponse(turnId, body.taskId, modelResult, settled))
    }
    if (modelCheckpoint?.baseDraftVersion !== project.draftVersion) {
      throw new ApiError(
        409,
        'AGENT_TURN_PROJECT_STALE',
        'The project changed after this Agent turn was planned; submit a new turn to replan safely',
      )
    }
    let invocation: ReturnType<typeof planStrictChangeSet>
    try {
      invocation = planStrictChangeSet(modelResult.output, resolveDashboardActiveDocumentId(project.draftSchema), {
        immutableNodeIds: [resolveDashboardActiveRootNodeId(project.draftSchema)],
        document: project.draftSchema,
        allowedOperationTypes: persistedTurn
          ? agentAllowedOperationTypesForProviderInput(persistedTurn.providerInputSnapshot)
          : agentAllowedOperationTypesForRequest(project.draftSchema, body.prompt),
        requireRemove: agentRunRequiresRemove({
          ...(persistedTurn ? { providerInputSnapshot: persistedTurn.providerInputSnapshot } : {}),
          prompt: body.prompt,
        }),
      })
    } catch (error) {
      if (error instanceof InvalidDashboardDocumentError) {
        throw new ApiError(409, 'AGENT_PROJECT_DOCUMENT_INVALID', error.message)
      }
      throw new ApiError(422, 'AGENT_MODEL_OUTPUT_INVALID', 'Agent model proposed an invalid ChangeSet')
    }
    const issued = await issueAgentSpikeOperation(options.spike, actorId, projectId, {
      executorId: 'easy-dashboard-document-executor',
      operationId,
      taskId: body.taskId,
      stageId: 'apply-change-set',
      compatibility: options.spike.expectedCompatibility,
      invocation,
      trace: modelResult.trace,
    })

    let dispatch = options.dispatcher
      ? await options.dispatcher.enqueue(actorId, {
          projectId,
          conversationId: body.conversationId,
          taskId: body.taskId,
          operationId,
        })
      : null
    if (dispatch?.kind === 'initial' && dispatch.state === 'paused' && dispatch.waitingReason === 'upload') {
      const resumed = await options.dispatcher?.control(actorId, projectId, operationId, 'resume')
      if (resumed && resumed !== 'invalid_state') dispatch = resumed
    }
    if (!dispatch)
      throw new ApiError(503, 'AGENT_DISPATCHER_UNAVAILABLE', 'Durable Agent dispatch could not be persisted')

    return c.json(
      {
        kind: 'run',
        turnId,
        taskId: body.taskId,
        plan: visiblePlan(modelResult.output.summary, modelResult.output.plan),
        run: {
          ...durableRun(issued.operation, settled, dispatch),
          message: modelResult.output.summary,
          createdAt: issued.operation.createdAt,
        },
      },
      202,
    )
  })

  app.get('/:projectId/agent/runs/:operationId', async c => {
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const operationId = c.req.param('operationId')
    if (!projectId || !operationId) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    const [operation, existingDispatch] = await Promise.all([
      options.repository.getAgentSpikeOperationOutcome(actorId, operationId),
      options.dispatcher?.get(actorId, projectId, operationId) ?? null,
    ])
    if ((!operation && !existingDispatch) || (operation && operation.projectId !== projectId)) {
      throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    }
    const dispatch = await repairMissingAgentRunDispatch(options, actorId, projectId, operation, existingDispatch)
    const cost = options.repository.getAgentRunCost
      ? await options.repository.getAgentRunCost(
          actorId,
          operation?.projectId ?? projectId,
          operation?.taskId ?? dispatch?.taskId ?? '',
        )
      : null
    return c.json({ run: durableRun(operation, cost, dispatch) })
  })

  app.get('/:projectId/agent/runs/tasks/:taskId', async c => {
    if (!options.repository.getAgentSpikeOperationOutcomeByTask || !options.repository.reconcileAgentRunCost) {
      throw new ApiError(503, 'AGENT_RUN_RECOVERY_UNAVAILABLE', 'Agent run recovery is unavailable')
    }
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const taskId = c.req.param('taskId')
    const [operation, cost, existingDispatch] = await Promise.all([
      options.repository.getAgentSpikeOperationOutcomeByTask(actorId, projectId, taskId),
      options.repository.reconcileAgentRunCost(actorId, projectId, taskId, options.modelConfig?.now?.() ?? new Date()),
      options.dispatcher?.getByTask(actorId, projectId, taskId) ?? null,
    ])
    if (!operation && !cost && !existingDispatch) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    const dispatch = await repairMissingAgentRunDispatch(options, actorId, projectId, operation, existingDispatch)
    return c.json({ run: durableRun(operation, cost, dispatch) })
  })

  app.post('/:projectId/agent/tasks/:taskId/respond', async c => {
    if (!options.dispatcher) {
      throw new ApiError(503, 'AGENT_DISPATCHER_UNAVAILABLE', 'Durable Agent dispatcher is not configured')
    }
    const repository = durableRepository(options.repository)
    if (!repository) {
      throw new ApiError(503, 'AGENT_DURABLE_TURNS_UNAVAILABLE', 'Durable Agent response persistence is unavailable')
    }
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const taskId = c.req.param('taskId')
    const body = await readJson(c, respondSchema)
    const latestDispatch = await options.dispatcher.getByTask(actorId, projectId, taskId)
    if (!latestDispatch) throw new ApiError(404, 'AGENT_TASK_NOT_FOUND', 'Agent task not found')
    const latestTurn = await repository.getAgentTurnByDispatch(actorId, latestDispatch.id)
    if (!latestTurn) {
      throw new ApiError(409, 'AGENT_TURN_SNAPSHOT_INVALID', 'The frozen Agent input is unavailable')
    }
    if (latestTurn.conversationId !== body.conversationId) {
      throw new ApiError(409, 'AGENT_CONVERSATION_CONFLICT', 'Agent response conversation does not match the task')
    }
    await assertAgentRunWorkspaceAuthority(options.repository, actorId, projectId, body.conversationId, taskId)
    const replay = latestTurn.turnId === body.turnId
    if (replay && latestTurn.prompt !== body.response) {
      throw new ApiError(409, 'AGENT_TURN_IDEMPOTENCY_CONFLICT', 'Agent response turn was reused with different input')
    }
    const allAttachmentIds = replay
      ? latestTurn.attachmentIds
      : [...new Set([...latestTurn.attachmentIds, ...body.attachmentIds])]
    const attachments = await resolveAttachments(
      options.repository,
      actorId,
      projectId,
      body.conversationId,
      allAttachmentIds,
    )
    const project = await options.repository.getProject(actorId, projectId)
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const maximumRate = options.env.AGENT_BILLING_MAX_USD_PER_1M_TOKENS ?? 100
    const runtime = await resolveAgentModelRuntime(
      { repository: options.repository, env: options.env, ...options.modelConfig },
      actorId,
      projectId,
    )
    assertFrozenAgentTurnRuntime(latestTurn, runtime, maximumRate)
    if (latestTurn.projectDraftVersion !== project.draftVersion) {
      throw new ApiError(409, 'AGENT_TURN_PROJECT_STALE', 'The project changed; submit a new Agent task')
    }
    const images = await resolveModelImages(
      options.repository,
      actorId,
      projectId,
      attachments,
      runtime.capabilities.vision,
    )
    const sourceCost = replay ? null : await repository.getAgentRunCostByTurn?.(actorId, projectId, latestTurn.turnId)
    const pendingQuestion = replay ? null : durablePendingQuestion(sourceCost)
    if (!replay && (!pendingQuestion || pendingQuestion.question.id !== body.questionId)) {
      throw new ApiError(409, 'AGENT_QUESTION_INVALID', 'Agent question is no longer awaiting a response')
    }
    const providerInputSnapshot = replay
      ? latestTurn.providerInputSnapshot
      : createAgentResponseProviderInputSnapshot(
          latestTurn.providerInputSnapshot,
          pendingQuestion?.question as { id: string; text: string },
          body.response,
          attachments,
          images.map(image => ({ assetId: image.assetId, sha256: image.sha256 })),
          body.selectionContext,
        )
    const reservedMicros = replay
      ? latestTurn.reservedMicros
      : Math.ceil(estimateAgentProviderInputTokens(providerInputSnapshot) * latestTurn.maximumRateMicrosPerToken)
    if (
      providerInputSnapshot.images.length !== images.length ||
      providerInputSnapshot.images.some(
        (image, index) => image.assetId !== images[index]?.assetId || image.sha256 !== images[index]?.sha256,
      )
    ) {
      throw new ApiError(409, 'AGENT_TURN_SNAPSHOT_INVALID', 'Frozen Agent image inputs changed after enqueue')
    }
    const result = await repository.respondToAgentTask(actorId, {
      projectId,
      conversationId: body.conversationId,
      taskId,
      questionId: body.questionId,
      turnId: body.turnId,
      response: body.response,
      attachmentIds: body.attachmentIds,
      providerInputSnapshot,
      reservedMicros,
      now: options.modelConfig?.now?.() ?? new Date(),
    })
    if (result === 'conflict') {
      throw new ApiError(409, 'AGENT_TURN_IDEMPOTENCY_CONFLICT', 'Agent response turn was reused with different input')
    }
    if (result === 'invalid_question') {
      throw new ApiError(409, 'AGENT_QUESTION_INVALID', 'Agent question is no longer awaiting a response')
    }
    if (result === 'task_budget_exceeded') {
      throw new ApiError(429, 'AGENT_TASK_BUDGET_EXCEEDED', 'This Agent response exceeds the configured task budget')
    }
    if (result === 'project_budget_exceeded') {
      throw new ApiError(429, 'AGENT_PROJECT_BUDGET_EXCEEDED', 'This project has reached its monthly Agent budget')
    }
    if (result === 'forbidden') throw new ApiError(403, 'PROJECT_ROLE_FORBIDDEN', 'Project role is not allowed')
    if (!result) throw new ApiError(404, 'AGENT_TASK_NOT_FOUND', 'Agent task not found')
    options.dispatcher.wake()
    const cost = options.repository.getAgentRunCostByTurn
      ? await options.repository.getAgentRunCostByTurn(actorId, projectId, body.turnId)
      : null
    return c.json(
      {
        kind: 'run',
        turnId: body.turnId,
        taskId,
        run: durableRun(null, cost, result.dispatch),
      },
      202,
    )
  })

  const control = (action: AgentRunDispatchControl) => async (c: Context<{ Variables: AppVariables }>) => {
    if (!options.dispatcher) {
      throw new ApiError(503, 'AGENT_RUN_CONTROL_UNAVAILABLE', 'Agent run control is unavailable')
    }
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const operationId = c.req.param('operationId')
    if (!projectId || !operationId) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    const dispatch = await options.dispatcher.control(actorId, projectId, operationId, action)
    if (dispatch === 'invalid_state') {
      throw new ApiError(409, 'AGENT_RUN_CONTROL_INVALID_STATE', `Agent run cannot ${action} in its current state`)
    }
    if (!dispatch) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    const [operation, cost] = await Promise.all([
      options.repository.getAgentSpikeOperationOutcome(actorId, operationId),
      options.repository.getAgentRunCost?.(actorId, projectId, dispatch.taskId) ?? null,
    ])
    return c.json({ run: durableRun(operation, cost, dispatch) })
  }

  app.post('/:projectId/agent/runs/:operationId/pause', control('pause'))
  app.post('/:projectId/agent/runs/:operationId/resume', control('resume'))
  app.post('/:projectId/agent/runs/:operationId/cancel', control('cancel'))

  app.post('/:projectId/agent/runs/:operationId/attachments-ready', async c => {
    if (!options.dispatcher || !options.repository.finalizeAgentRunAttachments) {
      throw new ApiError(503, 'AGENT_UPLOAD_FINALIZE_UNAVAILABLE', 'Agent attachment finalization is unavailable')
    }
    const actorId = c.get('actorId')
    const projectId = c.req.param('projectId')
    const operationId = c.req.param('operationId')
    if (!projectId || !operationId) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    const result = await options.repository.finalizeAgentRunAttachments(
      actorId,
      projectId,
      operationId,
      options.modelConfig?.now?.() ?? new Date(),
    )
    if (!result) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    if (result.dispatch.state === 'queued' && result.dispatch.desiredState === 'running') options.dispatcher.wake()
    const [operation, cost] = await Promise.all([
      options.repository.getAgentSpikeOperationOutcome(actorId, operationId),
      options.repository.getAgentRunCost?.(actorId, projectId, result.dispatch.taskId) ?? null,
    ])
    return c.json({ run: durableRun(operation, cost, result.dispatch) })
  })

  app.post('/:projectId/agent/runs/:operationId/undo', async c => {
    if (!options.repository.undoAgentSpikeOperation) {
      throw new ApiError(503, 'AGENT_UNDO_UNAVAILABLE', 'Agent operation undo is unavailable')
    }
    const result = await options.repository.undoAgentSpikeOperation(
      c.get('actorId'),
      c.req.param('projectId'),
      c.req.param('operationId'),
    )
    if (result === 'conflict') {
      throw new ApiError(409, 'AGENT_UNDO_STALE', 'The draft changed after this Agent operation')
    }
    if (result === 'invalid_state') {
      throw new ApiError(409, 'AGENT_UNDO_INVALID_STATE', 'This Agent operation cannot be undone')
    }
    if (!result) throw new ApiError(404, 'AGENT_RUN_NOT_FOUND', 'Agent run not found')
    return c.json({
      project: result.project,
      rolledBackAt: result.rolledBackAt.toISOString(),
      receipt: result.receipt,
    })
  })

  return app
}
