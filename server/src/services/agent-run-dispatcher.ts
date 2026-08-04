import { randomUUID } from 'node:crypto'
import { ApiError } from '../http.js'
import type { AgentRunDispatchRecord, AgentSpikeOperationRecord } from '../types.js'
import {
  AgentExecutorAbortedError,
  type AgentExecutorRunner,
  AgentExecutorRunnerError,
  type AgentExecutorWorkflowInput,
} from './agent-executor-runner.js'

export type AgentRunDispatchControl = 'pause' | 'resume' | 'cancel'
export type AgentRunDispatchTerminalState = 'succeeded' | 'failed' | 'canceled' | 'indeterminate'
export type AgentRunRecoveryClass =
  | 'committed'
  | 'retry_same'
  | 'recover_operation'
  | 'revise_step'
  | 'replan_remaining'
  | 'terminal'

export interface AgentRunOutcomeReport {
  recoveryClass: AgentRunRecoveryClass
  operationId: string
  durableStatus: AgentSpikeOperationRecord['status']
  committedDraftVersion?: number
  hasCommitReceipt: boolean
  errorCode: string | null
}

export interface AgentRunDispatchStore {
  enqueueAgentRunDispatch(
    actorId: string,
    input: {
      projectId: string
      conversationId: string
      taskId: string
      operationId: string
      now: Date
    },
  ): Promise<AgentRunDispatchRecord | null>
  getAgentRunDispatch(actorId: string, projectId: string, operationId: string): Promise<AgentRunDispatchRecord | null>
  getAgentRunDispatchByTask(actorId: string, projectId: string, taskId: string): Promise<AgentRunDispatchRecord | null>
  claimAgentRunDispatch(workerId: string, now: Date, leaseUntil: Date): Promise<AgentRunDispatchRecord | null>
  heartbeatAgentRunDispatch(
    actorId: string,
    id: string,
    workerId: string,
    generation: number,
    now: Date,
    leaseUntil: Date,
  ): Promise<AgentRunDispatchRecord | null>
  controlAgentRunDispatch(
    actorId: string,
    projectId: string,
    operationId: string,
    action: AgentRunDispatchControl,
    now: Date,
  ): Promise<AgentRunDispatchRecord | 'invalid_state' | null>
  finishAgentRunDispatch(
    actorId: string,
    id: string,
    workerId: string,
    generation: number,
    state: AgentRunDispatchTerminalState | 'paused',
    error: { code: string; message: string } | null,
    now: Date,
  ): Promise<AgentRunDispatchRecord | null>
}

export interface RestoredAgentExecution {
  operation: AgentSpikeOperationRecord
  input: AgentExecutorWorkflowInput
}

export interface AgentRunDispatcherOptions {
  store: AgentRunDispatchStore
  runner: AgentExecutorRunner
  restoreExecution(
    actorId: string,
    operationId: string,
    attempt: { dispatchId: string; workerId: string; leaseGeneration: number },
  ): Promise<RestoredAgentExecution>
  readOperation(actorId: string, operationId: string): Promise<AgentSpikeOperationRecord | null>
  planRun?(
    job: AgentRunDispatchRecord,
    attempt: { dispatchId: string; workerId: string; leaseGeneration: number },
  ): Promise<'ready' | 'waiting_user' | 'billing_indeterminate' | 'retry'>
  failOperation?(
    actorId: string,
    operation: AgentSpikeOperationRecord,
    outcome: Record<string, unknown>,
  ): Promise<AgentSpikeOperationRecord | 'integrity_conflict' | 'invalid_state' | null>
  reportOutcome?(outcome: AgentRunOutcomeReport): Promise<void> | void
  workerId?: string
  leaseMs?: number
  heartbeatMs?: number
  pollMs?: number
  now?: () => Date
  logger?: Pick<Console, 'error'>
}

export interface AgentRunDispatcher {
  enqueue(
    actorId: string,
    input: { projectId: string; conversationId: string; taskId: string; operationId: string },
  ): Promise<AgentRunDispatchRecord>
  get(actorId: string, projectId: string, operationId: string): Promise<AgentRunDispatchRecord | null>
  getByTask(actorId: string, projectId: string, taskId: string): Promise<AgentRunDispatchRecord | null>
  control(
    actorId: string,
    projectId: string,
    operationId: string,
    action: AgentRunDispatchControl,
  ): Promise<AgentRunDispatchRecord | 'invalid_state' | null>
  runOnce(): Promise<boolean>
  start(): void
  stop(): Promise<void>
  wake(): void
}

type ActiveExecution = {
  controller: AbortController
  stopReason: 'pause' | 'cancel' | 'lease_lost' | 'shutdown' | null
}

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_HEARTBEAT_MS = 10_000
const DEFAULT_POLL_MS = 1_000

