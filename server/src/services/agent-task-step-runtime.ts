import { createHash } from 'node:crypto'
import {
  resolveDashboardActiveDocumentId,
  resolveDashboardActiveRootNodeId,
} from '../agent/canonical-dashboard-document.js'
import {
  AgentChangeSetProviderError,
  AgentChangeSetProviderResponseError,
  agentAllowedOperationTypesForRequest,
  createAgentClarificationHistoryProviderInputSnapshot,
  createAgentContinuationProviderInputSnapshot,
  createAgentProviderInputSnapshot,
  estimateAgentProviderInputTokens,
  requestAgentChangeSet,
} from '../agent/change-set-model.js'
import { agentChangeSetModelOutputSchema, planStrictChangeSet } from '../agent/change-set-planner.js'
import {
  AgentTaskPlanningProviderError,
  AgentTaskPlanningProviderResponseError,
  agentTaskPlanningDecisionSchema,
  requestAgentTaskPlanningDecision,
} from '../agent/task-planning-model.js'
import { canonicalJsonSha256 } from '../db/agent-stage-commit.js'
import type { AppEnv } from '../env.js'
import { ApiError } from '../http.js'
import { type ResolvedAgentModelRuntime, resolveAgentModelRuntime } from '../routes/agent-config.js'
import {
  persistedPlanningInputSchema,
  providerSettlementEstimateMicros,
  resolveAttachments,
  resolveModelImages,
} from '../routes/agent-runs.js'
import {
  type AgentSpikeRouteOptions,
  type IssuedAgentSpikeOperation,
  issueAgentSpikeOperation,
} from '../routes/agent-spike.js'
import type {
  AgentProviderAttemptSettlementResult,
  AgentSpikeOperationRecord,
  AgentTaskRunDetailRecord,
  DurableProviderAttemptRecord,
  ProjectRecord,
  Repository,
} from '../types.js'
import type { AgentRunDispatcher } from './agent-run-dispatcher.js'
import type {
  AgentTaskActionResult,
  AgentTaskObservationResult,
  AgentTaskTransitionClaim,
  AgentTaskVerificationResult,
} from './agent-task-orchestrator.js'

type StepRuntimeEnv = Pick<
  AppEnv,
  | 'EASY_EDITOR_AGENT_BASE_URL'
  | 'EASY_EDITOR_AGENT_API_KEY'
  | 'EASY_EDITOR_AGENT_MODEL'
  | 'AGENT_MODEL_PROFILE_ENCRYPTION_KEY'
  | 'AGENT_BILLING_MAX_USD_PER_1M_TOKENS'
>

export interface AgentTaskStepRuntimeOptions {
  repository: Repository
  dispatcher: Pick<AgentRunDispatcher, 'enqueue' | 'get'>
  spike: AgentSpikeRouteOptions
  env: StepRuntimeEnv
  workerId: string
  model?: typeof requestAgentChangeSet
  planningModel?: typeof requestAgentTaskPlanningDecision
  resolveRuntime?: typeof resolveAgentModelRuntime
  issueOperation?: (
    options: AgentSpikeRouteOptions,
    actorId: string,
    projectId: string,
    value: Parameters<typeof issueAgentSpikeOperation>[3],
  ) => Promise<IssuedAgentSpikeOperation>
  now?: () => Date
  wait?: (milliseconds: number) => Promise<void>
  dispatchWaitMs?: number
  dispatchPollMs?: number
}

export interface AgentTaskStepRuntime {
  act(transition: AgentTaskTransitionClaim): Promise<AgentTaskActionResult>
  observe(transition: AgentTaskTransitionClaim): Promise<AgentTaskObservationResult>
  verify(transition: AgentTaskTransitionClaim): Promise<AgentTaskVerificationResult>
}

const MAX_RESERVED_MICROS = 2_147_483_647
const DEFAULT_DISPATCH_WAIT_MS = 330_000
const DEFAULT_DISPATCH_POLL_MS = 100

