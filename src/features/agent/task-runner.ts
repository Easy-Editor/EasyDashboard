import {
  continueAgentTaskRun,
  controlAgentRun,
  getAgentRun,
  getAgentTaskRunDetail,
  getAgentTaskRunEvents,
  pollAgentTaskRun,
  startAgentTurn,
} from './api'
import type {
  AgentRun,
  AgentTaskRunEventsPage,
  AgentTaskRunSnapshot,
  AgentTurnInput,
  AgentTurnResult,
  ContinueAgentTaskRunInput,
} from './api'
import {
  getConversation,
  recordAgentRun,
  recordAgentTaskPlan,
  recordAgentTaskQuestion,
  recordAgentTaskRunDetail,
} from './store'
import type { AgentStorage, AgentTaskRunDetail } from './types'

export type ExecuteAgentTaskTurnInput = AgentTurnInput & {
  ownerUserId: string
}

export type AgentTaskRunnerDependencies = {
  storage?: AgentStorage
  persistWorkspace?: () => Promise<unknown>
  startTurn?: (input: AgentTurnInput) => Promise<AgentTurnResult>
}

export type PersistedAgentTaskRunInput = {
  ownerUserId: string
  projectId: string
  conversationId: string
  taskRunId: string
}

export type PersistedAgentTaskRunDependencies = {
  storage?: AgentStorage
  getDetail?: (projectId: string, taskRunId: string) => Promise<AgentTaskRunDetail>
  getEvents?: (projectId: string, taskRunId: string, options: { afterSeq: number }) => Promise<AgentTaskRunEventsPage>
  poll?: typeof pollAgentTaskRun
  continueRun?: (input: ContinueAgentTaskRunInput) => Promise<AgentTaskRunDetail>
}

function persistTaskRunSnapshot(
  input: PersistedAgentTaskRunInput,
  snapshot: AgentTaskRunSnapshot,
  storage?: AgentStorage,
): void {
  const boundedSnapshot = boundTaskRunSnapshot(snapshot)
  recordAgentTaskRunDetail(
    {
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      detail: { ...boundedSnapshot.detail, latestEventSequence: boundedSnapshot.latestEventSequence },
      events: boundedSnapshot.events,
    },
    storage,
  )
}

function boundTaskRunSnapshot(snapshot: AgentTaskRunSnapshot): AgentTaskRunSnapshot {
  const events = snapshot.events.filter(event => event.seq <= snapshot.detail.latestEventSequence)
  return {
    detail: snapshot.detail,
    events,
    latestEventSequence: Math.min(snapshot.latestEventSequence, snapshot.detail.latestEventSequence),
  }
}

export async function hydratePersistedAgentTaskRun(
  input: PersistedAgentTaskRunInput,
  dependencies: PersistedAgentTaskRunDependencies = {},
): Promise<AgentTaskRunSnapshot> {
  const existingTask = getConversation(input.ownerUserId, input.conversationId, dependencies.storage)?.tasks.find(
    task => task.taskRunId === input.taskRunId,
  )
  const afterSeq = existingTask?.taskRunId === input.taskRunId ? (existingTask.latestEventSequence ?? 0) : 0
  const getDetail = dependencies.getDetail ?? getAgentTaskRunDetail
  let detail = await getDetail(input.projectId, input.taskRunId)
  let detailRefreshes = 0
  let consumedSequence = afterSeq
  const events = [] as AgentTaskRunSnapshot['events']
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const page = await (dependencies.getEvents ?? getAgentTaskRunEvents)(input.projectId, input.taskRunId, {
      afterSeq: consumedSequence,
    })
    if (page.latestEventSequence > detail.latestEventSequence && detailRefreshes < 3) {
      detail = await getDetail(input.projectId, input.taskRunId)
      detailRefreshes += 1
    }
    const boundedEvents = page.events.filter(event => event.seq <= detail.latestEventSequence)
    events.push(...boundedEvents)
    consumedSequence = boundedEvents.at(-1)?.seq ?? consumedSequence
    if (boundedEvents.length === 0 || consumedSequence >= detail.latestEventSequence) break
  }
  const snapshot = boundTaskRunSnapshot({
    detail,
    events,
    latestEventSequence: consumedSequence,
  })
  persistTaskRunSnapshot(input, snapshot, dependencies.storage)
  return snapshot
}

export async function pollPersistedAgentTaskRun(
  input: PersistedAgentTaskRunInput,
  dependencies: PersistedAgentTaskRunDependencies = {},
): Promise<AgentTaskRunSnapshot> {
  const existingTask = getConversation(input.ownerUserId, input.conversationId, dependencies.storage)?.tasks.find(
    task => task.taskRunId === input.taskRunId,
  )
  const snapshot = await (dependencies.poll ?? pollAgentTaskRun)(input.projectId, input.taskRunId, {
    afterSeq: existingTask?.latestEventSequence ?? 0,
    onSnapshot: snapshot => persistTaskRunSnapshot(input, snapshot, dependencies.storage),
  })
  return boundTaskRunSnapshot(snapshot)
}

export async function continuePersistedAgentTaskRun(
  input: PersistedAgentTaskRunInput &
    Pick<ContinueAgentTaskRunInput, 'questionId' | 'response' | 'attachmentIds' | 'idempotencyKey'>,
  dependencies: PersistedAgentTaskRunDependencies = {},
): Promise<AgentTaskRunDetail> {
  const detail = await (dependencies.continueRun ?? continueAgentTaskRun)({
    projectId: input.projectId,
    taskRunId: input.taskRunId,
    questionId: input.questionId,
    response: input.response,
    ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  })
  recordAgentTaskRunDetail(
    { ownerUserId: input.ownerUserId, conversationId: input.conversationId, detail },
    dependencies.storage,
  )
  return detail
}