function operationTerminalState(operation: AgentSpikeOperationRecord | null): AgentRunDispatchTerminalState | null {
  if (!operation) return 'indeterminate'
  if (operation.status === 'committed') return 'succeeded'
  if (operation.status === 'indeterminate') return 'indeterminate'
  if (operation.status === 'failed_not_applied' || operation.status === 'rejected_stale') return 'failed'
  return null
}

function safeExecutionError(error: unknown): { code: string; message: string } {
  if (error instanceof AgentExecutorAbortedError) {
    return {
      code: error.reason === 'pause' ? 'executor_paused' : 'executor_canceled',
      message: error.reason === 'pause' ? '执行已在安全边界暂停' : '执行已取消',
    }
  }
  if (error instanceof ApiError) {
    return {
      code: error.code.slice(0, 120),
      message: error.message.slice(0, 500),
    }
  }
  if (error instanceof AgentExecutorRunnerError) {
    return error.failure
      ? {
          code: error.failure.code.slice(0, 120),
          message: error.failure.message.slice(0, 500),
        }
      : {
          code: error.code,
          message: `Document executor failed [${error.code}]`,
        }
  }
  const name = error instanceof Error && error.name ? error.name.slice(0, 120) : 'AgentExecutorError'
  return { code: 'executor_failed', message: `Agent executor failed (${name})` }
}

function hasDurableCommitReceipt(operation: AgentSpikeOperationRecord): boolean {
  return (
    operation.status === 'committed' &&
    operation.candidateSchema !== null &&
    operation.candidateDigest !== null &&
    operation.hostReceipt !== null &&
    operation.committedDraftVersion !== null &&
    operation.completedAt !== null
  )
}

function isProvenTransientExecutorFailure(error: unknown): boolean {
  return (
    error instanceof AgentExecutorRunnerError &&
    (error.code === 'EXECUTOR_TIMEOUT' || error.code === 'EXECUTOR_PROCESS_FAILED')
  )
}

function isRevisionEligibleFailure(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.status === 422) ||
    (error instanceof AgentExecutorRunnerError && error.code === 'EXECUTOR_INVALID_WORKFLOW_RESULT')
  )
}

function failedOperationRecoveryClass(
  operation: AgentSpikeOperationRecord,
  error?: unknown,
): Extract<AgentRunRecoveryClass, 'revise_step' | 'terminal'> {
  if (error && isRevisionEligibleFailure(error)) return 'revise_step'
  const reason = typeof operation.outcome?.reason === 'string' ? operation.outcome.reason : null
  return reason === 'EXECUTOR_INVALID_WORKFLOW_RESULT' || reason === 'VALIDATION_FAILED' ? 'revise_step' : 'terminal'
}