function stableIdentifier(prefix: string, value: unknown): string {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40)}`
}

function stableSemanticId(value: unknown): string {
  const hex = createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function attemptCounters(
  _detail: AgentTaskRunDetailRecord,
  transition: AgentTaskTransitionClaim,
  dispatchAttemptCount?: number,
) {
  return {
    executorRetryCount: Math.max(0, (dispatchAttemptCount ?? 1) - 1),
    semanticRevisionCount: nonnegativeInteger(transition.input.semanticRevisionCount) ?? 0,
  }
}

function transitionFence(transition: AgentTaskTransitionClaim, workerId: string) {
  if (!transition.leaseToken) throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent task lease is unavailable')
  return {
    kind: 'transition' as const,
    transitionId: transition.id,
    workerId,
    leaseGeneration: transition.leaseGeneration,
    leaseToken: transition.leaseToken,
  }
}

function requireRepositoryMethod<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`Agent task step runtime requires repository.${name}`)
  return value
}

function requireSettlement(
  value: AgentProviderAttemptSettlementResult | 'stale',
): AgentProviderAttemptSettlementResult {
  if (value === 'stale') throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent task lease is stale')
  return value
}

function currentStep(detail: AgentTaskRunDetailRecord, transition: AgentTaskTransitionClaim) {
  const step = detail.activePlan?.steps.find(candidate => candidate.id === transition.stepId)
  if (!step) throw new ApiError(409, 'AGENT_TASK_STEP_UNAVAILABLE', 'Current Agent task step is unavailable')
  return step
}

function decisionCheckpoint(value: Record<string, unknown> | null | undefined) {
  if (!value || value.purpose !== 'step_action') return null
  const parsed = agentChangeSetModelOutputSchema.safeParse(value.output)
  return parsed.success ? parsed.data : null
}

function runtimeConfigDigest(runtime: ResolvedAgentModelRuntime): string {
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

function operationObservation(operation: AgentSpikeOperationRecord): Readonly<Record<string, unknown>> {
  const cleanEvidence = previewEvidence(operation.evidence)
  return {
    operationId: operation.operationId,
    outcome: operation.status,
    committedDraftVersion: operation.committedDraftVersion,
    receiptPresent: Boolean(operation.status === 'committed' && operation.id && operation.hostReceipt),
    preview: {
      renderReady: cleanEvidence.renderReady,
      browserErrorCount: cleanEvidence.browserErrors.length,
      resourceErrorCount: cleanEvidence.resourceErrors.length,
      materialGapCount: cleanEvidence.materialGapCount,
      ...(cleanEvidence.missingMaterialIds.length ? { missingMaterialIds: cleanEvidence.missingMaterialIds } : {}),
      ...(cleanEvidence.layoutStatus
        ? { layout: { status: cleanEvidence.layoutStatus, counts: cleanEvidence.layoutCounts } }
        : {}),
    },
  }
}

function previewEvidence(evidence: Record<string, unknown> | null): {
  renderReady: boolean
  browserErrors: unknown[]
  resourceErrors: unknown[]
  materialGapCount: number
  missingMaterialIds: string[]
  layoutStatus: 'passed' | 'failed' | null
  layoutCounts: Record<string, number>
} {
  const render = record(evidence?.render)
  const layout = record(render?.layout)
  const materials = record(evidence?.materials)
  const browserErrors = Array.isArray(evidence?.consoleErrors) ? evidence.consoleErrors : []
  const requestFailures = Array.isArray(evidence?.requestFailures) ? evidence.requestFailures : []
  const resourceErrors = Array.isArray(render?.resourceErrors) ? render.resourceErrors : []
  const missing = Array.isArray(materials?.missing) ? materials.missing : []
  const missingMaterialIds = missing.slice(0, 24).flatMap(value => {
    const id = stringValue(value)
    return id && id.length <= 160 && /^[A-Za-z0-9@._:/-]+$/u.test(id) ? [id] : []
  })
  return {
    renderReady:
      render?.rendererReady === true &&
      render.status === 'rendered' &&
      typeof render.screenshotSha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(render.screenshotSha256),
    browserErrors: [...browserErrors, ...requestFailures],
    resourceErrors,
    materialGapCount: missing.length,
    missingMaterialIds,
    layoutStatus: layout?.status === 'passed' || layout?.status === 'failed' ? layout.status : null,
    layoutCounts: Object.fromEntries(
      [
        'componentElementCount',
        'visibleElementCount',
        'hiddenElementCount',
        'zeroAreaElementCount',
        'overflowingElementCount',
        'clippedElementCount',
      ].flatMap(key =>
        typeof layout?.[key] === 'number' && Number.isSafeInteger(layout[key]) && layout[key] >= 0
          ? [[key, layout[key]]]
          : [],
      ),
    ),
  }
}

function recoveryClass(operation: AgentSpikeOperationRecord): AgentTaskActionResult['recoveryClass'] {
  if (operation.status === 'committed') return 'committed'
  if (operation.status === 'rejected_stale') return 'replan_remaining'
  if (operation.status === 'indeterminate') return 'terminal'
  if (operation.status === 'failed_not_applied') return 'revise_step'
  return 'recover_operation'
}

function publicChangeActivity(operations: readonly { type: string }[]) {
  const counts: NonNullable<AgentTaskActionResult['changeCounts']> = {}
  const publicKind = (type: string): keyof NonNullable<AgentTaskActionResult['changeCounts']> | null => {
    if (type === 'insert') return 'add'
    if (type === 'set' || type === 'unset') return 'configure'
    if (type === 'move' || type === 'resize' || type === 'reorder' || type === 'remove') return type
    return null
  }
  for (const operation of operations) {
    const kind = publicKind(operation.type)
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1
  }
  const labels: Record<keyof NonNullable<AgentTaskActionResult['changeCounts']>, string> = {
    add: '添加',
    configure: '修改配置',
    move: '移动',
    resize: '调整尺寸',
    reorder: '调整顺序',
    remove: '移除',
  }
  const summary = Object.entries(counts)
    .map(([kind, count]) => `${labels[kind as keyof typeof labels]} ${count} 项`)
    .join('、')
  return { userSummary: summary || '应用当前步骤修改', changeCounts: counts }
}

function operationIdFromTransition(transition: AgentTaskTransitionClaim): string | null {
  return (
    stringValue(transition.input.operationId) ??
    stringValue(record(transition.input.action)?.operationId) ??
    stringValue(record(transition.input.observation)?.operationId)
  )
}

function recoveryFromTransition(transition: AgentTaskTransitionClaim): string {
  return (
    stringValue(transition.input.recoveryClass) ??
    stringValue(record(transition.input.action)?.recoveryClass) ??
    stringValue(record(transition.input.observation)?.recoveryClass) ??
    'terminal'
  )
}

function observationFromTransition(transition: AgentTaskTransitionClaim): Readonly<Record<string, unknown>> {
  return (
    record(transition.input.observation) ??
    record(record(transition.input.action)?.observation) ??
    ({ outcome: 'unavailable' } as const)
  )
}

function projectedTaskContext(snapshot: { userText: string }) {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(snapshot.userText) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid task context')
    payload = parsed as Record<string, unknown>
  } catch {
    throw new ApiError(409, 'AGENT_TASK_SNAPSHOT_INVALID', 'Frozen Agent task context is unavailable')
  }
  const projectContext = Array.isArray(payload.projectContext)
    ? payload.projectContext.flatMap(value => {
        const item = record(value)
        const title = stringValue(item?.title)
        const content = stringValue(item?.content)
        const status = item?.status
        return title && content && (status === 'pending' || status === 'confirmed')
          ? [{ title, content, status: status as 'pending' | 'confirmed' }]
          : []
      })
    : []
  return { projectContext }
}

async function frozenTaskContext(
  options: AgentTaskStepRuntimeOptions,
  transition: AgentTaskTransitionClaim,
  detail: AgentTaskRunDetailRecord,
  planningInput: Record<string, unknown>,
  runtime: ResolvedAgentModelRuntime,
  prompt: string,
  project: ProjectRecord,
) {
  const frozen = persistedPlanningInputSchema.parse(planningInput)
  const attachmentIds = [
    ...new Set([
      ...frozen.attachmentIds,
      ...frozen.clarificationHistory.flatMap(clarification => clarification.attachmentIds),
    ]),
  ]
  const attachments = await resolveAttachments(
    options.repository,
    transition.actorId,
    transition.projectId,
    detail.run.conversationId,
    attachmentIds,
  )
  const images = await resolveModelImages(
    options.repository,
    transition.actorId,
    transition.projectId,
    attachments,
    runtime.capabilities.vision,
  )
  const expectedImages = [
    ...new Map(
      [...frozen.providerInputSnapshot.images, ...frozen.clarificationHistory.flatMap(item => item.images)].map(
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
  const sourceSnapshot = frozen.clarificationHistory.length
    ? createAgentClarificationHistoryProviderInputSnapshot(
        frozen.providerInputSnapshot,
        frozen.clarificationHistory,
        attachments,
        images.map(image => ({ assetId: image.assetId, sha256: image.sha256 })),
      )
    : frozen.providerInputSnapshot
  const projected = projectedTaskContext(sourceSnapshot)
  return {
    attachments,
    images,
    projectContext: projected.projectContext,
    providerInputSnapshot: createAgentContinuationProviderInputSnapshot(sourceSnapshot, { prompt, project }),
  }
}

async function waitForOperation(
  options: AgentTaskStepRuntimeOptions,
  transition: AgentTaskTransitionClaim,
  operationId: string,
): Promise<AgentSpikeOperationRecord> {
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const deadline = Date.now() + (options.dispatchWaitMs ?? DEFAULT_DISPATCH_WAIT_MS)
  let operation = await options.repository.getAgentSpikeOperationOutcome(transition.actorId, operationId)
  while (operation && (operation.status === 'issued' || operation.status === 'prepared') && Date.now() < deadline) {
    const dispatch = await options.dispatcher.get(transition.actorId, transition.projectId, operationId)
    if (dispatch?.state === 'indeterminate') break
    if (dispatch?.state === 'failed' || dispatch?.state === 'canceled') break
    await wait(options.dispatchPollMs ?? DEFAULT_DISPATCH_POLL_MS)
    operation = await options.repository.getAgentSpikeOperationOutcome(transition.actorId, operationId)
  }
  if (!operation) throw new ApiError(409, 'AGENT_OPERATION_NOT_FOUND', 'Durable Agent operation is unavailable')
  return operation
}

export function createAgentTaskStepRuntime(options: AgentTaskStepRuntimeOptions): AgentTaskStepRuntime {
  const now = options.now ?? (() => new Date())
  const model = options.model ?? requestAgentChangeSet
  const planningModel = options.planningModel ?? requestAgentTaskPlanningDecision
  const resolveRuntime = options.resolveRuntime ?? resolveAgentModelRuntime
  const issueOperation = options.issueOperation ?? issueAgentSpikeOperation

  const replanRemaining = async (transition: AgentTaskTransitionClaim): Promise<AgentTaskObservationResult> => {
    const getDetail = requireRepositoryMethod(options.repository.getAgentTaskRunDetail, 'getAgentTaskRunDetail')
    const getPlanningInput = requireRepositoryMethod(
      options.repository.getAgentTaskPlanningInput,
      'getAgentTaskPlanningInput',
    )
    const [detail, planningInput, project] = await Promise.all([
      getDetail(transition.actorId, transition.projectId, transition.taskRunId),
      getPlanningInput(transition.actorId, transition.projectId, transition.taskRunId),
      options.repository.getProject(transition.actorId, transition.projectId),
    ])
    if (!detail?.activePlan || !planningInput || !project) {
      return {
        action: 'terminal',
        summary: '无法恢复原始规划上下文，剩余步骤已安全停止。',
        code: 'replan_context_unavailable',
        observation: observationFromTransition(transition),
      }
    }
    const originalRequirement = stringValue(planningInput.prompt)
    if (!originalRequirement) {
      return {
        action: 'terminal',
        summary: '原始任务目标不可用，剩余步骤已安全停止。',
        code: 'replan_requirement_unavailable',
        observation: observationFromTransition(transition),
      }
    }
    const checkpoint = await options.repository.getAgentTaskTransitionProviderResult?.(
      transition.actorId,
      transition.taskRunId,
      transition.id,
    )
    let decision =
      checkpoint?.decisionOutput.purpose === 'replan_remaining'
        ? agentTaskPlanningDecisionSchema.safeParse(checkpoint.decisionOutput.output)
        : null
    if (checkpoint && !decision?.success) {
      return {
        action: 'terminal',
        summary: '剩余步骤规划记录无法安全重放，任务已停止。',
        code: 'replan_checkpoint_invalid',
        observation: observationFromTransition(transition),
      }
    }

    if (!decision?.success) {
      const runtime = await resolveRuntime(options, transition.actorId, transition.projectId)
      if (
        runtime.provider !== detail.run.provider ||
        runtime.model !== detail.run.model ||
        runtime.profileId !== detail.run.profileId ||
        runtimeConfigDigest(runtime) !== detail.run.configDigest
      ) {
        return {
          action: 'terminal',
          summary: '模型配置已变化，无法安全重规划剩余步骤。',
          code: 'replan_model_binding_drift',
          observation: observationFromTransition(transition),
        }
      }
      const passedSteps = detail.activePlan.steps
        .filter(step => step.status === 'passed')
        .map(step => ({
          semanticKey: stringValue(step.intent.purpose) ?? step.semanticStepKey,
          title: step.title,
        }))
      const failedObservation = observationFromTransition(transition)
      const clarifications = Array.isArray(planningInput.clarificationHistory)
        ? planningInput.clarificationHistory.slice(0, 8).flatMap(item => {
            const clarification = record(item)
            const question = record(clarification?.question)
            const questionText = stringValue(question?.text)
            const response = stringValue(clarification?.response)
            return questionText && response ? [{ question: questionText, response }] : []
          })
        : []
      const prompt = [
        `原始任务：${originalRequirement}`,
        ...(clarifications.length ? [`已确认的补充信息：${JSON.stringify(clarifications)}`] : []),
        `已完成且不得重复的步骤：${JSON.stringify(passedSteps)}`,
        `失败观察：${JSON.stringify(failedObservation)}`,
        '请基于当前最新文档，仅规划尚未完成的剩余工作。',
      ].join('\n')
      const taskContext = await frozenTaskContext(options, transition, detail, planningInput, runtime, prompt, project)
      const providerInputSnapshot = taskContext.providerInputSnapshot
      const maximumRate = options.env.AGENT_BILLING_MAX_USD_PER_1M_TOKENS ?? 100
      const estimatedMicros = Math.min(
        MAX_RESERVED_MICROS,
        Math.ceil(estimateAgentProviderInputTokens(providerInputSnapshot) * maximumRate),
      )
      const fence = transitionFence(transition, options.workerId)
      const attemptState: { current: DurableProviderAttemptRecord | null } = { current: null }
      try {
        const result = await planningModel({
          runtime,
          providerInputSnapshot,
          images: taskContext.images.map(image => ({ assetId: image.assetId, url: image.url })),
          providerAttemptLifecycle: {
            async prepare(metadata) {
              const prepare = requireRepositoryMethod(
                options.repository.prepareAgentProviderAttempt,
                'prepareAgentProviderAttempt',
              )
              const prepared = await prepare(transition.actorId, fence, {
                projectId: transition.projectId,
                taskId: detail.run.taskId,
                turnId: transition.transitionKey,
                providerRequestKey: metadata.providerRequestKey ?? null,
                requestBodyDigest: metadata.requestBodyDigest,
                idempotencyMode: metadata.idempotencyMode,
                reservedMicros: estimatedMicros,
                now: now(),
              })
              if (prepared === 'stale') {
                throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent task lease is stale')
              }
              if (prepared === 'outcome_unknown') {
                throw new ApiError(409, 'AGENT_PROVIDER_BILLING_INDETERMINATE', 'Provider outcome is unknown')
              }
              if (prepared === 'task_budget_exceeded' || prepared === 'project_budget_exceeded') {
                throw new ApiError(429, 'AGENT_TASK_BUDGET_EXCEEDED', 'Agent task budget is exhausted')
              }
              attemptState.current = prepared
              return {
                ...(prepared.providerRequestKey ? { providerRequestKey: prepared.providerRequestKey } : {}),
                requestBodyDigest: prepared.requestBodyDigest,
                idempotencyMode: prepared.idempotencyMode,
              }
            },
            async markStarted() {
              const current = attemptState.current
              if (!current) throw new Error('Provider attempt was not prepared')
              const markStarted = requireRepositoryMethod(
                options.repository.markAgentProviderAttemptStarted,
                'markAgentProviderAttemptStarted',
              )
              const started = await markStarted(transition.actorId, current.id, fence, now())
              if (!started) throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent task lease is stale')
              attemptState.current = started
            },
          },
        })
        if (!attemptState.current || !result.providerAttempt) {
          throw new ApiError(503, 'AGENT_PROVIDER_ATTEMPT_UNAVAILABLE', 'Provider attempt result is unavailable')
        }
        const totalTokens =
          result.usage?.totalTokens ??
          ((result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0) || undefined)
        const complete = requireRepositoryMethod(
          options.repository.completeAgentProviderAttempt,
          'completeAgentProviderAttempt',
        )
        const settled = requireSettlement(
          await complete(transition.actorId, attemptState.current.id, fence, {
            state: 'succeeded',
            providerAttempt: result.providerAttempt,
            decisionOutput: { purpose: 'replan_remaining', output: result.output },
            decisionUsage: result.usage ? { ...result.usage } : null,
            decisionTrace: { purpose: 'replan_remaining', transitionKey: transition.transitionKey, ...result.trace },
            observedTokens: totalTokens,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            cachedTokens: result.usage?.cachedTokens,
            estimatedMicros: Math.min(
              MAX_RESERVED_MICROS,
              providerSettlementEstimateMicros(estimatedMicros, totalTokens, maximumRate),
            ),
            now: now(),
          }),
        )
        if (settled.taskOutcomeClassification !== 'within_budget') {
          return {
            action: settled.taskOutcomeClassification === 'provider_outcome_unknown_paused' ? 'unknown' : 'terminal',
            ...(settled.taskOutcomeClassification === 'provider_outcome_unknown_paused'
              ? {}
              : { summary: '任务预算已用尽，剩余步骤已停止。', code: 'replan_budget_exhausted' }),
            observation: { ...failedObservation, replanOutcome: settled.taskOutcomeClassification },
          } as AgentTaskObservationResult
        }
        decision = { success: true, data: result.output }
      } catch (error) {
        const current = attemptState.current
        const complete = options.repository.completeAgentProviderAttempt
        if (current && complete && error instanceof AgentTaskPlanningProviderResponseError) {
          await complete(transition.actorId, current.id, fence, {
            state: error.classification === 'transient' ? 'failed_definite' : 'succeeded',
            providerAttempt: error.providerAttempt,
            ...(error.classification === 'invalid_output'
              ? {
                  decisionOutput: { purpose: 'replan_remaining', error: { code: 'provider_response_invalid' } },
                  decisionUsage: null,
                  decisionTrace: { purpose: 'replan_remaining', transitionKey: transition.transitionKey },
                }
              : {}),
            estimatedMicros,
            now: now(),
          })
          return {
            action: 'terminal',
            summary: '剩余步骤规划失败，任务已安全停止。',
            code: 'replan_provider_response_invalid',
            observation: failedObservation,
          }
        }
        if (current && complete && error instanceof AgentTaskPlanningProviderError) {
          const settled = requireSettlement(
            await complete(transition.actorId, current.id, fence, {
              state: error.providerAttempt.outcome,
              providerAttempt: error.providerAttempt,
              estimatedMicros,
              now: now(),
            }),
          )
          if (settled.taskOutcomeClassification === 'provider_outcome_unknown_paused') {
            return { action: 'unknown', observation: { ...failedObservation, replanOutcome: 'outcome_unknown' } }
          }
          return {
            action: 'terminal',
            summary: '剩余步骤规划服务暂时不可用，任务已安全停止。',
            code: 'replan_provider_failed',
            observation: failedObservation,
          }
        }
        if (error instanceof ApiError && error.code === 'AGENT_TASK_BUDGET_EXCEEDED') {
          return {
            action: 'terminal',
            summary: '任务预算已用尽，剩余步骤已停止。',
            code: 'replan_budget_exhausted',
            observation: failedObservation,
          }
        }
        if (error instanceof ApiError && error.code === 'AGENT_PROVIDER_BILLING_INDETERMINATE') {
          return { action: 'unknown', observation: { ...failedObservation, replanOutcome: 'outcome_unknown' } }
        }
        throw error
      }
    }

    if (decision.data.action === 'ask_user') {
      return {
        action: 'wait',
        summary: decision.data.summary,
        question: decision.data.question,
        observation: observationFromTransition(transition),
      }
    }
    const passedSemanticKeys = new Set(
      detail.activePlan.steps
        .filter(step => step.status === 'passed')
        .map(step => stringValue(step.intent.purpose) ?? step.semanticStepKey),
    )
    const remaining = decision.data.steps.filter(step => !passedSemanticKeys.has(step.semanticKey)).slice(0, 8)
    if (remaining.length === 0) {
      return {
        action: 'terminal',
        summary: '重规划结果没有可执行的剩余步骤，任务已停止。',
        code: 'replan_remaining_empty',
        observation: observationFromTransition(transition),
      }
    }
    return {
      action: 'replan',
      summary: decision.data.summary,
      observation: observationFromTransition(transition),
      plan: {
        action: 'execute',
        summary: decision.data.summary,
        assumptions: decision.data.assumptions,
        risks: decision.data.risks,
        verification: decision.data.verification,
        steps: remaining.map((step, index) => ({
          semanticId: stableSemanticId({
            taskRunId: transition.taskRunId,
            transitionKey: transition.transitionKey,
            semanticKey: step.semanticKey,
            ordinal: index + 1,
          }),
          ordinal: index + 1,
          title: step.title,
          intent: { purpose: step.semanticKey, description: step.intent },
        })),
      },
    }
  }

  const recoverMaterialGap = async (transition: AgentTaskTransitionClaim): Promise<AgentTaskObservationResult> => {
    const observation = observationFromTransition(transition)
    const getDetail = requireRepositoryMethod(options.repository.getAgentTaskRunDetail, 'getAgentTaskRunDetail')
    const detail = await getDetail(transition.actorId, transition.projectId, transition.taskRunId)
    const revisionCount = nonnegativeInteger(transition.input.semanticRevisionCount) ?? 0
    if (!detail) {
      return {
        action: 'material_gap',
        summary: '当前步骤缺少可用物料，且无法恢复任务上下文。',
        observation,
      }
    }
    if (revisionCount >= detail.run.bounds.maxStepRevisions) {
      return {
        action: 'material_gap',
        summary: '已尝试现有物料、结构化 Div 与局部场景兜底，仍无法表达当前内容。',
        observation,
      }
    }
    if (revisionCount === 0) {
      return {
        action: 'revise',
        summary: '缺少目标物料，正在优先改用已注册同类物料或结构化 Div。',
        observation,
      }
    }
    return replanRemaining(transition)
  }

  return {
    async act(transition) {
      const getDetail = requireRepositoryMethod(options.repository.getAgentTaskRunDetail, 'getAgentTaskRunDetail')
      const getPlanningInput = requireRepositoryMethod(
        options.repository.getAgentTaskPlanningInput,
        'getAgentTaskPlanningInput',
      )
      const [detail, planningInput] = await Promise.all([
        getDetail(transition.actorId, transition.projectId, transition.taskRunId),
        getPlanningInput(transition.actorId, transition.projectId, transition.taskRunId),
      ])
      if (!detail) throw new ApiError(404, 'AGENT_TASK_NOT_FOUND', 'Agent task run not found')
      if (!planningInput)
        throw new ApiError(409, 'AGENT_TASK_SNAPSHOT_INVALID', 'Frozen Agent task context is unavailable')
      const step = currentStep(detail, transition)
      const project = await options.repository.getProject(transition.actorId, transition.projectId)
      if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
      const runtime = await resolveRuntime(options, transition.actorId, transition.projectId)
      if (
        runtime.provider !== detail.run.provider ||
        runtime.model !== detail.run.model ||
        runtime.profileId !== detail.run.profileId ||
        runtimeConfigDigest(runtime) !== detail.run.configDigest
      ) {
        throw new ApiError(409, 'AGENT_MODEL_BINDING_DRIFT', 'Conversation model binding changed after task creation')
      }

      const priorOperationId = operationIdFromTransition(transition)
      if (priorOperationId) {
        const priorOperation = await options.repository.getAgentSpikeOperationOutcome(
          transition.actorId,
          priorOperationId,
        )
        if (priorOperation && priorOperation.status !== 'failed_not_applied') {
          if (priorOperation.status === 'issued' || priorOperation.status === 'prepared') {
            await options.dispatcher.enqueue(transition.actorId, {
              projectId: transition.projectId,
              conversationId: detail.run.conversationId,
              taskId: detail.run.taskId,
              operationId: priorOperationId,
            })
          }
          const operation =
            priorOperation.status === 'issued' || priorOperation.status === 'prepared'
              ? await waitForOperation(options, transition, priorOperationId)
              : priorOperation
          const dispatch = await options.dispatcher.get(transition.actorId, transition.projectId, priorOperationId)
          return {
            decisionKind: 'recover_operation',
            operationId: priorOperationId,
            observation: operationObservation(operation),
            recoveryClass: recoveryClass(operation),
            ...attemptCounters(detail, transition, dispatch?.attemptCount),
          }
        }
      }

      const checkpoint = await options.repository.getAgentTaskTransitionProviderResult?.(
        transition.actorId,
        transition.taskRunId,
        transition.id,
      )
      let output = decisionCheckpoint(checkpoint?.decisionOutput)
      let providerCallReference = checkpoint?.attemptId ?? null
      let trace: Awaited<ReturnType<typeof model>>['trace'] = {
        promptBundleId: 'agent-task-step-checkpoint',
        promptBundleVersion: '1',
        promptBundleHash: stableIdentifier('prompt', transition.transitionKey),
        skills: [],
      }

      if (checkpoint && !output) {
        return {
          decisionKind: 'provider_checkpoint_invalid',
          providerCallReference,
          observation: { outcome: 'checkpoint_invalid', errorCode: 'provider_checkpoint_invalid' },
          recoveryClass: 'terminal',
          ...attemptCounters(detail, transition),
        }
      }

      if (!output) {
        const recoveryObservation = observationFromTransition(transition)
        const missingMaterialIds = Array.isArray(record(recoveryObservation.preview)?.missingMaterialIds)
          ? (record(recoveryObservation.preview)?.missingMaterialIds as unknown[]).filter(
              value => typeof value === 'string',
            )
          : []
        const prompt = [
          `仅执行当前步骤：${step.title}`,
          `语义意图：${JSON.stringify(step.intent)}`,
          ...(Object.keys(recoveryObservation).length
            ? [`上一次执行观察：${JSON.stringify(recoveryObservation)}`]
            : []),
          ...(missingMaterialIds.length
            ? [
                `缺失物料：${JSON.stringify(missingMaterialIds)}`,
                '兜底顺序：优先选择目录中同语义的已注册物料；仅结构或装饰可使用 Div；普通物料无法表达的局部视觉才使用 DashboardScene。禁止用 Div 伪造业务数据组件，禁止整屏 DashboardScene。当前运行时不能创建在线组件或修改物料源码。',
              ]
            : []),
        ].join('\n')
        const taskContext = await frozenTaskContext(
          options,
          transition,
          detail,
          planningInput,
          runtime,
          prompt,
          project,
        )
        const snapshot = taskContext.providerInputSnapshot
        const maximumRate = options.env.AGENT_BILLING_MAX_USD_PER_1M_TOKENS ?? 100
        const estimatedMicros = Math.min(
          MAX_RESERVED_MICROS,
          Math.ceil(estimateAgentProviderInputTokens(snapshot) * maximumRate),
        )
        const fence = transitionFence(transition, options.workerId)
        const attemptState: { current: DurableProviderAttemptRecord | null } = { current: null }
        try {
          const result = await model({
            runtime,
            prompt,
            project,
            conversationId: detail.run.conversationId,
            taskId: detail.run.taskId,
            attachments: taskContext.attachments,
            projectContext: taskContext.projectContext,
            images: taskContext.images.map(image => ({ assetId: image.assetId, url: image.url })),
            providerInputSnapshot: snapshot,
            providerAttemptLifecycle: {
              async prepare(metadata) {
                const prepare = requireRepositoryMethod(
                  options.repository.prepareAgentProviderAttempt,
                  'prepareAgentProviderAttempt',
                )
                const prepared = await prepare(transition.actorId, fence, {
                  projectId: transition.projectId,
                  taskId: detail.run.taskId,
                  turnId: transition.transitionKey,
                  providerRequestKey: metadata.providerRequestKey ?? null,
                  requestBodyDigest: metadata.requestBodyDigest,
                  idempotencyMode: metadata.idempotencyMode,
                  reservedMicros: estimatedMicros,
                  now: now(),
                })
                if (prepared === 'stale')
                  throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent task lease is stale')
                if (prepared === 'outcome_unknown') {
                  throw new ApiError(409, 'AGENT_PROVIDER_BILLING_INDETERMINATE', 'Provider outcome is unknown')
                }
                if (prepared === 'task_budget_exceeded' || prepared === 'project_budget_exceeded') {
                  throw new ApiError(429, 'AGENT_TASK_BUDGET_EXCEEDED', 'Agent task budget is exhausted')
                }
                attemptState.current = prepared
                return {
                  ...(prepared.providerRequestKey ? { providerRequestKey: prepared.providerRequestKey } : {}),
                  requestBodyDigest: prepared.requestBodyDigest,
                  idempotencyMode: prepared.idempotencyMode,
                }
              },
              async markStarted() {
                const current = attemptState.current
                if (!current) throw new Error('Provider attempt was not prepared')
                const markStarted = requireRepositoryMethod(
                  options.repository.markAgentProviderAttemptStarted,
                  'markAgentProviderAttemptStarted',
                )
                const started = await markStarted(transition.actorId, current.id, fence, now())
                if (!started) throw new ApiError(409, 'AGENT_TASK_TRANSITION_STALE', 'Agent task lease is stale')
                attemptState.current = started
              },
            },
          })
          if (!attemptState.current || !result.providerAttempt) {
            throw new ApiError(503, 'AGENT_PROVIDER_ATTEMPT_UNAVAILABLE', 'Provider attempt result is unavailable')
          }
          const totalTokens =
            result.usage?.totalTokens ??
            ((result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0) || undefined)
          const complete = requireRepositoryMethod(
            options.repository.completeAgentProviderAttempt,
            'completeAgentProviderAttempt',
          )
          const settled = requireSettlement(
            await complete(transition.actorId, attemptState.current.id, fence, {
              state: 'succeeded',
              providerAttempt: result.providerAttempt,
              decisionOutput: { purpose: 'step_action', output: result.output },
              decisionUsage: result.usage ? { ...result.usage } : null,
              decisionTrace: { purpose: 'step_action', transitionKey: transition.transitionKey, ...result.trace },
              observedTokens: totalTokens,
              promptTokens: result.usage?.promptTokens,
              completionTokens: result.usage?.completionTokens,
              cachedTokens: result.usage?.cachedTokens,
              estimatedMicros: Math.min(
                MAX_RESERVED_MICROS,
                providerSettlementEstimateMicros(estimatedMicros, totalTokens, maximumRate),
              ),
              now: now(),
            }),
          )
          if (settled.taskOutcomeClassification !== 'within_budget') {
            return {
              decisionKind: 'budget_stop',
              providerCallReference: attemptState.current.id,
              observation: { outcome: 'budget_exhausted' },
              recoveryClass: 'terminal',
              ...attemptCounters(detail, transition),
            }
          }
          output = result.output
          providerCallReference = attemptState.current.id
          trace = result.trace
        } catch (error) {
          const current = attemptState.current
          const complete = options.repository.completeAgentProviderAttempt
          if (current && complete && error instanceof AgentChangeSetProviderResponseError) {
            await complete(transition.actorId, current.id, fence, {
              state: 'succeeded',
              providerAttempt: error.providerAttempt,
              decisionOutput: { purpose: 'step_action', error: { code: error.code } },
              decisionUsage: null,
              decisionTrace: { purpose: 'step_action', transitionKey: transition.transitionKey },
              estimatedMicros,
              now: now(),
            })
            return {
              decisionKind: 'provider_revision_required',
              providerCallReference: current.id,
              observation: { outcome: 'invalid_action', errorCode: error.code },
              recoveryClass: 'revise_step',
              ...attemptCounters(detail, transition),
            }
          }
          if (current && complete && error instanceof AgentChangeSetProviderError) {
            const settled = requireSettlement(
              await complete(transition.actorId, current.id, fence, {
                state: error.providerAttempt.outcome,
                providerAttempt: error.providerAttempt,
                estimatedMicros,
                now: now(),
              }),
            )
            return {
              decisionKind: 'provider_failure',
              providerCallReference: current.id,
              observation: { outcome: error.providerAttempt.outcome },
              recoveryClass:
                settled.taskOutcomeClassification === 'provider_outcome_unknown_paused' ? 'terminal' : 'revise_step',
              ...attemptCounters(detail, transition),
            }
          }
          throw error
        }
      }

      if (output.action === 'ask_user') {
        return {
          decisionKind: 'ask_user',
          providerCallReference,
          observation: { outcome: 'user_input_required', question: output.question },
          recoveryClass: 'user_action',
          ...attemptCounters(detail, transition),
        }
      }
      const operationId = stableIdentifier('task-operation', {
        taskRunId: transition.taskRunId,
        transitionKey: transition.transitionKey,
      })
      const identities = {
        sessionId: stableIdentifier('session', transition.taskRunId),
        stepId: stableIdentifier('step', transition.transitionKey),
        callId: stableIdentifier('call', transition.transitionKey),
        opIds: output.operations.map((_, index) => stableIdentifier('op', [transition.transitionKey, index])),
      }
      const invocation = planStrictChangeSet(output, resolveDashboardActiveDocumentId(project.draftSchema), {
        identities,
        immutableNodeIds: [resolveDashboardActiveRootNodeId(project.draftSchema)],
        document: project.draftSchema,
        allowedOperationTypes: agentAllowedOperationTypesForRequest(project.draftSchema, JSON.stringify(step.intent)),
      })
      const publicActivity = publicChangeActivity(invocation.arguments.operations)
      const issued = await issueOperation(options.spike, transition.actorId, transition.projectId, {
        executorId: 'easy-dashboard-document-executor',
        operationId,
        taskId: detail.run.taskId,
        stageId: 'apply-change-set',
        compatibility: options.spike.expectedCompatibility!,
        invocation,
        trace,
      })
      if (issued.operation.status === 'issued' || issued.operation.status === 'prepared') {
        await options.dispatcher.enqueue(transition.actorId, {
          projectId: transition.projectId,
          conversationId: detail.run.conversationId,
          taskId: detail.run.taskId,
          operationId,
        })
      }
      const operation = await waitForOperation(options, transition, operationId)
      const dispatch = await options.dispatcher.get(transition.actorId, transition.projectId, operationId)
      return {
        decisionKind: 'apply_change_set',
        providerCallReference,
        operationId,
        observation: operationObservation(operation),
        recoveryClass: recoveryClass(operation),
        ...publicActivity,
        ...attemptCounters(detail, transition, dispatch?.attemptCount),
      }
    },

    async observe(transition) {
      const observation = observationFromTransition(transition)
      const classification = recoveryFromTransition(transition)
      if (classification === 'committed' || classification === 'passed') {
        const preview = record(observation.preview)
        const layout = record(preview?.layout)
        if ((preview?.materialGapCount ?? 0) !== 0) {
          return recoverMaterialGap(transition)
        }
        if (layout?.status === 'failed') {
          return { action: 'revise', summary: '布局检查发现遮挡、溢出或不可见内容，正在修订当前步骤。', observation }
        }
        if ((preview?.browserErrorCount ?? 0) !== 0 || (preview?.resourceErrorCount ?? 0) !== 0) {
          return { action: 'revise', summary: '预览检查发现可恢复问题，正在修订当前步骤。', observation }
        }
        return { action: 'pass', summary: '当前步骤已提交并通过执行证据校验。', observation }
      }
      if (classification === 'retry_same' || classification === 'recover_operation') {
        return { action: 'revise', summary: '执行尚未形成确定结果，将在有界恢复后重试当前步骤。', observation }
      }
      if (classification === 'revise_step') {
        return { action: 'revise', summary: '当前操作未应用，正在修订当前步骤。', observation }
      }
      if (classification === 'replan_remaining') {
        return replanRemaining(transition)
      }
      if (classification === 'material_gap') {
        return recoverMaterialGap(transition)
      }
      if (classification === 'user_action') {
        return {
          action: 'wait',
          summary: '当前步骤需要补充信息后才能继续。',
          question: { id: `step-input-${transition.taskRunId}`, text: '请补充当前步骤所需的信息。' },
          observation,
        }
      }
      if (
        classification === 'terminal' &&
        (observation.outcome === 'outcome_unknown' || observation.outcome === 'indeterminate')
      ) {
        return { action: 'unknown', observation }
      }
      return {
        action: 'terminal',
        summary: '当前步骤无法安全恢复，任务已停止。',
        code: stringValue(observation.errorCode) ?? 'step_execution_failed',
        observation,
      }
    },

    async verify(transition) {
      const getDetail = requireRepositoryMethod(options.repository.getAgentTaskRunDetail, 'getAgentTaskRunDetail')
      const detail = await getDetail(transition.actorId, transition.projectId, transition.taskRunId)
      if (!detail?.activePlan) {
        return { action: 'terminal', summary: '最终校验缺少活动计划。', code: 'final_plan_unavailable' }
      }
      if (detail.activePlan.steps.some(step => step.status !== 'passed')) {
        return { action: 'terminal', summary: '仍有步骤未通过，无法完成任务。', code: 'final_steps_incomplete' }
      }
      const operationIds = detail.activePlan.steps.map(step => stringValue(step.lastObservation?.operationId))
      if (operationIds.some(operationId => !operationId)) {
        return { action: 'terminal', summary: '步骤缺少可验证的提交记录。', code: 'final_operation_unavailable' }
      }
      const operations = await Promise.all(
        operationIds.map(operationId =>
          options.repository.getAgentSpikeOperationOutcome(transition.actorId, operationId!),
        ),
      )
      if (operations.some(operation => !operation || operation.status === 'indeterminate')) {
        return { action: 'terminal', summary: '存在结果未知的操作，任务不能完成。', code: 'final_operation_unknown' }
      }
      if (operations.some(operation => operation?.status !== 'committed')) {
        return { action: 'terminal', summary: '存在未提交的操作，任务不能完成。', code: 'final_operation_uncommitted' }
      }
      const committed = operations as AgentSpikeOperationRecord[]
      const latest = committed.reduce((left, right) =>
        (right.committedDraftVersion ?? -1) > (left.committedDraftVersion ?? -1) ? right : left,
      )
      const project = await options.repository.getProject(transition.actorId, transition.projectId)
      const evidence = previewEvidence(latest.evidence)
      const receiptConsistent =
        latest.taskId === detail.run.taskId &&
        Boolean(latest.hostReceipt && latest.hostReceipt.status === 'applied') &&
        latest.committedDraftVersion === project?.draftVersion
      if (
        !latest.committedDraftVersion ||
        !project ||
        !receiptConsistent ||
        !evidence.renderReady ||
        evidence.browserErrors.length ||
        evidence.resourceErrors.length ||
        evidence.materialGapCount ||
        evidence.layoutStatus === 'failed'
      ) {
        return { action: 'terminal', summary: '最终执行证据未通过一致性校验。', code: 'final_evidence_invalid' }
      }
      return {
        action: 'pass',
        evidence: {
          operationId: latest.operationId,
          receiptId: latest.id,
          committedDraftVersion: latest.committedDraftVersion,
          verifiedAt: now().toISOString(),
          documentValid: true,
          renderReady: true,
          browserErrors: [],
          resourceErrors: [],
          ...(evidence.layoutStatus === 'passed' ? { layoutPassed: true as const } : {}),
          freshContextVerified: true,
          receiptConsistent: true,
        },
      }
    },
  }
}
