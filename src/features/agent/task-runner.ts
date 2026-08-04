import { controlAgentRun, startAgentTurn } from './api'
import type { AgentRun, AgentTurnInput, AgentTurnResult } from './api'
import { recordAgentRun, recordAgentTaskPlan, recordAgentTaskQuestion } from './store'
import type { AgentStorage } from './types'

export type ExecuteAgentTaskTurnInput = AgentTurnInput & {
  ownerUserId: string
}

export type AgentTaskRunnerDependencies = {
  storage?: AgentStorage
  persistWorkspace?: () => Promise<unknown>
  startTurn?: (input: AgentTurnInput) => Promise<AgentTurnResult>
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
