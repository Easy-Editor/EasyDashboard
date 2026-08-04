import { randomUUID } from 'node:crypto'
import { assertAgentDecisionUserTextSafe } from '../agent/conversation-policy.js'
import { ApiError } from '../http.js'
import type {
  AgentProjectTaskLeaseRecord,
  AgentTaskCompletionInput,
  AgentTaskFinalVerificationEvidence,
  AgentTaskRunDetailRecord,
} from '../types.js'
import type { AgentTaskObservability } from './agent-task-observability.js'
import type { AgentTaskReconciler } from './agent-task-reconciler.js'

export type AgentTaskTransitionKind = 'planning' | 'step_action' | 'observation' | 'final_verification' | 'rollback'

export interface AgentTaskTransitionClaim {
  id: string
  actorId: string
  taskRunId: string
  projectId: string
  stepId: string | null
  kind: AgentTaskTransitionKind
  transitionKey: string
  generation: number
  leaseGeneration: number
  leaseToken: string | null
  projectLeaseGeneration?: number | null
  projectLeaseToken?: string | null
  projectLeaseWorkerId?: string | null
  claimAttempts: number
  providerOutcome?: 'none' | 'started_unknown'
  input: Readonly<Record<string, unknown>>
}

export interface AgentTaskPlanStepInput {
  semanticId: string
  ordinal: number
  title: string
  intent: Readonly<Record<string, unknown>>
}

export interface AgentTaskExecutablePlan {
  action: 'execute'
  summary: string
  assumptions: readonly string[]
  risks: readonly string[]
  verification: Readonly<Record<string, unknown>>
  steps: readonly AgentTaskPlanStepInput[]
}

export interface AgentTaskPlanningQuestion {
  action: 'ask_user'
  summary: string
  question: { id: string; text: string }
}

export type AgentTaskPlanningResult = AgentTaskExecutablePlan | AgentTaskPlanningQuestion

export type AgentTaskRecoveryClass =
  | 'retry_same'
  | 'recover_operation'
  | 'revise_step'
  | 'replan_remaining'
  | 'material_gap'
  | 'user_action'
  | 'terminal'
  | 'passed'
  | 'committed'

export interface AgentTaskActionResult {
  decisionKind: string
  /** Natural-language activity summary safe for the project activity stream. */
  userSummary?: string
  /** Aggregated public counts; never contains node ids, field paths, values, or coordinates. */
  changeCounts?: Partial<Record<'add' | 'configure' | 'move' | 'resize' | 'reorder' | 'remove', number>>
  providerCallReference?: string | null
  operationId?: string | null
  observation: Readonly<Record<string, unknown>>
  recoveryClass: AgentTaskRecoveryClass
  /** Authoritative cumulative counters for this step attempt when supplied by the runtime adapter. */
  executorRetryCount?: number
  semanticRevisionCount?: number
}

export type AgentTaskObservationResult =
  | { action: 'pass'; summary: string; observation: Readonly<Record<string, unknown>> }
  | { action: 'revise'; summary: string; observation: Readonly<Record<string, unknown>> }
  | { action: 'replan'; summary: string; observation: Readonly<Record<string, unknown>>; plan: AgentTaskExecutablePlan }
  | { action: 'material_gap'; summary: string; observation: Readonly<Record<string, unknown>> }
  | {
      action: 'wait'
      summary: string
      question: { id: string; text: string }
      observation: Readonly<Record<string, unknown>>
    }
  | { action: 'unknown'; observation: Readonly<Record<string, unknown>> }
  | { action: 'terminal'; summary: string; code: string; observation: Readonly<Record<string, unknown>> }

export type AgentTaskVerificationResult =
  | { action: 'pass'; evidence: AgentTaskFinalVerificationEvidence }
  | { action: 'revise' | 'replan'; summary: string; code: string }
  | { action: 'terminal'; summary: string; code: string }

export class AgentTaskPlanningFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly alreadyPersisted = false,
  ) {
    super(code)
    this.name = 'AgentTaskPlanningFailure'
  }
}

export interface AgentTaskPlanningCompletion {
  transition: AgentTaskTransitionClaim
  plan: AgentTaskExecutablePlan
  event: {
    eventKey: string
    type: 'plan_created'
    summary: string
    publicPayload: Readonly<Record<string, unknown>>
    technicalPayload: Readonly<Record<string, unknown>>
    redactionVersion: 1
  }
  nextTransition: {
    kind: 'step_action'
    stepOrdinal: number
    transitionKey: string
    input: Readonly<Record<string, unknown>>
  }
  now: Date
}

export interface AgentTaskTransitionFence {
  transitionId: string
  workerId: string
  leaseGeneration: number
  leaseToken: string
  projectLeaseGeneration?: number | null
  projectLeaseToken?: string | null
  projectLeaseWorkerId?: string | null
}