export type ControlAgentTaskRunInput = {
  ownerUserId: string
  projectId: string
  conversationId: string
  taskId: string
  operationId: string
  action: 'pause' | 'resume' | 'cancel'
}

export type AgentTaskControlDependencies = {
  storage?: AgentStorage
  controlRun?: (projectId: string, operationId: string, action: ControlAgentTaskRunInput['action']) => Promise<AgentRun>
}

export type RecordAgentRunPendingQuestionInput = {
  ownerUserId: string
  conversationId: string
  taskId: string
  run: AgentRun
  localOnlyExecutionProjection?: boolean
}

export type RefreshLegacyAgentRunProjectionInput = {
  ownerUserId: string
  projectId: string
  conversationId: string
  taskId: string
  operationId: string
}

export type RefreshLegacyAgentRunProjectionDependencies = {
  storage?: AgentStorage
  getRun?: typeof getAgentRun
}

export async function refreshLegacyAgentRunProjection(
  input: RefreshLegacyAgentRunProjectionInput,
  dependencies: RefreshLegacyAgentRunProjectionDependencies = {},
): Promise<AgentRun> {
  const run = await (dependencies.getRun ?? getAgentRun)(input.projectId, input.operationId)
  recordAgentRun(
    {
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      operationId: run.operationId,
      status: run.status,
      outcome: run.outcome,
      receipt: run.receipt,
      cost: run.cost,
      trace: run.trace,
      rollback: run.rollback,
      rolledBackAt: run.rolledBackAt,
      rollbackReceipt: run.rollbackReceipt,
      message: run.message,
      usage: run.usage,
      localOnlyExecutionProjection: true,
    },
    dependencies.storage,
  )
  recordAgentRunPendingQuestion(
    {
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      run,
      localOnlyExecutionProjection: true,
    },
    dependencies.storage,
  )
  return run
}

/**
 * Projects a durable worker checkpoint into the private local conversation.
 * The checkpoint remains authoritative on the server; this projection keeps a
 * refreshable question in the normal message stream without creating a task.
 */
export function recordAgentRunPendingQuestion(
  input: RecordAgentRunPendingQuestionInput,
  storage?: AgentStorage,
): boolean {
  const pendingQuestion = input.run.pendingQuestion
  if (!pendingQuestion) return false
  recordAgentTaskQuestion(
    {
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      questionId: pendingQuestion.question.id,
      message: pendingQuestion.message,
      prompt: pendingQuestion.question.text,
      plan: pendingQuestion.plan,
      usage: pendingQuestion.usage,
      localOnlyExecutionProjection: input.localOnlyExecutionProjection,
    },
    storage,
  )
  return true
}

export async function executeAgentTaskTurn(
  input: ExecuteAgentTaskTurnInput,
  dependencies: AgentTaskRunnerDependencies = {},
): Promise<AgentTurnResult> {
  const { ownerUserId, ...turnInput } = input
  await dependencies.persistWorkspace?.()
  const result = await (dependencies.startTurn ?? startAgentTurn)(turnInput)

  if (result.kind === 'waiting_user') {
    recordAgentTaskQuestion(
      {
        ownerUserId,
        conversationId: input.conversationId,
        taskId: result.taskId,
        questionId: result.question.id,
        message: result.message,
        prompt: result.question.text,
        plan: result.plan,
        usage: result.usage,
      },
      dependencies.storage,
    )
    return result
  }

  if (result.plan) {
    recordAgentTaskPlan(
      {
        ownerUserId,
        conversationId: input.conversationId,
        taskId: result.taskId,
        plan: result.plan,
        taskStatus: 'running',
        usage: result.run.usage,
      },
      dependencies.storage,
    )
  }
  recordAgentRun(
    {
      ownerUserId,
      conversationId: input.conversationId,
      taskId: result.taskId,
      operationId: result.run.operationId,
      status: result.run.status,
      message: result.run.message,
      usage: result.run.usage,
      outcome: result.run.outcome,
      receipt: result.run.receipt,
      cost: result.run.cost,
      trace: result.run.trace,
      rollback: result.run.rollback,
      rolledBackAt: result.run.rolledBackAt,
      rollbackReceipt: result.run.rollbackReceipt,
    },
    dependencies.storage,
  )
  recordAgentRunPendingQuestion(
    {
      ownerUserId,
      conversationId: input.conversationId,
      taskId: result.taskId,
      run: result.run,
    },
    dependencies.storage,
  )
  return result
}

export async function controlAgentTaskRun(
  input: ControlAgentTaskRunInput,
  dependencies: AgentTaskControlDependencies = {},
): Promise<AgentRun> {
  const run = await (dependencies.controlRun ?? controlAgentRun)(input.projectId, input.operationId, input.action)
  recordAgentRun(
    {
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      operationId: run.operationId,
      status: run.status,
      usage: run.usage,
      outcome: run.outcome,
      receipt: run.receipt,
      cost: run.cost,
      trace: run.trace,
      rollback: run.rollback,
      rolledBackAt: run.rolledBackAt,
      rollbackReceipt: run.rollbackReceipt,
      message: run.message,
    },
    dependencies.storage,
  )
  return run
}
