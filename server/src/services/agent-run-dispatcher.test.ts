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

function operation(status: AgentSpikeOperationRecord['status']): AgentSpikeOperationRecord {
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
    candidateDigest: null,
    preparedDigest: null,
    candidateSchema: null,
    hostReceipt: null,
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
  }
}

function harness(input: {
  runner?: AgentExecutorRunner
  readOperation?: () => Promise<AgentSpikeOperationRecord | null>
  failOperation?: () => Promise<AgentSpikeOperationRecord | 'integrity_conflict' | 'invalid_state' | null>
  heartbeatMs?: number
  restoreExecution?: AgentRunDispatcherOptions['restoreExecution']
  planRun?: AgentRunDispatcherOptions['planRun']
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
        input: { operationId: 'operation-1', grantToken: 'grant', recoveryGrantToken: 'recovery' },
      })),
    readOperation: input.readOperation ?? (async () => durable),
    planRun: input.planRun,
    failOperation:
      input.failOperation ??
      vi.fn(async () => {
        durable = operation('failed_not_applied')
        return durable
      }),
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
      input: { operationId: 'operation-1', grantToken: 'grant', recoveryGrantToken: 'recovery' },
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
    const state = harness({
      runner: { run: vi.fn(async () => Promise.reject(new Error('process exited'))) },
      readOperation: async () => operation('committed'),
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

  it('persists only the runner error code and a fixed message for non-CLI failures', async () => {
    const stdoutSecret = 'stdout-secret-SENTINEL'
    const stderrSecret = 'stderr-secret-SENTINEL'
    const runnerError = new AgentExecutorRunnerError('EXECUTOR_PROCESS_FAILED', {
      exitCode: 17,
      stdoutBytes: stdoutSecret.length,
      stdoutSha256: 'a'.repeat(64),
      stderrBytes: stderrSecret.length,
      stderrSha256: 'b'.repeat(64),
    })
    const state = harness({ runner: { run: vi.fn(async () => Promise.reject(runnerError)) } })

    await expect(state.service.runOnce()).resolves.toBe(true)

    expect(state.store.finishAgentRunDispatch).toHaveBeenLastCalledWith(
      'actor-1',
      'dispatch-1',
      'worker-1',
      1,
      'failed',
      {
        code: 'EXECUTOR_PROCESS_FAILED',
        message: 'Document executor failed [EXECUTOR_PROCESS_FAILED]',
      },
      now,
    )
    expect(JSON.stringify(state.current())).not.toContain(stdoutSecret)
    expect(JSON.stringify(state.current())).not.toContain(stderrSecret)
  })
})