export interface AgentTaskOrchestratorStore {
  claimAgentTaskTransition(
    workerId: string,
    now: Date,
    leaseUntil: Date,
    kinds: readonly AgentTaskTransitionKind[],
  ): Promise<AgentTaskTransitionClaim | null>
  acquireNextAgentProjectTaskLease?(
    workerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<AgentProjectTaskLeaseRecord | null>
  getAgentTaskRunDetail?(
    actorId: string,
    projectId: string,
    taskRunId: string,
  ): Promise<AgentTaskRunDetailRecord | null>
  heartbeatAgentTaskTransition(
    actorId: string,
    fence: AgentTaskTransitionFence,
    now: Date,
    leaseUntil: Date,
  ): Promise<unknown | 'stale'>
  completeAgentTaskTransition(
    actorId: string,
    fence: AgentTaskTransitionFence,
    completion: AgentTaskCompletionInput,
  ): Promise<
    { transition: unknown; taskRun: unknown; nextTransition: unknown } | 'stale' | 'invalid_state' | 'conflict'
  >
  pauseAgentTaskTransitionUnknownOutcome(
    actorId: string,
    fence: AgentTaskTransitionFence,
    input: {
      now: Date
      event: {
        eventKey: string
        type: 'waiting_user'
        summary: string
        publicPayload: Readonly<Record<string, unknown>>
        technicalPayload: Readonly<Record<string, unknown>>
        redactionVersion: 1
      }
      operationalEvent: {
        dedupeKey: string
        code: 'provider_outcome_unknown'
        severity: 'critical'
        details: Readonly<Record<string, unknown>>
      }
    },
  ): Promise<{ transition: unknown; classification: 'provider_outcome_unknown_paused' } | 'stale' | 'invalid_state'>
  releaseAgentTaskTransition(actorId: string, fence: AgentTaskTransitionFence, now: Date): Promise<unknown | 'stale'>
}

export interface AgentTaskOrchestrator {
  runOnce(): Promise<boolean>
  start(): void
  stop(): Promise<void>
  wake(): void
}

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_POLL_MS = 1_000
const NON_PLANNING_KINDS = ['step_action', 'observation', 'final_verification'] as const
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const SENSITIVE_OBSERVATION_KEY =
  /(?:secret|token|authorization|api.?key|password|stack|raw|nodeId|fieldId|fieldPath|changeSet|operations)/i

function boundedCounter(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function sanitizeObservationValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return value.slice(0, 500)
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map(item => sanitizeObservationValue(item, depth + 1))
      .filter(item => item !== undefined)
  }
  if (!value || typeof value !== 'object') return undefined
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_OBSERVATION_KEY.test(key))
      .slice(0, 40)
      .flatMap(([key, item]) => {
        const sanitized = sanitizeObservationValue(item, depth + 1)
        return sanitized === undefined ? [] : [[key, sanitized]]
      }),
  )
}

function sanitizedObservation(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return sanitizeObservationValue(value) as Record<string, unknown>
}