export function createAgentRunDispatcher(options: AgentRunDispatcherOptions): AgentRunDispatcher {
  const workerId = options.workerId ?? `agent-worker-${randomUUID()}`
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const now = options.now ?? (() => new Date())
  const logger = options.logger ?? console
  const active = new Map<string, ActiveExecution>()
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let draining: Promise<void> | null = null
  let started = false
  let stopping = false

  const leaseUntil = (at: Date) => new Date(at.getTime() + leaseMs)

  const finish = (
    job: AgentRunDispatchRecord,
    state: AgentRunDispatchTerminalState | 'paused',
    error: { code: string; message: string } | null = null,
  ) => options.store.finishAgentRunDispatch(job.actorId, job.id, workerId, job.generation, state, error, now())

  const reportOutcome = async (
    operation: AgentSpikeOperationRecord,
    recoveryClass: AgentRunRecoveryClass,
    errorCode: string | null,
  ): Promise<void> => {
    if (!options.reportOutcome) return
    await options.reportOutcome({
      recoveryClass,
      operationId: operation.operationId,
      durableStatus: operation.status,
      ...(operation.committedDraftVersion === null ? {} : { committedDraftVersion: operation.committedDraftVersion }),
      hasCommitReceipt: hasDurableCommitReceipt(operation),
      errorCode,
    })
  }

  const finishFromDurableTerminal = async (
    job: AgentRunDispatchRecord,
    operation: AgentSpikeOperationRecord,
    error?: unknown,
  ): Promise<boolean> => {
    if (operation.status === 'committed') {
      await finish(job, 'succeeded')
      await reportOutcome(operation, 'committed', null)
      return true
    }
    if (operation.status === 'indeterminate') {
      const unknownOutcome = {
        code: 'unknown_commit_outcome',
        message: 'Durable operation commit outcome is unknown',
      }
      await finish(job, 'indeterminate', unknownOutcome)
      await reportOutcome(operation, 'terminal', unknownOutcome.code)
      return true
    }
    if (operation.status === 'rejected_stale') {
      const stale = {
        code: 'replan_remaining',
        message: 'Project document changed before the operation could commit',
      }
      await finish(job, 'failed', stale)
      await reportOutcome(operation, 'replan_remaining', stale.code)
      return true
    }
    if (operation.status === 'failed_not_applied') {
      const safeError = error ? safeExecutionError(error) : null
      const recoveryClass = failedOperationRecoveryClass(operation, error)
      await finish(
        job,
        'failed',
        safeError ?? {
          code: recoveryClass,
          message:
            recoveryClass === 'revise_step'
              ? 'Executor rejected the proposed document change'
              : 'Executor did not apply the document change',
        },
      )
      await reportOutcome(operation, recoveryClass, safeError?.code ?? recoveryClass)
      return true
    }
    return false
  }

  const persistOperationFailure = async (
    job: AgentRunDispatchRecord,
    operation: AgentSpikeOperationRecord,
    outcome: Record<string, unknown>,
  ): Promise<AgentSpikeOperationRecord> => {
    if (!options.failOperation) throw new Error('Agent operation failure persistence is unavailable')
    const failed = await options.failOperation(job.actorId, operation, outcome)
    if (!failed || failed === 'integrity_conflict' || failed === 'invalid_state') {
      throw new Error('Agent operation failure could not be persisted')
    }
    if (!operationTerminalState(failed)) throw new Error('Agent operation remained nonterminal after failure')
    return failed
  }

  const execute = async (job: AgentRunDispatchRecord): Promise<void> => {
    const execution: ActiveExecution = { controller: new AbortController(), stopReason: null }
    active.set(job.operationId, execution)
    let heartbeatInFlight = false
    const requestStop = (reason: ActiveExecution['stopReason']) => {
      if (!reason || execution.stopReason) return
      execution.stopReason = reason
      execution.controller.abort(reason === 'pause' ? 'pause' : 'cancel')
    }
    const heartbeat = setInterval(() => {
      if (heartbeatInFlight || execution.controller.signal.aborted) return
      heartbeatInFlight = true
      const at = now()
      void options.store
        .heartbeatAgentRunDispatch(job.actorId, job.id, workerId, job.generation, at, leaseUntil(at))
        .then(current => {
          if (!current) {
            requestStop('lease_lost')
          } else if (current.desiredState === 'paused') {
            requestStop('pause')
          } else if (current.desiredState === 'canceled') {
            requestStop('cancel')
          }
        })
        .catch(() => requestStop('lease_lost'))
        .finally(() => {
          heartbeatInFlight = false
        })
    }, heartbeatMs)
    heartbeat.unref?.()

    try {
      let operation = await options.readOperation(job.actorId, job.operationId)
      if (!operation) {
        if (!options.planRun) throw new Error('Agent run planning is unavailable')
        const planned = await options.planRun(job, {
          dispatchId: job.id,
          workerId,
          leaseGeneration: job.generation,
        })
        if (planned === 'waiting_user') {
          await options.store.finishAgentRunDispatch(
            job.actorId,
            job.id,
            workerId,
            job.generation,
            'paused',
            { code: 'waiting_user', message: '等待用户补充信息' },
            now(),
          )
          return
        }
        if (planned === 'billing_indeterminate') {
          await options.store.finishAgentRunDispatch(
            job.actorId,
            job.id,
            workerId,
            job.generation,
            'paused',
            { code: 'billing_indeterminate', message: '上游结果未知，等待用户决定是否重试' },
            now(),
          )
          return
        }
        // A definite pre-response failure or an idempotent unknown outcome is
        // retried only after the lease expires and a new fenced generation is claimed.
        if (planned === 'retry') return
        operation = await options.readOperation(job.actorId, job.operationId)
        if (!operation) throw new Error('Agent run planning did not issue an operation')
      }
      if (await finishFromDurableTerminal(job, operation)) return
      const restored = await options.restoreExecution(job.actorId, job.operationId, {
        dispatchId: job.id,
        workerId,
        leaseGeneration: job.generation,
      })
      if (await finishFromDurableTerminal(job, restored.operation)) return
      await options.runner.run({ ...restored.input, signal: execution.controller.signal })
      const durable = await options.readOperation(job.actorId, job.operationId)
      if (!durable) {
        await finish(job, 'indeterminate', {
          code: 'unknown_commit_outcome',
          message: 'Executor returned without a durable operation outcome',
        })
        await reportOutcome(restored.operation, 'terminal', 'unknown_commit_outcome')
        return
      }
      if (await finishFromDurableTerminal(job, durable)) return
      if (durable.status === 'prepared') {
        await reportOutcome(durable, 'recover_operation', null)
        return
      }
      await finish(job, 'indeterminate', {
        code: 'unknown_commit_outcome',
        message: 'Executor returned without a durable commit outcome',
      })
      await reportOutcome(durable, 'terminal', 'unknown_commit_outcome')
    } catch (error) {
      const durable = await options.readOperation(job.actorId, job.operationId)
      if (!durable) {
        if (execution.stopReason === 'lease_lost' || execution.stopReason === 'shutdown') return
        if (execution.stopReason === 'pause') {
          await finish(job, 'paused')
          return
        }
        if (execution.stopReason === 'cancel') {
          await finish(job, 'canceled')
          return
        }
        const safeError = safeExecutionError(error)
        await finish(job, 'failed', { code: 'planning_failed', message: safeError.message })
        return
      }
      if (await finishFromDurableTerminal(job, durable, error)) return
      if (execution.stopReason === 'lease_lost' || execution.stopReason === 'shutdown') return
      if (execution.stopReason === 'pause') {
        await finish(job, 'paused')
        return
      }
      if (execution.stopReason === 'cancel') {
        const failed = await persistOperationFailure(job, durable, { reason: 'user_canceled' })
        if (failed.status !== 'failed_not_applied' && (await finishFromDurableTerminal(job, failed, error))) return
        await finish(job, 'canceled')
        await reportOutcome(failed, 'terminal', 'executor_canceled')
        return
      }

      const safeError = safeExecutionError(error)
      if (durable.status === 'prepared') {
        await reportOutcome(durable, 'recover_operation', safeError.code)
        return
      }
      if (isProvenTransientExecutorFailure(error) && job.attemptCount < 2) {
        await reportOutcome(durable, 'retry_same', safeError.code)
        return
      }
      if (isProvenTransientExecutorFailure(error)) {
        const failed = await persistOperationFailure(job, durable, {
          reason: 'executor_retry_exhausted',
          executorErrorCode: safeError.code,
        })
        if (failed.status !== 'failed_not_applied' && (await finishFromDurableTerminal(job, failed, error))) return
        const exhausted = {
          code: 'executor_retry_exhausted',
          message: 'Document executor retry limit was exhausted',
        }
        await finish(job, 'failed', exhausted)
        await reportOutcome(failed, 'terminal', exhausted.code)
        return
      }
      const failed = await persistOperationFailure(job, durable, { reason: safeError.code })
      if (failed.status !== 'failed_not_applied' && (await finishFromDurableTerminal(job, failed, error))) return
      const recoveryClass = isRevisionEligibleFailure(error) ? 'revise_step' : 'terminal'
      await finish(job, 'failed', safeError)
      await reportOutcome(failed, recoveryClass, safeError.code)
    } finally {
      clearInterval(heartbeat)
      active.delete(job.operationId)
    }
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
          const at = now()
          const job = await options.store.claimAgentRunDispatch(workerId, at, leaseUntil(at))
          if (!job) break
          await execute(job)
        }
      } catch (error) {
        logger.error('Agent dispatch worker failed', error)
      } finally {
        draining = null
        schedule()
      }
    })()
    return draining
  }

  return {
    async enqueue(actorId, input) {
      const job = await options.store.enqueueAgentRunDispatch(actorId, { ...input, now: now() })
      if (!job) throw new Error('Agent run dispatch could not be persisted')
      this.wake()
      return job
    },
    get(actorId, projectId, operationId) {
      return options.store.getAgentRunDispatch(actorId, projectId, operationId)
    },
    getByTask(actorId, projectId, taskId) {
      return options.store.getAgentRunDispatchByTask(actorId, projectId, taskId)
    },
    async control(actorId, projectId, operationId, action) {
      const result = await options.store.controlAgentRunDispatch(actorId, projectId, operationId, action, now())
      if (result && result !== 'invalid_state' && (action === 'pause' || action === 'cancel')) {
        const execution = active.get(operationId)
        if (execution && !execution.stopReason) {
          execution.stopReason = action
          execution.controller.abort(action)
        }
      }
      if (action === 'resume' && result && result !== 'invalid_state') this.wake()
      return result
    },
    async runOnce() {
      const at = now()
      const job = await options.store.claimAgentRunDispatch(workerId, at, leaseUntil(at))
      if (!job) return false
      await execute(job)
      return true
    },
    start() {
      if (started) return
      stopping = false
      started = true
      void drain()
    },
    async stop() {
      stopping = true
      started = false
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      for (const execution of active.values()) {
        if (execution.stopReason) continue
        execution.stopReason = 'shutdown'
        execution.controller.abort('cancel')
      }
      await draining
    },
    wake() {
      if (!started || stopping) return
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      void drain()
    },
  }
}
