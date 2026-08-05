import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AgentRunDispatchRecord, AgentSpikeOperationRecord } from '../types.js'
import {
  AgentExecutorAbortedError,
  type AgentExecutorRunner,
  AgentExecutorRunnerError,
  type AgentExecutorWorkflowResult,
} from './agent-executor-runner.js'
import {
  type AgentRunDispatchStore,
  type AgentRunDispatcherOptions,
  type AgentRunOutcomeReport,
  createAgentRunDispatcher,
} from './agent-run-dispatcher.js'

const now = new Date('2026-08-01T00:00:00.000Z')

function dispatch(overrides: Partial<AgentRunDispatchRecord> = {}): AgentRunDispatchRecord {
  return {
    id: 'dispatch-1',
    actorId: 'actor-1',
    projectId: '22222222-2222-4222-8222-222222222222',
    conversationId: 'conversation-1',
    taskId: 'task-1',
    operationId: 'operation-1',
    kind: 'run',
    waitingReason: null,
    state: 'running',
    desiredState: 'running',
    generation: 1,
    leaseOwner: 'worker-1',
    leaseUntil: new Date(now.getTime() + 30_000),
    heartbeatAt: now,
    attemptCount: 1,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  }
}

function operation(
  status: AgentSpikeOperationRecord['status'],
  overrides: Partial<AgentSpikeOperationRecord> = {},
): AgentSpikeOperationRecord {
  return {
    id: 'db-operation-1',
    actorId: 'actor-1',
    projectId: '22222222-2222-4222-8222-222222222222',
    taskId: 'task-1',
    stageId: 'apply-change-set',
    executorId: 'easy-dashboard-document-executor',
    operationId: 'operation-1',
    grantJti: 'grant-1',
    baseDraftVersion: 1,
    inputDigest: 'a'.repeat(64),
    executorInput: {},
    issueDigest: 'b'.repeat(64),
    skillTrace: null,
    compatibility: {},
    expiresAt: new Date(now.getTime() + 300_000),
    status,
    candidateDigest: status === 'committed' ? 'c'.repeat(64) : null,
    preparedDigest: null,
    candidateSchema: status === 'committed' ? { componentsTree: [] } : null,
    hostReceipt: status === 'committed' ? { status: 'applied' } : null,
    evidence: null,
    preparedAt: null,
    committedDraftVersion: status === 'committed' ? 2 : null,
    rollbackRevisionId: status === 'committed' ? 'revision-1' : null,
    rolledBackAt: null,
    rollbackReceipt: null,
    outcome: null,
    completedAt: status === 'issued' || status === 'prepared' ? null : now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function harness(input: {
  runner?: AgentExecutorRunner
  readOperation?: () => Promise<AgentSpikeOperationRecord | null>
  failOperation?: () => Promise<AgentSpikeOperationRecord | 'integrity_conflict' | 'invalid_state' | null>
  heartbeatMs?: number
  restoreExecution?: AgentRunDispatcherOptions['restoreExecution']
  planRun?: AgentRunDispatcherOptions['planRun']
  reportOutcome?: (outcome: AgentRunOutcomeReport) => Promise<void> | void
}) {
  let current = dispatch()
  const store: AgentRunDispatchStore = {
    enqueueAgentRunDispatch: vi.fn(async () => current),
    getAgentRunDispatch: vi.fn(async () => current),
    getAgentRunDispatchByTask: vi.fn(async () => current),
    claimAgentRunDispatch: vi.fn(async () => {
      const claimed = current
      current = { ...current, state: 'succeeded' }
      return claimed
    }),
    heartbeatAgentRunDispatch: vi.fn(async () => current),
    controlAgentRunDispatch: vi.fn(async (_actorId, _projectId, _operationId, action) => {
      current = {
        ...current,
        desiredState: action === 'cancel' ? 'canceled' : action === 'pause' ? 'paused' : 'running',
        state: action === 'resume' ? 'queued' : current.state,
      }
      return current
    }),
    finishAgentRunDispatch: vi.fn(async (_actorId, _id, _workerId, _generation, state, error) => {
      current = {
        ...current,
        state,
        desiredState: state === 'paused' ? 'paused' : state === 'canceled' ? 'canceled' : 'running',
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null,
      }
      return current
    }),
  }
  let durable = operation('issued')
  const runner =
    input.runner ??
    ({
      run: vi.fn(async () => {
        durable = operation('committed')
        return {
          prepared: null,
          outcome: { operationId: 'operation-1', status: 'committed' },
          recovery: { classification: 'committed', browserExecuted: true },
        }
      }),
    } satisfies AgentExecutorRunner)
  const service = createAgentRunDispatcher({
    store,
    runner,
    workerId: 'worker-1',
    now: () => now,
    heartbeatMs: input.heartbeatMs ?? 5,
    restoreExecution:
      input.restoreExecution ??
      vi.fn(async () => ({
        operation: durable,
        input: {
          actorId: 'actor-1',
          projectId: 'project-1',
          operationId: 'operation-1',
          grantToken: 'grant',
          recoveryGrantToken: 'recovery',
        },
      })),
    readOperation: input.readOperation ?? (async () => durable),
    planRun: input.planRun,
    failOperation:
      input.failOperation ??
      vi.fn(async () => {
        durable = operation('failed_not_applied')
        return durable
      }),
    reportOutcome: input.reportOutcome,
    logger: { error: vi.fn() },
  })
  return {
    service,
    store,
    runner,
    current: () => current,
    setCurrent: (value: AgentRunDispatchRecord) => (current = value),
  }
}

describe('Agent run dispatcher', () => {
  it('plans a claimed initial outbox before restoring and executing it', async () => {
    let durable: AgentSpikeOperationRecord | null = null
    const planRun = vi.fn(async () => {
      durable = operation('issued')
      return 'ready' as const
    })
    const state = harness({
      readOperation: async () => durable,
      planRun,
    })
    state.setCurrent(dispatch({ kind: 'initial' }))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(planRun).toHaveBeenCalledOnce()
    expect(state.runner.run).toHaveBeenCalledOnce()
  })

  it('plans an ordinary durable turn before restoring and executing it', async () => {
    let durable: AgentSpikeOperationRecord | null = null
    const planRun = vi.fn(async () => {
      durable = operation('issued')
      return 'ready' as const
    })
    const state = harness({ readOperation: async () => durable, planRun })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(planRun).toHaveBeenCalledOnce()
    expect(state.runner.run).toHaveBeenCalledOnce()
  })

  it('pauses an unsupported unknown provider outcome and never invokes the executor', async () => {
    const state = harness({
      readOperation: async () => null,
      planRun: vi.fn(async () => 'billing_indeterminate' as const),
    })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.runner.run).not.toHaveBeenCalled()
    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'paused',
      expect.objectContaining({ code: 'billing_indeterminate' }),
      now,
    )
  })

  it('leaves a definite pre-send planning failure recoverable for the next bounded lease generation', async () => {
    const planRun = vi.fn(async () => 'retry' as const)
    const state = harness({ readOperation: async () => null, planRun })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(planRun).toHaveBeenCalledOnce()
    expect(state.runner.run).not.toHaveBeenCalled()
    expect(state.store.finishAgentRunDispatch).not.toHaveBeenCalled()
  })

  it('durably pauses an initial outbox when planning asks the user', async () => {
    const state = harness({
      readOperation: async () => null,
      planRun: vi.fn(async () => 'waiting_user' as const),
    })
    state.setCurrent(dispatch({ kind: 'initial' }))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.runner.run).not.toHaveBeenCalled()
    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'paused',
      { code: 'waiting_user', message: '等待用户补充信息' },
      now,
    )
  })

  it('terminalizes a safe planning failure without inventing an operation outcome', async () => {
    const state = harness({
      readOperation: async () => null,
      planRun: vi.fn(async () => Promise.reject(new Error('model unavailable'))),
    })
    state.setCurrent(dispatch({ kind: 'initial' }))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'failed',
      expect.objectContaining({ code: 'planning_failed' }),
      now,
    )
  })

  it('preserves a public planning error message while keeping the dispatch failure envelope stable', async () => {
    const state = harness({
      readOperation: async () => null,
      planRun: vi.fn(async () => Promise.reject(new ApiError(422, 'AGENT_MODEL_OUTPUT_INVALID', '字段不合法'))),
    })
    state.setCurrent(dispatch({ kind: 'initial' }))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'failed',
      { code: 'planning_failed', message: '字段不合法' },
      now,
    )
  })

  it('restores execution with the claimed dispatch attempt identity', async () => {
    const restoreExecution = vi.fn(async () => ({
      operation: operation('committed'),
      input: {
        actorId: 'actor-1',
        projectId: 'project-1',
        operationId: 'operation-1',
        grantToken: 'grant',
        recoveryGrantToken: 'recovery',
      },
    }))
    const state = harness({ restoreExecution })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(restoreExecution).toHaveBeenCalledWith('actor-1', 'operation-1', {
      dispatchId: 'dispatch-1',
      workerId: 'worker-1',
      leaseGeneration: 1,
    })
  })

  it('finishes from the durable committed outcome instead of trusting only the child exit', async () => {
    const state = harness({})

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.runner.run).toHaveBeenCalledOnce()
    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'succeeded',
      null,
      now,
    )
  })

  it('turns a running pause request into an abort and a durable paused job without failing the operation', async () => {
    let entered!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    const runner: AgentExecutorRunner = {
      run: vi.fn(
        input =>
          new Promise<AgentExecutorWorkflowResult>((_resolve, reject) => {
            entered()
            input.signal?.addEventListener(
              'abort',
              () => reject(new AgentExecutorAbortedError(input.signal?.reason === 'pause' ? 'pause' : 'cancel')),
              { once: true },
            )
          }),
      ),
    }
    const state = harness({ runner })

    const running = state.service.runOnce()
    await started
    await state.service.control('actor-1', dispatch().projectId, 'operation-1', 'pause')
    await running

    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'paused',
      null,
      now,
    )
  })

  it('reports one sanitized terminal outcome when a running operation is canceled', async () => {
    let entered!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    const runner: AgentExecutorRunner = {
      run: vi.fn(
        input =>
          new Promise<AgentExecutorWorkflowResult>((_resolve, reject) => {
            entered()
            input.signal?.addEventListener('abort', () => reject(new AgentExecutorAbortedError('cancel')), {
              once: true,
            })
          }),
      ),
    }
    const reportOutcome = vi.fn()
    const state = harness({ runner, reportOutcome })

    const running = state.service.runOnce()
    await started
    await state.service.control('actor-1', dispatch().projectId, 'operation-1', 'cancel')
    await running

    expect(state.current().state).toBe('canceled')
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith({
      recoveryClass: 'terminal',
      operationId: 'operation-1',
      durableStatus: 'failed_not_applied',
      hasCommitReceipt: false,
      errorCode: 'executor_canceled',
    })
  })

  it('leaves ownership untouched when heartbeat fencing is lost so a new generation can recover', async () => {
    let entered!: () => void
    const started = new Promise<void>(resolve => {
      entered = resolve
    })
    const runner: AgentExecutorRunner = {
      run: vi.fn(
        input =>
          new Promise<AgentExecutorWorkflowResult>((_resolve, reject) => {
            entered()
            input.signal?.addEventListener('abort', () => reject(new AgentExecutorAbortedError('cancel')), {
              once: true,
            })
          }),
      ),
    }
    const state = harness({ runner, heartbeatMs: 1 })
    vi.mocked(state.store.heartbeatAgentRunDispatch).mockResolvedValueOnce(null)

    await state.service.runOnce()
    await started

    expect(state.store.finishAgentRunDispatch).not.toHaveBeenCalled()
  })

  it('reconciles a committed receipt after an executor process error without marking the task failed', async () => {
    let reads = 0
    const reportOutcome = vi.fn()
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(new Error('process exited'))) },
      readOperation: async () => (++reads === 1 ? operation('issued') : operation('committed')),
      reportOutcome,
    })

    await state.service.runOnce()

    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'succeeded',
      null,
      now,
    )
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith({
      recoveryClass: 'committed',
      operationId: 'operation-1',
      durableStatus: 'committed',
      committedDraftVersion: 2,
      hasCommitReceipt: true,
      errorCode: null,
    })
  })

  it('does not claim commit-receipt evidence when the durable host receipt is missing', async () => {
    const reportOutcome = vi.fn()
    const state = harness({
      readOperation: async () => operation('committed', { hostReceipt: null }),
      reportOutcome,
    })

    await state.service.runOnce()

    expect(state.runner.run).not.toHaveBeenCalled()
    expect(reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryClass: 'committed', hasCommitReceipt: false }),
    )
  })

  it('leaves a prepared operation recoverable for the same dispatch and operation identity', async () => {
    let reads = 0
    const failOperation = vi.fn(async () => operation('failed_not_applied'))
    const reportOutcome = vi.fn()
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(new Error('process exited'))) },
      readOperation: async () => (++reads === 1 ? operation('issued') : operation('prepared')),
      failOperation,
      reportOutcome,
    })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(failOperation).not.toHaveBeenCalled()
    expect(state.store.finishAgentRunDispatch).not.toHaveBeenCalled()
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith({
      recoveryClass: 'recover_operation',
      operationId: 'operation-1',
      durableStatus: 'prepared',
      hasCommitReceipt: false,
      errorCode: 'executor_failed',
    })
  })

  it('retries an issued transient executor failure exactly once with the same operation identity', async () => {
    const reportOutcome = vi.fn()
    const failOperation = vi.fn(async () => operation('failed_not_applied'))
    const runnerError = new AgentExecutorRunnerError('EXECUTOR_TIMEOUT', {
      exitCode: null,
      stdoutBytes: 0,
      stdoutSha256: 'a'.repeat(64),
      stderrBytes: 0,
      stderrSha256: 'b'.repeat(64),
    })
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(runnerError)) },
      failOperation,
      reportOutcome,
    })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(failOperation).not.toHaveBeenCalled()
    expect(state.store.finishAgentRunDispatch).not.toHaveBeenCalled()
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith({
      recoveryClass: 'retry_same',
      operationId: 'operation-1',
      durableStatus: 'issued',
      hasCommitReceipt: false,
      errorCode: 'EXECUTOR_TIMEOUT',
    })
  })

  it('terminalizes the issued operation after the one transient retry is exhausted', async () => {
    const reportOutcome = vi.fn()
    const failOperation = vi.fn(async () => operation('failed_not_applied'))
    const runnerError = new AgentExecutorRunnerError('EXECUTOR_PROCESS_FAILED', {
      exitCode: 17,
      stdoutBytes: 0,
      stdoutSha256: 'a'.repeat(64),
      stderrBytes: 0,
      stderrSha256: 'b'.repeat(64),
    })
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(runnerError)) },
      failOperation,
      reportOutcome,
    })
    state.setCurrent(dispatch({ attemptCount: 2 }))

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(failOperation).toHaveBeenCalledOnce()
    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'failed',
      { code: 'executor_retry_exhausted', message: 'Document executor retry limit was exhausted' },
      now,
    )
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryClass: 'terminal',
        durableStatus: 'failed_not_applied',
        errorCode: 'executor_retry_exhausted',
      }),
    )
  })

  it('maps rejected-stale and indeterminate durable outcomes to stable terminal codes without running again', async () => {
    const staleReport = vi.fn()
    const stale = harness({ readOperation: async () => operation('rejected_stale'), reportOutcome: staleReport })

    await stale.service.runOnce()

    expect(stale.runner.run).not.toHaveBeenCalled()
    expect(stale.current().errorCode).toBe('replan_remaining')
    expect(staleReport).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryClass: 'replan_remaining', durableStatus: 'rejected_stale' }),
    )

    const unknownReport = vi.fn()
    const unknown = harness({ readOperation: async () => operation('indeterminate'), reportOutcome: unknownReport })

    await unknown.service.runOnce()

    expect(unknown.runner.run).not.toHaveBeenCalled()
    expect(unknown.current().state).toBe('indeterminate')
    expect(unknown.current().errorCode).toBe('unknown_commit_outcome')
    expect(unknownReport).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryClass: 'terminal', durableStatus: 'indeterminate' }),
    )
  })

  it('classifies invalid workflow results as revise-step after terminalizing the non-applied operation', async () => {
    const reportOutcome = vi.fn()
    const failOperation = vi.fn(async () =>
      operation('failed_not_applied', { outcome: { reason: 'EXECUTOR_INVALID_WORKFLOW_RESULT' } }),
    )
    const runnerError = new AgentExecutorRunnerError('EXECUTOR_INVALID_WORKFLOW_RESULT', {
      exitCode: 0,
      stdoutBytes: 12,
      stdoutSha256: 'a'.repeat(64),
      stderrBytes: 0,
      stderrSha256: 'b'.repeat(64),
    })
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(runnerError)) },
      failOperation,
      reportOutcome,
    })

    await state.service.runOnce()

    expect(failOperation).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryClass: 'revise_step',
        durableStatus: 'failed_not_applied',
        errorCode: 'EXECUTOR_INVALID_WORKFLOW_RESULT',
      }),
    )
  })

  it('restores an already failed non-applied operation as one stable terminal outcome', async () => {
    const reportOutcome = vi.fn()
    const state = harness({
      readOperation: async () => operation('failed_not_applied', { outcome: { reason: 'policy_denied' } }),
      reportOutcome,
    })

    await state.service.runOnce()

    expect(state.runner.run).not.toHaveBeenCalled()
    expect(state.current().state).toBe('failed')
    expect(state.current().errorCode).toBe('terminal')
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith({
      recoveryClass: 'terminal',
      operationId: 'operation-1',
      durableStatus: 'failed_not_applied',
      hasCommitReceipt: false,
      errorCode: 'terminal',
    })
  })

  it('leaves the dispatch recoverable when durable outcome reads fail', async () => {
    const readOperation = vi.fn(async () => Promise.reject(new Error('database unavailable')))
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(new Error('process exited'))) },
      readOperation,
    })

    await expect(state.service.runOnce()).rejects.toThrow('database unavailable')
    expect(readOperation).toHaveBeenCalled()
    expect(state.store.finishAgentRunDispatch).not.toHaveBeenCalled()
  })

  it('does not terminalize the dispatch when operation failure persistence is rejected', async () => {
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(new Error('process exited'))) },
      failOperation: vi.fn(async () => Promise.reject(new Error('database unavailable'))),
    })

    await expect(state.service.runOnce()).rejects.toThrow('database unavailable')
    expect(state.store.finishAgentRunDispatch).not.toHaveBeenCalled()
  })

  it('honors a committed CAS result that wins while failure persistence is being attempted', async () => {
    const reportOutcome = vi.fn()
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(new Error('process exited'))) },
      failOperation: vi.fn(async () => operation('committed')),
      reportOutcome,
    })

    await state.service.runOnce()

    expect(state.current().state).toBe('succeeded')
    expect(state.current().errorCode).toBeNull()
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryClass: 'committed', durableStatus: 'committed', errorCode: null }),
    )
  })

  it('persists the safe failure code and message reported by the executor CLI', async () => {
    const runnerError = new AgentExecutorRunnerError(
      'EXECUTOR_CLI_REPORTED_FAILURE',
      {
        exitCode: 1,
        stdoutBytes: 128,
        stdoutSha256: 'a'.repeat(64),
        stderrBytes: 0,
        stderrSha256: 'b'.repeat(64),
      },
      { code: 'DOCUMENT_MUTATION_REJECTED', message: '文档变更被编辑器拒绝' },
    )
    const state = harness({ runner: { run: vi.fn(async () => Promise.reject(runnerError)) } })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'failed',
      { code: 'DOCUMENT_MUTATION_REJECTED', message: '文档变更被编辑器拒绝' },
      now,
    )
  })

  it('reports only the runner error code for a recoverable non-CLI failure', async () => {
    const stdoutSecret = 'stdout-secret-SENTINEL'
    const stderrSecret = 'stderr-secret-SENTINEL'
    const runnerError = new AgentExecutorRunnerError('EXECUTOR_PROCESS_FAILED', {
      exitCode: 17,
      stdoutBytes: stdoutSecret.length,
      stdoutSha256: 'a'.repeat(64),
      stderrBytes: stderrSecret.length,
      stderrSha256: 'b'.repeat(64),
    })
    const reportOutcome = vi.fn()
    const state = harness({ runner: { run: vi.fn(async () => Promise.reject(runnerError)) }, reportOutcome })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.finishAgentRunDispatch).not.toHaveBeenCalled()
    expect(reportOutcome).toHaveBeenCalledOnce()
    expect(reportOutcome).toHaveBeenCalledWith({
      recoveryClass: 'retry_same',
      operationId: 'operation-1',
      durableStatus: 'issued',
      hasCommitReceipt: false,
      errorCode: 'EXECUTOR_PROCESS_FAILED',
    })
    expect(JSON.stringify(state.current())).not.toContain(stdoutSecret)
    expect(JSON.stringify(state.current())).not.toContain(stderrSecret)
    expect(JSON.stringify(reportOutcome.mock.calls)).not.toContain(stdoutSecret)
    expect(JSON.stringify(reportOutcome.mock.calls)).not.toContain(stderrSecret)
  })
})