function safeReference(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null) return null
  if (!SAFE_REFERENCE.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function assertExecutablePlan(plan: AgentTaskExecutablePlan): void {
  if (plan.steps.length === 0 || plan.steps.length > 8) throw new Error('Agent task plan must contain 1 to 8 steps')
  const semanticIds = new Set(plan.steps.map(step => step.semanticId))
  if (
    semanticIds.size !== plan.steps.length ||
    plan.steps.some((step, index) => !Number.isInteger(step.ordinal) || step.ordinal !== index + 1)
  ) {
    throw new Error('Agent task plan step identities or ordinals are invalid')
  }
  assertAgentDecisionUserTextSafe({
    summary: plan.summary,
    plan: [
      ...plan.steps.flatMap(step => [
        step.title,
        ...Object.values(step.intent).filter(value => typeof value === 'string'),
      ]),
      ...plan.assumptions,
      ...plan.risks,
      ...Object.values(plan.verification).flatMap(value =>
        typeof value === 'string'
          ? [value]
          : Array.isArray(value)
            ? value.filter(item => typeof item === 'string')
            : [],
      ),
    ],
  })
}

function deterministicVerificationEvidence(value: AgentTaskFinalVerificationEvidence): boolean {
  return (
    SAFE_REFERENCE.test(value.operationId) &&
    SAFE_REFERENCE.test(value.receiptId) &&
    Number.isSafeInteger(value.committedDraftVersion) &&
    value.committedDraftVersion > 0 &&
    !Number.isNaN(Date.parse(value.verifiedAt)) &&
    value.documentValid === true &&
    value.renderReady === true &&
    Array.isArray(value.browserErrors) &&
    value.browserErrors.length === 0 &&
    Array.isArray(value.resourceErrors) &&
    value.resourceErrors.length === 0 &&
    value.freshContextVerified === true &&
    value.receiptConsistent === true
  )
}

function transitionFence(
  transition: AgentTaskTransitionClaim,
  workerId: string,
  leaseToken: string,
): AgentTaskTransitionFence {
  const projectFence =
    transition.projectLeaseGeneration !== null &&
    transition.projectLeaseGeneration !== undefined &&
    transition.projectLeaseToken &&
    transition.projectLeaseWorkerId
      ? {
          projectLeaseGeneration: transition.projectLeaseGeneration,
          projectLeaseToken: transition.projectLeaseToken,
          projectLeaseWorkerId: transition.projectLeaseWorkerId,
        }
      : {}
  return {
    transitionId: transition.id,
    workerId,
    leaseGeneration: transition.leaseGeneration,
    leaseToken,
    ...projectFence,
  }
}

export function createAgentTaskOrchestrator(options: {
  store: AgentTaskOrchestratorStore
  reconciler: AgentTaskReconciler
  observability: AgentTaskObservability
  plan?(transition: AgentTaskTransitionClaim): Promise<AgentTaskPlanningResult>
  act?(transition: AgentTaskTransitionClaim): Promise<AgentTaskActionResult>
  observe?(transition: AgentTaskTransitionClaim): Promise<AgentTaskObservationResult>
  verify?(transition: AgentTaskTransitionClaim): Promise<AgentTaskVerificationResult>
  workerId?: string
  leaseMs?: number
  heartbeatMs?: number
  pollMs?: number
  shutdownGraceMs?: number
  now?: () => Date
  logger?: Pick<Console, 'error'>
}): AgentTaskOrchestrator {
  const workerId = options.workerId ?? `agent-task-worker-${randomUUID()}`
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(leaseMs / 3))
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const shutdownGraceMs = options.shutdownGraceMs ?? 10_000
  const now = options.now ?? (() => new Date())
  const logger = options.logger ?? console
  let started = false
  let stopping = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let draining: Promise<void> | null = null
  let active: Promise<'continue' | 'retry' | 'stop'> | null = null
  let activeTransition: AgentTaskTransitionClaim | null = null
  const hasWorker = Boolean(options.plan || options.act || options.observe || options.verify)

  const leaseUntil = (at: Date) => new Date(at.getTime() + leaseMs)
  const hasUnknownProviderOutcome = (transition: AgentTaskTransitionClaim) =>
    transition.providerOutcome === 'started_unknown' || transition.input.providerOutcome === 'started_unknown'

  const release = (transition: AgentTaskTransitionClaim) =>
    transition.leaseToken
      ? options.store.releaseAgentTaskTransition(
          transition.actorId,
          transitionFence(transition, workerId, transition.leaseToken),
          now(),
        )
      : Promise.reject(new Error('Claimed Agent task transition is missing its lease token'))

  class Phase3CompletionError extends Error {
    constructor(public readonly classification: 'stale' | 'invalid_state' | 'conflict') {
      super(`phase3_completion_${classification}`)
      this.name = 'Phase3CompletionError'
    }
  }

  const completePhase3 = async (transition: AgentTaskTransitionClaim, completion: AgentTaskCompletionInput) => {
    if (!transition.leaseToken) throw new Error('Claimed Agent task transition is missing its lease token')
    const completed = await options.store.completeAgentTaskTransition(
      transition.actorId,
      transitionFence(transition, workerId, transition.leaseToken),
      completion,
    )
    if (completed === 'stale' || completed === 'invalid_state' || completed === 'conflict') {
      throw new Phase3CompletionError(completed)
    }
    return completed
  }

  const executeAction = async (transition: AgentTaskTransitionClaim): Promise<'continue' | 'retry' | 'stop'> => {
    if (!options.act || !transition.stepId) {
      await release(transition)
      return 'stop'
    }
    const result = await options.act(transition)
    const observation = sanitizedObservation(result.observation)
    const decisionKind = safeReference(result.decisionKind, 'Agent task action decision')!
    const providerCallReference = safeReference(result.providerCallReference, 'Agent provider call reference')
    const operationId = safeReference(result.operationId, 'Agent operation id')
    const userSummary = result.userSummary?.trim() || null
    if (userSummary) assertAgentDecisionUserTextSafe({ summary: userSummary })
    const changeCounts = Object.fromEntries(
      (['add', 'configure', 'move', 'resize', 'reorder', 'remove'] as const).flatMap(kind => {
        const count = result.changeCounts?.[kind]
        return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 && count <= 1_000
          ? [[kind, count]]
          : []
      }),
    )
    const previousExecutorRetryCount = boundedCounter(transition.input.executorRetryCount)
    const previousSemanticRevisionCount = boundedCounter(transition.input.semanticRevisionCount)
    const executorRetryCount =
      result.executorRetryCount === undefined ? previousExecutorRetryCount : boundedCounter(result.executorRetryCount)
    const semanticRevisionCount =
      result.semanticRevisionCount === undefined
        ? previousSemanticRevisionCount
        : boundedCounter(result.semanticRevisionCount)
    if (executorRetryCount < previousExecutorRetryCount || semanticRevisionCount < previousSemanticRevisionCount) {
      throw new Error('Agent task attempt counters regressed')
    }
    const nextTransitionKey = `observation:${transition.taskRunId}:${transition.generation}`
    const committed = result.recoveryClass === 'committed' || result.recoveryClass === 'passed'
    const events: NonNullable<AgentTaskCompletionInput['events']> = [
      {
        eventKey: `agent-task-event:${transition.id}:step-started`,
        stepId: transition.stepId,
        type: 'step_started',
        summary: userSummary ? `正在执行：${userSummary}` : '开始执行当前步骤',
        publicPayload: Object.keys(changeCounts).length ? { changeCounts } : {},
        technicalPayload: {},
        redactionVersion: 1,
      },
    ]
    if (committed) {
      events.push({
        eventKey: `agent-task-event:${transition.id}:change-committed`,
        stepId: transition.stepId,
        type: 'change_committed',
        summary: userSummary ? `已完成：${userSummary}` : '当前步骤的修改已提交',
        publicPayload: Object.keys(changeCounts).length ? { changeCounts } : {},
        technicalPayload: operationId ? { operationId } : {},
        redactionVersion: 1,
      })
    }
    await completePhase3(transition, {
      status: 'completed',
      output: { actionRecorded: true, recoveryClass: result.recoveryClass },
      taskRunPatch: { status: 'running', currentTransitionKey: nextTransitionKey },
      ...(executorRetryCount > previousExecutorRetryCount || semanticRevisionCount > previousSemanticRevisionCount
        ? {
            accountingDelta: {
              executorRetries: executorRetryCount - previousExecutorRetryCount,
              semanticRevisions: semanticRevisionCount - previousSemanticRevisionCount,
            },
          }
        : {}),
      stepPatch: { stepId: transition.stepId, status: committed ? 'verifying' : 'running' },
      stepAttempt: {
        stepId: transition.stepId,
        decisionKind,
        providerCallReference,
        operationId,
        executorRetryCount,
        semanticRevisionCount,
        observation,
        terminalClassification: result.recoveryClass,
      },
      events,
      nextTransition: {
        kind: 'observation',
        stepId: transition.stepId,
        transitionKey: nextTransitionKey,
        input: { observation, recoveryClass: result.recoveryClass, executorRetryCount, semanticRevisionCount },
      },
      now: now(),
    })
    return 'continue'
  }

  const terminalObservation = async (
    transition: AgentTaskTransitionClaim,
    input: {
      status: 'blocked_material' | 'paused' | 'failed'
      type: 'material_gap' | 'waiting_user' | 'task_failed'
      summary: string
      code: string
      observation: Record<string, unknown>
    },
  ): Promise<'continue'> => {
    assertAgentDecisionUserTextSafe({ summary: input.summary })
    await completePhase3(transition, {
      status: input.status === 'failed' ? 'failed' : 'completed',
      ...(input.status === 'failed' ? { error: { code: input.code, retryable: false } } : {}),
      taskRunPatch: { status: input.status, currentTransitionKey: null },
      ...(transition.stepId
        ? {
            stepPatch: {
              stepId: transition.stepId,
              status: input.status === 'failed' ? 'failed' : 'verifying',
              lastObservation: input.observation,
            },
          }
        : {}),
      events: [
        {
          eventKey: `agent-task-event:${transition.id}:${input.type}`,
          stepId: transition.stepId,
          type: input.type,
          summary: input.summary,
          publicPayload: { code: input.code },
          technicalPayload: {},
          redactionVersion: 1,
        },
      ],
      now: now(),
    })
    return 'continue'
  }

  const executeObservation = async (transition: AgentTaskTransitionClaim): Promise<'continue' | 'retry' | 'stop'> => {
    if (!options.observe || !transition.stepId || !options.store.getAgentTaskRunDetail) {
      await release(transition)
      return 'stop'
    }
    const result = await options.observe(transition)
    const observation = sanitizedObservation(result.observation)
    if (result.action === 'material_gap') {
      return terminalObservation(transition, {
        status: 'blocked_material',
        type: 'material_gap',
        summary: result.summary,
        code: 'material_gap',
        observation,
      })
    }
    if (result.action === 'wait') {
      assertAgentDecisionUserTextSafe({ summary: result.summary, question: result.question })
      await completePhase3(transition, {
        status: 'completed',
        taskRunPatch: { status: 'waiting_user', currentTransitionKey: null },
        stepPatch: { stepId: transition.stepId, status: 'verifying', lastObservation: observation },
        events: [
          {
            eventKey: `agent-task-event:${transition.id}:waiting-user`,
            stepId: transition.stepId,
            type: 'waiting_user',
            summary: result.summary,
            publicPayload: { question: result.question },
            technicalPayload: {},
            redactionVersion: 1,
          },
        ],
        now: now(),
      })
      return 'continue'
    }
    if (result.action === 'unknown') {
      return terminalObservation(transition, {
        status: 'paused',
        type: 'waiting_user',
        summary: '当前步骤的执行结果无法确认，任务已暂停。',
        code: 'observation_unknown',
        observation,
      })
    }
    if (result.action === 'terminal') {
      return terminalObservation(transition, {
        status: 'failed',
        type: 'task_failed',
        summary: result.summary,
        code: safeReference(result.code, 'Agent terminal code')!,
        observation,
      })
    }

    const detail = await options.store.getAgentTaskRunDetail(
      transition.actorId,
      transition.projectId,
      transition.taskRunId,
    )
    if (!detail?.activePlan) throw new Error('Agent task active plan is unavailable')
    const currentStep = detail.activePlan.steps.find(step => step.id === transition.stepId)
    if (!currentStep) throw new Error('Agent task observation step is unavailable')
    const semanticRevisionCount = boundedCounter(transition.input.semanticRevisionCount)

    if (result.action === 'pass') {
      assertAgentDecisionUserTextSafe({ summary: result.summary })
      const nextStep = [...detail.activePlan.steps]
        .filter(step => step.id !== transition.stepId && step.status === 'pending')
        .sort((left, right) => left.ordinal - right.ordinal)[0]
      const nextTransitionKey = nextStep
        ? `step-action:${transition.taskRunId}:${transition.generation}:${nextStep.ordinal}`
        : `final-verification:${transition.taskRunId}:${transition.generation}`
      await completePhase3(transition, {
        status: 'completed',
        taskRunPatch: {
          status: nextStep ? 'running' : 'verifying',
          currentTransitionKey: nextTransitionKey,
        },
        stepPatch: { stepId: transition.stepId, status: 'passed', lastObservation: observation },
        events: [
          {
            eventKey: `agent-task-event:${transition.id}:step-passed`,
            stepId: transition.stepId,
            type: 'step_passed',
            summary: result.summary,
            publicPayload: {},
            technicalPayload: {},
            redactionVersion: 1,
          },
        ],
        nextTransition: nextStep
          ? {
              kind: 'step_action',
              stepId: nextStep.id,
              transitionKey: nextTransitionKey,
              input: {
                planVersion: detail.activePlan.plan.version,
                stepOrdinal: nextStep.ordinal,
                semanticRevisionCount: 0,
              },
            }
          : {
              kind: 'final_verification',
              transitionKey: nextTransitionKey,
              input: { observation },
            },
        now: now(),
      })
      return 'continue'
    }

    const nextRevisionCount = semanticRevisionCount + 1
    if (nextRevisionCount > detail.run.bounds.maxStepRevisions) {
      return terminalObservation(transition, {
        status: 'failed',
        type: 'task_failed',
        summary: '当前步骤超过允许的修订次数，任务已停止。',
        code: 'step_revision_limit_exceeded',
        observation,
      })
    }

    if (result.action === 'revise') {
      assertAgentDecisionUserTextSafe({ summary: result.summary })
      const preview =
        observation.preview && typeof observation.preview === 'object'
          ? (observation.preview as Record<string, unknown>)
          : null
      const missingMaterials = Array.isArray(preview?.missingMaterialIds)
        ? preview.missingMaterialIds.filter(value => typeof value === 'string').slice(0, 20)
        : []
      const nextTransitionKey = `step-action:${transition.taskRunId}:${transition.generation}:revise-${nextRevisionCount}`
      await completePhase3(transition, {
        status: 'completed',
        taskRunPatch: { status: 'running', currentTransitionKey: nextTransitionKey },
        accountingDelta: { semanticRevisions: 1 },
        stepPatch: { stepId: transition.stepId, status: 'revising', lastObservation: observation },
        stepAttempt: {
          stepId: transition.stepId,
          decisionKind: 'observe_revise',
          semanticRevisionCount: nextRevisionCount,
          observation,
          terminalClassification: 'revise_step',
        },
        events: [
          ...(missingMaterials.length
            ? [
                {
                  eventKey: `agent-task-event:${transition.id}:fallback-selected`,
                  stepId: transition.stepId,
                  type: 'fallback_selected' as const,
                  summary: '目标物料不可用，正在选择已注册物料或结构化局部兜底',
                  publicPayload: { missingMaterials },
                  technicalPayload: {},
                  redactionVersion: 1,
                },
              ]
            : []),
          {
            eventKey: `agent-task-event:${transition.id}:step-revising`,
            stepId: transition.stepId,
            type: 'step_revising',
            summary: result.summary,
            publicPayload: {},
            technicalPayload: {},
            redactionVersion: 1,
          },
        ],
        nextTransition: {
          kind: 'step_action',
          stepId: transition.stepId,
          transitionKey: nextTransitionKey,
          input: { semanticRevisionCount: nextRevisionCount, recoveryClass: 'revise_step', observation },
        },
        now: now(),
      })
      return 'continue'
    }

    assertExecutablePlan(result.plan)
    assertAgentDecisionUserTextSafe({ summary: result.summary })
    const nextTransitionKey = `step-action:${transition.taskRunId}:${transition.generation}:replan-${nextRevisionCount}`
    await completePhase3(transition, {
      status: 'completed',
      taskRunPatch: { status: 'running', currentTransitionKey: nextTransitionKey },
      accountingDelta: { semanticRevisions: 1 },
      stepPatch: { stepId: transition.stepId, status: 'superseded', lastObservation: observation },
      stepAttempt: {
        stepId: transition.stepId,
        decisionKind: 'observe_replan',
        semanticRevisionCount: nextRevisionCount,
        observation,
        terminalClassification: 'replan_remaining',
      },
      plan: {
        summary: result.plan.summary,
        assumptions: result.plan.assumptions,
        verification: { ...result.plan.verification, risks: result.plan.risks },
        steps: result.plan.steps.map(step => ({
          id: step.semanticId,
          ordinal: step.ordinal,
          title: step.title,
          intent: { ...step.intent },
        })),
      },
      events: [
        {
          eventKey: `agent-task-event:${transition.id}:step-superseded`,
          stepId: transition.stepId,
          type: 'step_superseded',
          summary: '当前步骤已由新计划替代',
          publicPayload: {},
          technicalPayload: {},
          redactionVersion: 1,
        },
        {
          eventKey: `agent-task-event:${transition.id}:plan-revised`,
          type: 'plan_revised',
          summary: result.summary,
          publicPayload: { stepCount: result.plan.steps.length },
          technicalPayload: {},
          redactionVersion: 1,
        },
      ],
      nextTransition: {
        kind: 'step_action',
        stepOrdinal: 1,
        transitionKey: nextTransitionKey,
        input: { planVersion: detail.run.activePlanVersion + 1, stepOrdinal: 1, semanticRevisionCount: 0 },
      },
      now: now(),
    })
    return 'continue'
  }

  const executeVerification = async (transition: AgentTaskTransitionClaim): Promise<'continue' | 'retry' | 'stop'> => {
    if (!options.verify) {
      await release(transition)
      return 'stop'
    }
    const result = await options.verify(transition)
    if (result.action === 'pass' && deterministicVerificationEvidence(result.evidence)) {
      await completePhase3(transition, {
        status: 'completed',
        output: { verified: true },
        taskRunPatch: { status: 'completed', currentTransitionKey: null },
        finalVerification: result.evidence,
        events: [
          {
            eventKey: `agent-task-event:${transition.id}:task-completed`,
            type: 'task_completed',
            summary: '任务已完成',
            publicPayload: {},
            technicalPayload: {
              operationId: result.evidence.operationId,
              receiptId: result.evidence.receiptId,
            },
            redactionVersion: 1,
          },
        ],
        now: now(),
      })
      return 'continue'
    }
    const code = result.action === 'pass' ? 'final_verification_evidence_invalid' : result.code
    const summary =
      result.action === 'pass'
        ? '最终检查缺少可信证据，任务已停止。'
        : result.action === 'terminal'
          ? result.summary
          : '最终检查未通过，当前持久化版本无法安全重新规划，任务已停止。'
    assertAgentDecisionUserTextSafe({ summary })
    await completePhase3(transition, {
      status: 'failed',
      error: { code, retryable: false },
      taskRunPatch: { status: 'failed', currentTransitionKey: null },
      events: [
        {
          eventKey: `agent-task-event:${transition.id}:task-failed`,
          type: 'task_failed',
          summary,
          publicPayload: { code },
          technicalPayload: {},
          redactionVersion: 1,
        },
      ],
      now: now(),
    })
    return 'continue'
  }

  const executePhase3 = (transition: AgentTaskTransitionClaim) => {
    if (transition.kind === 'step_action') return executeAction(transition)
    if (transition.kind === 'observation') return executeObservation(transition)
    if (transition.kind === 'final_verification') return executeVerification(transition)
    return Promise.resolve<'stop'>('stop')
  }

  const execute = async (transition: AgentTaskTransitionClaim): Promise<'continue' | 'retry' | 'stop'> => {
    if (!transition.leaseToken) throw new Error('Claimed Agent task transition is missing its lease token')
    if (hasUnknownProviderOutcome(transition)) {
      const dedupeKey = `provider-outcome-unknown:${transition.id}`
      const paused = await options.store.pauseAgentTaskTransitionUnknownOutcome(
        transition.actorId,
        transitionFence(transition, workerId, transition.leaseToken),
        {
          now: now(),
          event: {
            eventKey: dedupeKey,
            type: 'waiting_user',
            summary: '执行结果无法确认，任务已暂停，请检查后再继续。',
            publicPayload: { code: 'provider_outcome_unknown', action: 'review_before_resume' },
            technicalPayload: {},
            redactionVersion: 1,
          },
          operationalEvent: {
            dedupeKey,
            code: 'provider_outcome_unknown',
            severity: 'critical',
            details: { claimAttempts: transition.claimAttempts },
          },
        },
      )
      if (
        paused !== 'stale' &&
        paused !== 'invalid_state' &&
        paused.classification === 'provider_outcome_unknown_paused'
      ) {
        options.observability.logDurable({
          dedupeKey,
          taskRunId: transition.taskRunId,
          projectId: transition.projectId,
          transitionId: transition.id,
          transitionKey: transition.transitionKey,
          transitionKind: transition.kind,
          transitionGeneration: transition.generation,
          code: 'unknown_commit_outcome',
          severity: 'error',
          details: { claimAttempts: transition.claimAttempts, status: 'paused' },
        })
      }
      return 'stop'
    }
    if (transition.kind !== 'planning') {
      const fence = transitionFence(transition, workerId, transition.leaseToken)
      const heartbeat = setInterval(() => {
        const at = now()
        void options.store
          .heartbeatAgentTaskTransition(transition.actorId, fence, at, leaseUntil(at))
          .catch(() => logger.error('Agent task transition heartbeat failed'))
      }, heartbeatMs)
      heartbeat.unref?.()
      try {
        return await executePhase3(transition)
      } catch (error) {
        if (error instanceof Phase3CompletionError) {
          if (error.classification === 'stale') return 'continue'
          await options.observability.record(transition.actorId, {
            dedupeKey: `phase3-completion-rejected:${transition.id}:${transition.generation}`,
            taskRunId: transition.taskRunId,
            projectId: transition.projectId,
            transitionId: transition.id,
            transitionKey: transition.transitionKey,
            transitionKind: transition.kind,
            transitionGeneration: transition.generation,
            code: 'duplicate_mutation_prevented',
            severity: 'critical',
            details: { classification: error.classification, workerId },
          })
          return 'stop'
        }
        const completed = await options.store.completeAgentTaskTransition(transition.actorId, fence, {
          status: 'failed',
          error: { code: 'phase3_transition_failed', retryable: false },
          taskRunPatch: { status: 'failed', currentTransitionKey: null },
          ...(transition.stepId ? { stepPatch: { stepId: transition.stepId, status: 'failed' as const } } : {}),
          events: [
            {
              eventKey: `agent-task-event:${transition.id}:task-failed`,
              stepId: transition.stepId,
              type: 'task_failed',
              summary: '当前执行阶段未能安全完成，任务已停止。',
              publicPayload: { code: 'phase3_transition_failed' },
              technicalPayload: {},
              redactionVersion: 1,
            },
          ],
          now: now(),
        })
        if (completed === 'invalid_state' || completed === 'conflict') {
          await options.observability.record(transition.actorId, {
            dedupeKey: `phase3-failsafe-rejected:${transition.id}:${transition.generation}`,
            taskRunId: transition.taskRunId,
            projectId: transition.projectId,
            transitionId: transition.id,
            transitionKey: transition.transitionKey,
            transitionKind: transition.kind,
            transitionGeneration: transition.generation,
            code: 'duplicate_mutation_prevented',
            severity: 'critical',
            details: { classification: completed, workerId },
          })
        }
        return completed === 'stale' ? 'continue' : 'stop'
      } finally {
        clearInterval(heartbeat)
      }
    }
    if (!options.plan) {
      await release(transition)
      return 'stop'
    }

    const fence = transitionFence(transition, workerId, transition.leaseToken)
    const heartbeat = setInterval(() => {
      const at = now()
      void options.store
        .heartbeatAgentTaskTransition(transition.actorId, fence, at, leaseUntil(at))
        .catch(() => logger.error('Agent task transition heartbeat failed'))
    }, heartbeatMs)
    heartbeat.unref?.()

    try {
      const decision = await options.plan(transition)
      if (decision.action === 'ask_user') {
        assertAgentDecisionUserTextSafe({ summary: decision.summary, question: decision.question })
        const at = now()
        const completed = await options.store.completeAgentTaskTransition(transition.actorId, fence, {
          status: 'completed',
          output: { waitingForUser: true, questionId: decision.question.id },
          taskRunPatch: { status: 'waiting_user', currentTransitionKey: null },
          events: [
            {
              eventKey: `agent-task-event:${transition.id}:waiting-user`,
              type: 'waiting_user',
              summary: decision.summary,
              publicPayload: { question: decision.question },
              technicalPayload: {},
              redactionVersion: 1,
            },
          ],
          now: at,
        })
        if (completed === 'stale') return 'continue'
        if (completed === 'invalid_state' || completed === 'conflict') {
          await options.observability.record(transition.actorId, {
            dedupeKey: `duplicate-planning-question:${transition.id}:${transition.generation}`,
            taskRunId: transition.taskRunId,
            projectId: transition.projectId,
            transitionId: transition.id,
            transitionKey: transition.transitionKey,
            transitionKind: transition.kind,
            transitionGeneration: transition.generation,
            code: 'duplicate_mutation_prevented',
            severity: 'critical',
            details: { claimAttempts: transition.claimAttempts, workerId },
          })
        }
        return 'continue'
      }
      const plan = decision
      assertExecutablePlan(plan)
      const firstStep = plan.steps.find(step => step.ordinal === 1)
      if (!firstStep) throw new Error('Agent task plan has no runnable first step')
      const at = now()
      const nextTransitionKey = `step-action:${transition.taskRunId}:${transition.generation}:1`
      const completion: AgentTaskPlanningCompletion = {
        transition,
        plan,
        event: {
          eventKey: `agent-task-event:${transition.id}:plan-created`,
          type: 'plan_created',
          summary: `已创建执行计划，共 ${plan.steps.length} 步`,
          publicPayload: { stepCount: plan.steps.length },
          technicalPayload: {},
          redactionVersion: 1,
        },
        nextTransition: {
          kind: 'step_action',
          stepOrdinal: firstStep.ordinal,
          transitionKey: nextTransitionKey,
          input: { planVersion: 1, stepOrdinal: firstStep.ordinal },
        },
        now: at,
      }
      const completed = await options.store.completeAgentTaskTransition(transition.actorId, fence, {
        status: 'completed',
        output: { planCreated: true },
        taskRunPatch: {
          status: 'running',
          currentTransitionKey: nextTransitionKey,
        },
        plan: {
          summary: plan.summary,
          assumptions: plan.assumptions,
          verification: { ...plan.verification, risks: plan.risks },
          steps: plan.steps.map(step => ({
            id: step.semanticId,
            ordinal: step.ordinal,
            title: step.title,
            intent: { ...step.intent },
          })),
        },
        events: [completion.event],
        nextTransition: completion.nextTransition,
        now: at,
      })
      if (completed === 'stale') return 'continue'
      if (completed === 'invalid_state' || completed === 'conflict') {
        await options.observability.record(transition.actorId, {
          dedupeKey: `duplicate-planning-completion:${transition.id}:${transition.generation}`,
          taskRunId: transition.taskRunId,
          projectId: transition.projectId,
          transitionId: transition.id,
          transitionKey: transition.transitionKey,
          transitionKind: transition.kind,
          transitionGeneration: transition.generation,
          code: 'duplicate_mutation_prevented',
          severity: 'critical',
          details: { claimAttempts: transition.claimAttempts, workerId },
        })
      }
      return 'continue'
    } catch (error) {
      const failure =
        error instanceof AgentTaskPlanningFailure
          ? error
          : error instanceof ApiError
            ? new AgentTaskPlanningFailure(error.code, false)
            : new AgentTaskPlanningFailure('planning_failed', false)
      if (failure.alreadyPersisted) return 'stop'
      if (failure.retryable && transition.claimAttempts < 3) {
        await release(transition)
        return 'retry'
      }
      const at = now()
      const completed = await options.store.completeAgentTaskTransition(transition.actorId, fence, {
        status: 'failed',
        error: { code: failure.code, retryable: failure.retryable },
        taskRunPatch: { status: 'failed', currentTransitionKey: null },
        events: [
          {
            eventKey: `agent-task-event:${transition.id}:task-failed`,
            type: 'task_failed',
            summary: '规划未能安全完成，任务已停止。',
            publicPayload: { code: failure.code },
            technicalPayload: { retryable: failure.retryable, attempts: transition.claimAttempts },
            redactionVersion: 1,
          },
        ],
        now: at,
      })
      if (completed === 'stale') return 'continue'
      if (completed === 'invalid_state' || completed === 'conflict') {
        await options.observability.record(transition.actorId, {
          dedupeKey: `planning-failure-conflict:${transition.id}:${transition.generation}`,
          taskRunId: transition.taskRunId,
          projectId: transition.projectId,
          transitionId: transition.id,
          transitionKey: transition.transitionKey,
          transitionKind: transition.kind,
          transitionGeneration: transition.generation,
          code: 'duplicate_mutation_prevented',
          severity: 'critical',
          details: { failureCode: failure.code, workerId },
        })
      }
      return 'continue'
    } finally {
      clearInterval(heartbeat)
    }
  }

  const claimNext = async (): Promise<AgentTaskTransitionClaim | null> => {
    const at = now()
    if (options.plan) {
      const planning = await options.store.claimAgentTaskTransition(workerId, at, leaseUntil(at), ['planning'])
      if (planning) return planning
    }
    if ((!options.act && !options.observe && !options.verify) || !options.store.acquireNextAgentProjectTaskLease) {
      return null
    }
    const projectLease = await options.store.acquireNextAgentProjectTaskLease(workerId, at, leaseUntil(at))
    if (!projectLease) return null
    return options.store.claimAgentTaskTransition(workerId, at, leaseUntil(at), NON_PLANNING_KINDS)
  }

  const schedule = () => {
    if (!started || stopping || pollTimer) return
    pollTimer = setTimeout(() => {
      pollTimer = null
      void drain()
    }, pollMs)
    pollTimer.unref?.()
  }

  const drain = async (): Promise<void> => {
    if (draining) return draining
    draining = (async () => {
      try {
        while (!stopping) {
          const transition = await claimNext()
          if (!transition) break
          activeTransition = transition
          active = execute(transition)
          const outcome = await active
          active = null
          activeTransition = null
          if (outcome === 'stop') {
            break
          }
          if (outcome === 'retry') break
        }
      } catch {
        logger.error('Agent task worker failed')
      } finally {
        active = null
        activeTransition = null
        draining = null
        schedule()
      }
    })()
    return draining
  }

  return {
    async runOnce() {
      if (!hasWorker) return (await options.reconciler.runOnce()) > 0
      const transition = await claimNext()
      if (!transition) return false
      activeTransition = transition
      active = execute(transition)
      try {
        await active
      } catch (error) {
        if (!hasUnknownProviderOutcome(transition)) {
          await release(transition).catch(releaseError => {
            logger.error('Agent task transition release failed', releaseError)
          })
        }
        throw error
      } finally {
        active = null
        activeTransition = null
      }
      return true
    },
    start() {
      if (started) return
      stopping = false
      started = true
      void options.reconciler
        .runOnce()
        .then(() => (hasWorker ? drain() : undefined))
        .catch(() => {
          logger.error('Agent task startup reconciliation failed')
          schedule()
        })
    },
    async stop() {
      stopping = true
      started = false
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      if (!active && !draining) return
      let timedOut = false
      let graceTimer: ReturnType<typeof setTimeout> | null = null
      await Promise.race([
        Promise.all([active, draining]),
        new Promise<void>(resolve => {
          graceTimer = setTimeout(() => {
            timedOut = true
            resolve()
          }, shutdownGraceMs)
          graceTimer.unref?.()
        }),
      ])
      if (graceTimer) clearTimeout(graceTimer)
      if (timedOut && activeTransition) await release(activeTransition)
    },
    wake() {
      if (!started || stopping) return
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      void drain()
    },
  }
}
