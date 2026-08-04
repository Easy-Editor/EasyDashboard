import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'
import type { AgentRunDispatchRecord, Repository } from '../types.js'
import {
  agentSpikeOperations,
  projectPublications,
  projectReleases,
  projectRevisions,
  projects,
  userSettings,
} from './schema.js'

const transaction = vi.fn()
const dbExecute = vi.hoisted(() => vi.fn())
const poolQuery = vi.hoisted(() => vi.fn())
const storageInfo = vi.hoisted(() =>
  vi.fn(async () => ({ data: { size: 1024, contentType: 'image/webp' }, error: null })),
)
const storageRemove = vi.hoisted(() =>
  vi.fn<(paths: string[]) => Promise<{ data: unknown[]; error: Error | null }>>(async () => ({
    data: [],
    error: null,
  })),
)
const storageDownload = vi.hoisted(() =>
  vi.fn<(path: string) => Promise<{ data: Blob | null; error: Error | null }>>(async () => ({
    data: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]),
    error: null,
  })),
)
const storageSignUpload = vi.hoisted(() =>
  vi.fn(async (path: string) => ({ data: { signedUrl: `https://upload.test/${path}`, token: 'token' }, error: null })),
)

vi.mock('./client.js', () => ({
  createDatabase: () => ({
    db: { transaction, execute: dbExecute },
    pool: { query: poolQuery },
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        info: storageInfo,
        remove: storageRemove,
        download: storageDownload,
        createSignedUploadUrl: storageSignUpload,
      }),
    },
  }),
}))

const env = {} as AppEnv

function selectResult(result: unknown[], lockCalls: string[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn((_condition: unknown) => chain),
    for: vi.fn((lock: string) => {
      lockCalls.push(lock)
      return chain
    }),
    limit: vi.fn(async () => result),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
  }
  chain.from.mockReturnValue(chain)
  chain.innerJoin.mockReturnValue(chain)
  chain.leftJoin.mockReturnValue(chain)
  return chain
}

function agentAssetStatusUpdate(storagePath: string | (() => string) = 'actor-1/project-1/asset-1/image.png') {
  const returning = vi.fn(async () => [
    { storagePath: typeof storagePath === 'function' ? storagePath() : storagePath },
  ])
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))
  return { tx: { execute: vi.fn(), update }, update, set, where, returning }
}

describe('database readiness', () => {
  beforeEach(() => {
    poolQuery.mockReset()
  })

  it('checks the release, thumbnail artifact, and Agent operation schema without reading rows', async () => {
    poolQuery.mockResolvedValue({ rows: [] })
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).ping()).resolves.toBeUndefined()

    expect(poolQuery).toHaveBeenCalledOnce()
    const query = poolQuery.mock.calls[0]?.[0] as string
    expect(query).toContain('from app.project_releases as releases')
    expect(query).toContain('cross join app.project_publish_snapshots as publish_snapshots')
    expect(query).toContain('cross join app.project_preview_runs as preview_runs')
    expect(query).toContain('cross join app.project_publish_approvals as publish_approvals')
    expect(query).toContain('cross join app.project_thumbnail_artifacts as thumbnail_artifacts')
    expect(query).toContain('cross join app.agent_spike_operations as agent_operations')
    expect(query).toContain('cross join app.agent_run_costs as agent_costs')
    expect(query).toContain('cross join app.agent_run_dispatches as agent_dispatches')
    expect(query).toContain('agent_costs.billing_scope')
    expect(query).toContain('agent_costs.payer_id')
    expect(query).toContain('agent_costs.turn_id')
    expect(query).toContain('agent_costs.decision_output')
    expect(query).toContain('agent_costs.decision_usage')
    expect(query).toContain('agent_costs.decision_trace')
    expect(query).toContain('agent_assets.storage_cleanup_status')
    expect(query).toContain('agent_assets.storage_cleanup_attempts')
    expect(query).toContain('projects.agent_model_configuration')
    expect(query).toContain('releases.release_number')
    expect(query).toContain('releases.publish_snapshot_id')
    expect(query).toContain('thumbnail_artifacts.status')
    expect(query).toContain('agent_operations.status')
    expect(query).toContain('agent_dispatches.desired_state')
    expect(query).toContain('limit 0')
  })

  it('propagates a missing migration error', async () => {
    const missingSchema = new Error('relation "app.project_releases" does not exist')
    poolQuery.mockRejectedValue(missingSchema)
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).ping()).rejects.toBe(missingSchema)
  })
})

describe('Agent user preference repository', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('atomically patches public settings while preserving reserved preference memory', async () => {
    const preferenceMemory = {
      version: 1,
      revision: 2,
      enabled: true,
      preferences: [],
      updatedAt: '2026-08-01T09:00:00.000Z',
    }
    const lockCalls: string[] = []
    const currentSelection = selectResult(
      [
        {
          settings: {
            displayName: 'Owner',
            agentPreferenceMemory: preferenceMemory,
            agentModelConfiguration: { user: { encryptedSecret: { ciphertext: 'server-only' } } },
          },
        },
      ],
      lockCalls,
    )
    let inserted: Record<string, unknown> | undefined
    const returning = vi.fn(async () => [{ settings: inserted?.settings }])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const values = vi.fn((value: Record<string, unknown>) => {
      inserted = value
      return { onConflictDoUpdate }
    })
    const tx = {
      execute: vi.fn(async (_query: unknown) => undefined),
      select: vi.fn(() => currentSelection),
      insert: vi.fn(() => ({ values })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).updateSettings('actor', {
        autosave: false,
        agentPreferenceMemory: { ...preferenceMemory, revision: 1 },
      }),
    ).resolves.toEqual({
      displayName: 'Owner',
      autosave: false,
      agentPreferenceMemory: preferenceMemory,
      agentModelConfiguration: { user: { encryptedSecret: { ciphertext: 'server-only' } } },
    })

    expect(lockCalls).toEqual(['update'])
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'actor',
        settings: expect.objectContaining({ agentPreferenceMemory: preferenceMemory, autosave: false }),
      }),
    )
    const advisory = new PgDialect().sqlToQuery(tx.execute.mock.calls[1]?.[0] as SQL)
    expect(advisory.sql).toContain('pg_advisory_xact_lock')
  })

  it('serializes CAS updates and preserves unrelated user settings', async () => {
    const currentSettings = {
      displayName: 'Owner',
      agentPreferenceMemory: { version: 1, revision: 2, enabled: true, preferences: [], updatedAt: null },
    }
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [{ settings: currentSettings }]),
    }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    let inserted: Record<string, unknown> | undefined
    const onConflictDoUpdate = vi.fn(async () => undefined)
    const values = vi.fn((value: Record<string, unknown>) => {
      inserted = value
      return { onConflictDoUpdate }
    })
    const tx = {
      execute: vi.fn(async (_query: unknown) => undefined),
      select: vi.fn(() => selectChain),
      insert: vi.fn((table: unknown) => {
        expect(table).toBe(userSettings)
        return { values }
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')
    const memory = {
      version: 1 as const,
      revision: 3,
      enabled: false,
      preferences: [],
      updatedAt: '2026-08-01T10:00:00.000Z',
    }

    await expect(createPgRepository(env).compareAndSetAgentUserPreferenceMemory?.('actor', 2, memory)).resolves.toBe(
      true,
    )

    expect(tx.execute).toHaveBeenCalledTimes(2)
    const advisory = new PgDialect().sqlToQuery(tx.execute.mock.calls[1]?.[0] as SQL)
    expect(advisory.sql).toContain('pg_advisory_xact_lock')
    expect(inserted).toEqual({
      userId: 'actor',
      settings: { displayName: 'Owner', agentPreferenceMemory: memory },
    })
    expect(onConflictDoUpdate).toHaveBeenCalledOnce()
  })

  it('returns a CAS conflict without writing', async () => {
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [
        {
          settings: {
            agentPreferenceMemory: { version: 1, revision: 4, enabled: false, preferences: [], updatedAt: null },
          },
        },
      ]),
    }
    selectChain.from.mockReturnValue(selectChain)
    selectChain.where.mockReturnValue(selectChain)
    const tx = { execute: vi.fn(), select: vi.fn(() => selectChain), insert: vi.fn() }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).compareAndSetAgentUserPreferenceMemory?.('actor', 3, {
        version: 1,
        revision: 4,
        enabled: false,
        preferences: [],
        updatedAt: '2026-08-01T10:00:00.000Z',
      }),
    ).resolves.toBe(false)
    expect(tx.insert).not.toHaveBeenCalled()
  })
})

describe('Agent run dispatch repository', () => {
  const dispatch: AgentRunDispatchRecord = {
    id: 'dispatch-1',
    actorId: 'actor-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    taskId: 'task-1',
    operationId: 'operation-1',
    kind: 'run',
    waitingReason: null,
    state: 'queued',
    desiredState: 'running',
    generation: 0,
    leaseOwner: null,
    leaseUntil: null,
    heartbeatAt: null,
    attemptCount: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    completedAt: null,
  }
  const rawDispatch = (value: AgentRunDispatchRecord = dispatch) => ({
    id: value.id,
    actorId: value.actorId,
    projectId: value.projectId,
    conversationId: value.conversationId,
    taskId: value.taskId,
    operationId: value.operationId,
    kind: value.kind,
    waitingReason: value.waitingReason,
    state: value.state,
    desiredState: value.desiredState,
    generation: value.generation,
    leaseOwner: value.leaseOwner,
    leaseUntil: value.leaseUntil,
    heartbeatAt: value.heartbeatAt,
    attemptCount: value.attemptCount,
    errorCode: value.errorCode,
    errorMessage: value.errorMessage,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
  })

  beforeEach(() => {
    transaction.mockReset()
    dbExecute.mockReset()
  })

  it('replays an identical enqueue and rejects rebinding the same actor operation', async () => {
    const replayTx = {
      execute: vi.fn(),
      select: vi.fn(() => selectResult([dispatch], [])),
      insert: vi.fn(),
    }
    const conflictTx = {
      execute: vi.fn(),
      select: vi.fn(() => selectResult([dispatch], [])),
      insert: vi.fn(),
    }
    transaction.mockImplementationOnce(async run => run(replayTx)).mockImplementationOnce(async run => run(conflictTx))
    const { createPgRepository } = await import('./repository.js')
    const repository = createPgRepository(env) as any

    await expect(
      repository.enqueueAgentRunDispatch('actor-1', {
        projectId: dispatch.projectId,
        conversationId: dispatch.conversationId,
        taskId: dispatch.taskId,
        operationId: dispatch.operationId,
      }),
    ).resolves.toEqual(dispatch)
    await expect(
      repository.enqueueAgentRunDispatch('actor-1', {
        projectId: dispatch.projectId,
        conversationId: dispatch.conversationId,
        taskId: 'different-task',
        operationId: dispatch.operationId,
      }),
    ).rejects.toThrow('rebound to a different task')

    expect(replayTx.insert).not.toHaveBeenCalled()
    expect(conflictTx.insert).not.toHaveBeenCalled()
  })

  it('returns at most one dispatch across competing worker claims', async () => {
    const claimed: AgentRunDispatchRecord = {
      ...dispatch,
      state: 'running',
      generation: 1,
      leaseOwner: 'worker-1',
      leaseUntil: new Date('2026-08-01T00:01:00.000Z'),
      heartbeatAt: new Date('2026-08-01T00:00:00.000Z'),
      attemptCount: 1,
    }
    dbExecute.mockResolvedValueOnce({ rows: [rawDispatch(claimed)] }).mockResolvedValueOnce({ rows: [] })
    const { createPgRepository } = await import('./repository.js')
    const repository = createPgRepository(env) as any
    const now = new Date('2026-08-01T00:00:00.000Z')
    const leaseUntil = new Date('2026-08-01T00:01:00.000Z')

    const [first, second] = await Promise.all([
      repository.claimAgentRunDispatch('worker-1', now, leaseUntil),
      repository.claimAgentRunDispatch('worker-2', now, leaseUntil),
    ])

    expect(first).toEqual(claimed)
    expect(second).toBeNull()
    expect(dbExecute).toHaveBeenCalledTimes(2)
  })

  it('returns the fresh generation when an expired lease is reclaimed', async () => {
    const reclaimed: AgentRunDispatchRecord = {
      ...dispatch,
      state: 'running',
      generation: 2,
      leaseOwner: 'worker-2',
      leaseUntil: new Date('2026-08-01T00:02:00.000Z'),
      heartbeatAt: new Date('2026-08-01T00:01:00.000Z'),
      attemptCount: 2,
    }
    dbExecute.mockResolvedValueOnce({ rows: [rawDispatch(reclaimed)] })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      (createPgRepository(env) as any).claimAgentRunDispatch(
        'worker-2',
        new Date('2026-08-01T00:01:00.000Z'),
        reclaimed.leaseUntil,
      ),
    ).resolves.toEqual(reclaimed)
  })

  it('reads a dispatch by operation and the latest dispatch by task', async () => {
    const byOperation = selectResult([dispatch], [])
    const byTask = {
      from: vi.fn(() => {
        const chain = {
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(async () => [dispatch]),
        }
        chain.where.mockReturnValue(chain)
        chain.orderBy.mockReturnValue(chain)
        return chain
      }),
    }
    transaction
      .mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => byOperation) }))
      .mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => byTask) }))
    const { createPgRepository } = await import('./repository.js')
    const repository = createPgRepository(env) as any

    await expect(repository.getAgentRunDispatch('actor-1', 'project-1', 'operation-1')).resolves.toEqual(dispatch)
    await expect(repository.getAgentRunDispatchByTask('actor-1', 'project-1', 'task-1')).resolves.toEqual(dispatch)
  })

  it.each([
    ['heartbeatAgentRunDispatch', ['actor-1', dispatch.id, 'worker-old', 1, new Date(), new Date(Date.now() + 60_000)]],
    ['finishAgentRunDispatch', ['actor-1', dispatch.id, 'worker-old', 1, 'succeeded', null, new Date()]],
  ])('rejects an old generation through %s', async (method, args) => {
    let predicate: SQL | undefined
    const returning = vi.fn(async () => [])
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn((value: SQL) => {
            predicate = value
            return { returning }
          }),
        })),
      })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect((createPgRepository(env) as any)[method](...args)).resolves.toBeNull()

    const query = new PgDialect().sqlToQuery(predicate as SQL)
    expect(query.sql).toContain('"generation" = $')
    expect(query.sql).toContain('"lease_owner" = $')
    expect(query.sql).toContain('"lease_until" > $')
    expect(query.params).toContain('worker-old')
    expect(query.params).toContain(1)
  })

  it('returns the latest desired state from a fenced heartbeat', async () => {
    const pausing: AgentRunDispatchRecord = {
      ...dispatch,
      state: 'running',
      desiredState: 'paused',
      generation: 1,
      leaseOwner: 'worker-1',
      leaseUntil: new Date('2026-08-01T00:01:30.000Z'),
      heartbeatAt: new Date('2026-08-01T00:00:30.000Z'),
    }
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => [pausing]) })),
        })),
      })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      (createPgRepository(env) as any).heartbeatAgentRunDispatch(
        'actor-1',
        dispatch.id,
        'worker-1',
        1,
        new Date('2026-08-01T00:00:30.000Z'),
        new Date('2026-08-01T00:01:30.000Z'),
      ),
    ).resolves.toEqual(pausing)
  })

  it('keeps an active run running until the Worker confirms that pause completed', async () => {
    const running: AgentRunDispatchRecord = {
      ...dispatch,
      state: 'running',
      generation: 1,
      leaseOwner: 'worker-1',
      leaseUntil: new Date('2026-08-01T00:02:00.000Z'),
    }
    const pausing: AgentRunDispatchRecord = { ...running, desiredState: 'paused' }
    const set = vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => [pausing]) })),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selectResult([running], [])),
      update: vi.fn(() => ({ set })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      (createPgRepository(env) as any).controlAgentRunDispatch(
        'actor-1',
        dispatch.projectId,
        dispatch.operationId,
        'pause',
        new Date('2026-08-01T00:01:00.000Z'),
      ),
    ).resolves.toEqual(pausing)

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'running', desiredState: 'paused', leaseOwner: 'worker-1' }),
    )
  })

  it('records paused only after the fenced Worker confirms its child process stopped', async () => {
    const paused: AgentRunDispatchRecord = {
      ...dispatch,
      state: 'paused',
      desiredState: 'paused',
      generation: 1,
      heartbeatAt: new Date('2026-08-01T00:01:00.000Z'),
    }
    const set = vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => [paused]) })),
    }))
    const tx = { execute: vi.fn(), update: vi.fn(() => ({ set })) }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')
    const now = new Date('2026-08-01T00:01:00.000Z')

    await expect(
      (createPgRepository(env) as any).finishAgentRunDispatch(
        'actor-1',
        dispatch.id,
        'worker-1',
        1,
        'paused',
        null,
        now,
      ),
    ).resolves.toEqual(paused)

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'paused',
        desiredState: 'paused',
        leaseOwner: null,
        leaseUntil: null,
        completedAt: null,
      }),
    )
  })

  it('treats repeating the current control action as an idempotent replay', async () => {
    const paused = { ...dispatch, state: 'paused', desiredState: 'paused' }
    const lockCalls: string[] = []
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockImplementationOnce(() => selectResult([paused], lockCalls))
        .mockImplementationOnce(() =>
          selectResult(
            [
              {
                id: 'operation-row-1',
                actorId: 'actor-1',
                projectId: dispatch.projectId,
                operationId: dispatch.operationId,
                status: 'issued',
              },
            ],
            lockCalls,
          ),
        ),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      (createPgRepository(env) as any).controlAgentRunDispatch(
        'actor-1',
        dispatch.projectId,
        dispatch.operationId,
        'pause',
        new Date('2026-08-01T00:00:00.000Z'),
      ),
    ).resolves.toEqual(paused)

    expect(lockCalls).toEqual(['update', 'update'])
    expect(tx.update).not.toHaveBeenCalled()
  })

  it.each([
    [
      'resume',
      { ...dispatch, state: 'paused' as const, desiredState: 'paused' as const },
      { state: 'queued', desiredState: 'running', leaseOwner: null, leaseUntil: null },
    ],
    ['cancel', dispatch, { state: 'canceled', desiredState: 'canceled', leaseOwner: null, leaseUntil: null }],
    [
      'cancel',
      { ...dispatch, state: 'paused' as const, desiredState: 'paused' as const },
      { state: 'canceled', desiredState: 'canceled', leaseOwner: null, leaseUntil: null },
    ],
    [
      'cancel',
      {
        ...dispatch,
        state: 'running' as const,
        generation: 1,
        leaseOwner: 'worker-1',
        leaseUntil: new Date('2026-08-01T00:00:30.000Z'),
      },
      { state: 'canceled', desiredState: 'canceled', leaseOwner: null, leaseUntil: null },
    ],
  ])('persists the %s control transition', async (action, current, expected) => {
    const next = {
      ...current,
      ...expected,
      completedAt: action === 'cancel' ? new Date('2026-08-01T00:01:00.000Z') : null,
    }
    const set = vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => [next]) })),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockImplementationOnce(() => selectResult([current], []))
        .mockImplementationOnce(() =>
          selectResult(
            [
              {
                id: 'operation-row-1',
                actorId: 'actor-1',
                projectId: dispatch.projectId,
                operationId: dispatch.operationId,
                status: 'issued',
              },
            ],
            [],
          ),
        ),
      update: vi.fn(() => ({ set })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')
    const now = new Date('2026-08-01T00:01:00.000Z')

    await expect(
      (createPgRepository(env) as any).controlAgentRunDispatch(
        'actor-1',
        dispatch.projectId,
        dispatch.operationId,
        action,
        now,
      ),
    ).resolves.toEqual(next)

    expect(set).toHaveBeenCalledWith(expect.objectContaining(expected))
    if (action === 'cancel') {
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed_not_applied',
          outcome: { status: 'failed_not_applied', reason: 'user_canceled' },
          completedAt: now,
        }),
      )
    }
  })

  it('maps a committed operation to succeeded when pause races an expired lease', async () => {
    const expired = {
      ...dispatch,
      state: 'running' as const,
      generation: 1,
      leaseOwner: 'worker-1',
      leaseUntil: new Date('2026-08-01T00:00:30.000Z'),
    }
    const succeeded = {
      ...expired,
      state: 'succeeded' as const,
      desiredState: 'paused' as const,
      leaseOwner: null,
      leaseUntil: null,
      completedAt: new Date('2026-08-01T00:01:00.000Z'),
    }
    const lockOrder: string[] = []
    const set = vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => [succeeded]) })),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockImplementationOnce(() => {
          lockOrder.push('dispatch')
          return selectResult([expired], [])
        })
        .mockImplementationOnce(() => {
          lockOrder.push('operation')
          return selectResult(
            [
              {
                id: 'operation-row-1',
                actorId: 'actor-1',
                projectId: dispatch.projectId,
                operationId: dispatch.operationId,
                status: 'committed',
                outcome: { status: 'committed' },
              },
            ],
            [],
          )
        }),
      update: vi.fn(() => ({ set })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      (createPgRepository(env) as any).controlAgentRunDispatch(
        'actor-1',
        dispatch.projectId,
        dispatch.operationId,
        'pause',
        new Date('2026-08-01T00:01:00.000Z'),
      ),
    ).resolves.toEqual(succeeded)
    expect(lockOrder).toEqual(['dispatch', 'operation'])
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'succeeded',
        desiredState: 'paused',
        leaseOwner: null,
        leaseUntil: null,
      }),
    )
  })
})

describe('signed thumbnail upload expiry', () => {
  it('starts the cleanup deadline after delayed signing and keeps a safety margin', async () => {
    const requestStartedAt = Date.parse('2026-07-30T00:00:00.000Z')
    const signedAt = requestStartedAt + 10 * 60 * 1000
    const tokenExpiresAt = signedAt + 2 * 60 * 60 * 1000
    const payload = Buffer.from(JSON.stringify({ exp: tokenExpiresAt / 1000 })).toString('base64url')
    const token = `header.${payload}.signature`
    const { signedThumbnailUploadCleanupExpiry } = await import('./repository.js')

    const cleanupAt = signedThumbnailUploadCleanupExpiry(token, signedAt)

    expect(cleanupAt.getTime()).toBe(tokenExpiresAt + 60_000)
    expect(cleanupAt.getTime()).toBeGreaterThan(requestStartedAt + 2 * 60 * 60 * 1000)
  })

  it('falls back to two hours after signing when the token representation changes', async () => {
    const signedAt = Date.parse('2026-07-30T00:10:00.000Z')
    const { signedThumbnailUploadCleanupExpiry } = await import('./repository.js')

    expect(signedThumbnailUploadCleanupExpiry('opaque-token', signedAt).getTime()).toBe(
      signedAt + 2 * 60 * 60 * 1000 + 60_000,
    )
  })
})

describe('Agent creation idempotency repository', () => {
  beforeEach(() => {
    transaction.mockReset()
    storageSignUpload.mockClear()
    storageRemove.mockClear()
  })

  it('returns the persisted start aggregate instead of inserting a second project', async () => {
    const createdAt = new Date('2026-07-31T12:00:00.000Z')
    const project = {
      id: 'project-1',
      name: '城市态势大屏',
      description: null,
      draftSchema: { componentsTree: [] },
      createdAt,
      updatedAt: createdAt,
    }
    const workspace = {
      ownerId: 'actor-1',
      projectId: project.id,
      revision: 1,
      payload: { conversations: [{ id: 'conversation-1', tasks: [{ id: 'task-1' }] }] },
      createdAt,
      updatedAt: createdAt,
    }
    const dispatch = {
      id: 'dispatch-1',
      actorId: 'actor-1',
      projectId: project.id,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      operationId: 'operation-1',
      kind: 'initial',
      waitingReason: null,
      state: 'queued',
      desiredState: 'running',
    }
    const selections = [
      selectResult([{ id: project.id, inputDigest: 'a'.repeat(64) }], []),
      selectResult([workspace], []),
      selectResult([project], []),
      selectResult([dispatch], []),
    ]
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      insert: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).startAgentProject?.('actor-1', {
        project: {
          id: 'new-project-id-that-must-not-be-used',
          name: project.name,
          schema: { componentsTree: [] },
        },
        workspacePayload: {},
        dispatch: {
          conversationId: 'conversation-1',
          taskId: 'task-1',
          operationId: 'operation-1',
          waitingForUpload: false,
        },
        idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        inputDigest: 'a'.repeat(64),
      }),
    ).resolves.toEqual({ project, workspace, dispatch })
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('replays a semantic start without requiring or fabricating a legacy dispatch', async () => {
    const createdAt = new Date('2026-08-04T12:00:00.000Z')
    const project = {
      id: 'project-semantic',
      name: 'Semantic dashboard',
      description: null,
      draftSchema: { componentsTree: [] },
      createdAt,
      updatedAt: createdAt,
    }
    const workspace = {
      ownerId: 'actor-1',
      projectId: project.id,
      revision: 1,
      payload: { version: 2, conversations: [{ id: 'conversation-1', tasks: [{ id: 'task-1' }] }] },
      createdAt,
      updatedAt: createdAt,
    }
    const selections = [
      selectResult([{ id: project.id, inputDigest: 'b'.repeat(64) }], []),
      selectResult([workspace], []),
      selectResult([project], []),
    ]
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      insert: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).startAgentProject?.('actor-1', {
        project: {
          id: 'unused-project-id',
          name: project.name,
          schema: { componentsTree: [] },
        },
        workspacePayload: {},
        createLegacyDispatch: false,
        idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        inputDigest: 'b'.repeat(64),
      }),
    ).resolves.toEqual({ project, workspace })
    expect(tx.select).toHaveBeenCalledTimes(3)
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('returns the same asset upload binding for a selected-file retry', async () => {
    const existing = {
      id: 'asset-1',
      actorId: 'actor-1',
      idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      projectId: 'project-1',
      conversationId: null,
      originalName: 'data.csv',
      contentType: 'text/csv',
      size: 12,
      status: 'ready',
      storagePath: 'actor-1/project-1/asset-1/data.csv',
    }
    const lockCalls: string[] = []
    const selections = [selectResult([{ id: 'project-1' }], lockCalls), selectResult([existing], lockCalls)]
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      insert: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).createAgentAssetUpload?.('actor-1', 'access', 'project-1', {
        idempotencyKey: existing.idempotencyKey,
        scope: 'project',
        name: existing.originalName,
        contentType: existing.contentType,
        size: existing.size,
      }),
    ).resolves.toMatchObject({
      id: existing.id,
      path: existing.storagePath,
      alreadyCompleted: true,
      asset: { id: existing.id, originalName: existing.originalName },
    })
    expect(tx.insert).not.toHaveBeenCalled()
    expect(storageSignUpload).not.toHaveBeenCalled()
    expect(lockCalls).toEqual(['update'])
  })

  it('reclaims expired upload objects while issuing the next upload URL', async () => {
    const existing = {
      id: 'asset-ready',
      actorId: 'actor-1',
      idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      projectId: 'project-1',
      conversationId: null,
      originalName: 'data.csv',
      contentType: 'text/csv',
      size: 12,
      status: 'ready',
      storagePath: 'actor-1/project-1/asset-ready/data.csv',
    }
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ storage_path: 'actor-1/project-1/asset-stale/old.csv' }] })
    const selections = [selectResult([{ id: 'project-1' }], []), selectResult([existing], [])]
    const tx = {
      execute,
      select: vi.fn(() => selections.shift()),
      insert: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).createAgentAssetUpload?.('actor-1', 'access', 'project-1', {
        idempotencyKey: existing.idempotencyKey,
        scope: 'project',
        name: existing.originalName,
        contentType: existing.contentType,
        size: existing.size,
      }),
    ).resolves.toMatchObject({ id: existing.id, alreadyCompleted: true })
    expect(storageRemove).toHaveBeenCalledWith(['actor-1/project-1/asset-stale/old.csv'])
    expect(storageSignUpload).not.toHaveBeenCalled()
  })

  it('rejects rebinding an existing selected-file key to another project', async () => {
    const existing = {
      id: 'asset-1',
      actorId: 'actor-1',
      idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      projectId: 'project-1',
      conversationId: null,
      originalName: 'data.csv',
      contentType: 'text/csv',
      size: 12,
      status: 'ready',
      storagePath: 'path',
    }
    const selections = [selectResult([{ id: 'project-2' }], []), selectResult([existing], [])]
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).createAgentAssetUpload?.('actor-1', 'access', 'project-2', {
        idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        scope: 'project',
        name: 'data.csv',
        contentType: 'text/csv',
        size: 12,
      }),
    ).resolves.toBe('conflict')
    expect(storageSignUpload).not.toHaveBeenCalled()
  })

  it('does not revive a failed upload through the same selected-file key', async () => {
    const failedAsset = {
      id: 'asset-failed',
      actorId: 'actor-1',
      idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      projectId: 'project-1',
      conversationId: null,
      originalName: 'data.csv',
      contentType: 'text/csv',
      size: 12,
      status: 'failed',
      storagePath: 'path',
    }
    const selections = [selectResult([{ id: 'project-1' }], []), selectResult([failedAsset], [])]
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).createAgentAssetUpload?.('actor-1', 'access', 'project-1', {
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        scope: 'project',
        name: 'data.csv',
        contentType: 'text/csv',
        size: 12,
      }),
    ).resolves.toBe('conflict')
    expect(storageSignUpload).not.toHaveBeenCalled()
  })

  it('marks a newly created asset failed when upload URL signing fails', async () => {
    const usageSelection = {
      from: vi.fn(),
      where: vi.fn(async (_condition: unknown) => [{ count: 0, size: 0 }]),
    }
    usageSelection.from.mockReturnValue(usageSelection)
    const selections = [selectResult([{ id: 'project-1' }], []), selectResult([], []), usageSelection]
    let createdStoragePath = ''
    const values = vi.fn(async (value: Record<string, unknown>) => {
      createdStoragePath = String(value.storagePath)
    })
    const initialTx = {
      execute: vi.fn(async (_query: unknown) => undefined),
      select: vi.fn(() => selections.shift()),
      insert: vi.fn(() => ({ values })),
    }
    const failed = agentAssetStatusUpdate(() => createdStoragePath)
    transaction.mockImplementationOnce(async run => run(initialTx)).mockImplementationOnce(async run => run(failed.tx))
    storageSignUpload.mockResolvedValueOnce({ data: null, error: new Error('signing unavailable') } as never)
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).createAgentAssetUpload?.('actor-1', 'access', 'project-1', {
        idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        scope: 'project',
        name: 'data.csv',
        contentType: 'text/csv',
        size: 12,
      }),
    ).rejects.toThrow('signing unavailable')

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-1', projectId: 'project-1' }))
    expect(storageRemove).toHaveBeenCalledWith([expect.stringMatching(/^actor-1\/project-1\//u)])
    expect(failed.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    const usageQuery = new PgDialect().sqlToQuery(usageSelection.where.mock.calls[0]?.[0] as SQL)
    expect(usageQuery.params).toEqual(expect.arrayContaining(['uploading', 'processing', 'ready']))
    expect(usageQuery.params).not.toContain('failed')
    const staleCleanupQuery = new PgDialect().sqlToQuery(initialTx.execute.mock.calls[3]?.[0] as SQL)
    expect(staleCleanupQuery.sql).toContain("status = 'uploading'")
    expect(staleCleanupQuery.sql).toContain('returning storage_path')
  })
})

describe('Agent asset lifecycle', () => {
  const asset = {
    id: 'asset-1',
    actorId: 'actor-1',
    projectId: 'project-1',
    contentType: 'image/png',
    size: 4,
    status: 'uploading',
    storagePath: 'actor-1/project-1/asset-1/image.png',
  }

  beforeEach(() => {
    transaction.mockReset()
    storageInfo.mockClear()
    storageDownload.mockClear()
    storageRemove.mockClear()
  })

  it('best-effort removes the uploaded object when metadata validation fails', async () => {
    const selectedAsset = selectResult([asset], [])
    const failed = agentAssetStatusUpdate()
    transaction
      .mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => selectedAsset) }))
      .mockImplementationOnce(async run => run(failed.tx))
    storageInfo.mockResolvedValueOnce({ data: { size: asset.size + 1, contentType: asset.contentType }, error: null })
    storageRemove.mockResolvedValueOnce({ data: [], error: new Error('best-effort cleanup failed') })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).completeAgentAssetUpload?.('actor-1', 'token', 'project-1', {
        id: asset.id,
        path: asset.storagePath,
      }),
    ).resolves.toBe('invalid')

    expect(storageRemove).toHaveBeenCalledWith([asset.storagePath])
    expect(failed.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('keeps an uploading asset retryable when storage download fails transiently', async () => {
    const selectedAsset = selectResult([asset], [])
    const failed = agentAssetStatusUpdate()
    transaction
      .mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => selectedAsset) }))
      .mockImplementationOnce(async run => run(failed.tx))
    storageInfo.mockResolvedValueOnce({ data: { size: asset.size, contentType: asset.contentType }, error: null })
    storageDownload.mockResolvedValueOnce({ data: null, error: new Error('download failed') })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).completeAgentAssetUpload?.('actor-1', 'token', 'project-1', {
        id: asset.id,
        path: asset.storagePath,
      }),
    ).rejects.toThrow('download failed')

    expect(storageRemove).not.toHaveBeenCalled()
    expect(failed.update).not.toHaveBeenCalled()
  })

  it('returns a ready upload idempotently without re-reading or deleting storage', async () => {
    const readyAsset = { ...asset, status: 'ready' }
    transaction.mockImplementationOnce(async run =>
      run({ execute: vi.fn(), select: vi.fn(() => selectResult([readyAsset], [])) }),
    )
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).completeAgentAssetUpload?.('actor-1', 'token', 'project-1', {
        id: readyAsset.id,
        path: readyAsset.storagePath,
      }),
    ).resolves.toMatchObject({ id: readyAsset.id, status: 'ready' })

    expect(storageInfo).not.toHaveBeenCalled()
    expect(storageDownload).not.toHaveBeenCalled()
    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('does not touch storage when edit authorization rejects completion', async () => {
    const deniedSelection = selectResult([], [])
    transaction.mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => deniedSelection) }))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).completeAgentAssetUpload?.('actor-1', 'token', 'project-1', {
        id: asset.id,
        path: asset.storagePath,
      }),
    ).resolves.toBeNull()

    expect(storageInfo).not.toHaveBeenCalled()
    expect(storageDownload).not.toHaveBeenCalled()
    expect(storageRemove).not.toHaveBeenCalled()
    const permissionQuery = new PgDialect().sqlToQuery(deniedSelection.where.mock.calls[0]?.[0] as SQL)
    expect(permissionQuery.sql).toContain('from "app"."projects"')
    expect(permissionQuery.sql).toContain('"app"."projects"."id" = "app"."agent_assets"."project_id"')
  })

  it('best-effort removes the uploaded object when its bytes do not match the declared type', async () => {
    const selectedAsset = selectResult([asset], [])
    const failed = agentAssetStatusUpdate()
    transaction
      .mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => selectedAsset) }))
      .mockImplementationOnce(async run => run(failed.tx))
    storageInfo.mockResolvedValueOnce({ data: { size: asset.size, contentType: asset.contentType }, error: null })
    storageDownload.mockResolvedValueOnce({ data: new Blob([new TextEncoder().encode('not a png')]), error: null })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).completeAgentAssetUpload?.('actor-1', 'token', 'project-1', {
        id: asset.id,
        path: asset.storagePath,
      }),
    ).resolves.toBe('invalid')

    expect(storageRemove).toHaveBeenCalledWith([asset.storagePath])
    expect(failed.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('makes an asset inaccessible and scrubs model bytes before Storage removal', async () => {
    const selectedAsset = selectResult(
      [
        {
          ...asset,
          status: 'ready',
          storageCleanupStatus: null,
        },
      ],
      [],
    )
    const markedForCleanup = agentAssetStatusUpdate()
    const cleanupFailure = agentAssetStatusUpdate()
    transaction
      .mockImplementationOnce(async run =>
        run({ execute: vi.fn(), select: vi.fn(() => selectedAsset), update: markedForCleanup.update }),
      )
      .mockImplementationOnce(async run => run(cleanupFailure.tx))
    storageRemove.mockResolvedValueOnce({ data: [], error: new Error('remove failed') })
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).rejects.toThrow(
      'remove failed',
    )

    expect(markedForCleanup.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'deleted',
        modelInputStatus: null,
        modelInputBytes: null,
        modelInputContentType: null,
        modelInputSha256: null,
        modelInputSize: null,
        storageCleanupStatus: 'pending',
      }),
    )
    expect(storageRemove).toHaveBeenCalledWith([asset.storagePath])
    expect(cleanupFailure.set).toHaveBeenCalledWith(
      expect.objectContaining({ storageCleanupLastError: 'remove failed' }),
    )
  })

  it('leaves a scrubbed pending tombstone when final cleanup persistence fails', async () => {
    const selectedAsset = selectResult([{ ...asset, status: 'ready', storageCleanupStatus: null }], [])
    const markedForCleanup = agentAssetStatusUpdate()
    transaction
      .mockImplementationOnce(async run =>
        run({ execute: vi.fn(), select: vi.fn(() => selectedAsset), update: markedForCleanup.update }),
      )
      .mockRejectedValueOnce(new Error('finalize failed'))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).rejects.toThrow(
      'finalize failed',
    )

    expect(markedForCleanup.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'deleted', storageCleanupStatus: 'pending', modelInputBytes: null }),
    )
    expect(storageRemove).toHaveBeenCalledWith([asset.storagePath])
  })

  it('preserves the Storage error when recording the cleanup failure also fails', async () => {
    const selectedAsset = selectResult([{ ...asset, status: 'ready', storageCleanupStatus: null }], [])
    const markedForCleanup = agentAssetStatusUpdate()
    transaction
      .mockImplementationOnce(async run =>
        run({ execute: vi.fn(), select: vi.fn(() => selectedAsset), update: markedForCleanup.update }),
      )
      .mockRejectedValueOnce(new Error('cleanup bookkeeping failed'))
    storageRemove.mockResolvedValueOnce({ data: [], error: new Error('remove failed') })
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).rejects.toThrow(
      'remove failed',
    )

    expect(markedForCleanup.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'deleted', storageCleanupStatus: 'pending', modelInputBytes: null }),
    )
  })

  it('retries a pending tombstone idempotently without restoring asset access', async () => {
    const pendingAsset = selectResult([{ ...asset, status: 'deleted', storageCleanupStatus: 'pending' }], [])
    const finalized = agentAssetStatusUpdate()
    const firstUpdate = vi.fn()
    transaction
      .mockImplementationOnce(async run =>
        run({ execute: vi.fn(), select: vi.fn(() => pendingAsset), update: firstUpdate }),
      )
      .mockImplementationOnce(async run => run(finalized.tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).resolves.toBe(
      true,
    )

    expect(firstUpdate).not.toHaveBeenCalled()
    expect(storageRemove).toHaveBeenCalledWith([asset.storagePath])
    expect(finalized.set).toHaveBeenCalledWith(
      expect.objectContaining({ storageCleanupStatus: 'completed', storageCleanupLastError: null }),
    )
  })

  it('returns an already completed tombstone without touching Storage', async () => {
    const completedAsset = selectResult([{ ...asset, status: 'deleted', storageCleanupStatus: 'completed' }], [])
    transaction.mockImplementationOnce(async run =>
      run({ execute: vi.fn(), select: vi.fn(() => completedAsset), update: vi.fn() }),
    )
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).resolves.toBe(
      true,
    )

    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('accepts another retry completing the same cleanup concurrently', async () => {
    const pendingAsset = selectResult([{ ...asset, status: 'deleted', storageCleanupStatus: 'pending' }], [])
    const emptyReturning = vi.fn(async () => [])
    const finalizeWhere = vi.fn(() => ({ returning: emptyReturning }))
    const finalizeSet = vi.fn(() => ({ where: finalizeWhere }))
    const finalizeUpdate = vi.fn(() => ({ set: finalizeSet }))
    const completedReplay = selectResult([{ id: asset.id }], [])
    transaction
      .mockImplementationOnce(async run =>
        run({ execute: vi.fn(), select: vi.fn(() => pendingAsset), update: vi.fn() }),
      )
      .mockImplementationOnce(async run =>
        run({ execute: vi.fn(), update: finalizeUpdate, select: vi.fn(() => completedReplay) }),
      )
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).resolves.toBe(
      true,
    )

    expect(storageRemove).toHaveBeenCalledWith([asset.storagePath])
    expect(completedReplay.limit).toHaveBeenCalledWith(1)
  })

  it('does not touch Storage when the initial tombstone transaction fails', async () => {
    transaction.mockRejectedValueOnce(new Error('database unavailable'))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).rejects.toThrow(
      'database unavailable',
    )

    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('does not touch storage when edit authorization rejects deletion', async () => {
    const deniedSelection = selectResult([], [])
    transaction.mockImplementationOnce(async run => run({ execute: vi.fn(), select: vi.fn(() => deniedSelection) }))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).deleteAgentAsset?.('actor-1', 'token', 'project-1', asset.id)).resolves.toBe(
      false,
    )

    expect(storageRemove).not.toHaveBeenCalled()
    const permissionQuery = new PgDialect().sqlToQuery(deniedSelection.where.mock.calls[0]?.[0] as SQL)
    expect(permissionQuery.sql).toContain('from "app"."projects"')
    expect(permissionQuery.sql).toContain('"app"."projects"."id" = "app"."agent_assets"."project_id"')
  })
})

describe('agent spike repository', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('returns only an active project that the actor can edit for grant issuance', async () => {
    let selection: Record<string, unknown> | undefined
    const editable = {
      id: 'project',
      draftVersion: 4,
      draftSchema: { componentsTree: [] as [] },
    }
    const query = selectResult([editable], [])
    const tx = {
      execute: vi.fn(),
      select: vi.fn((fields: Record<string, unknown>) => {
        selection = fields
        return query
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).getEditableProjectForAgentSpike('actor', 'project')).resolves.toEqual(editable)

    expect(selection).toEqual({
      id: projects.id,
      draftVersion: projects.draftVersion,
      draftSchema: projects.draftSchema,
    })
    expect(tx.execute).toHaveBeenCalledOnce()
  })

  it('returns the original issued operation for an identical retry and rejects a rebound operation id', async () => {
    const base = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      grantJti: 'grant-jti',
      baseDraftVersion: 4,
      inputDigest: 'a'.repeat(64),
      executorInput: { changeSet: { operations: [] } },
      skillTrace: null,
      compatibility: { host: '1.0.0' },
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      status: 'issued' as const,
      candidateDigest: null,
      candidateSchema: null,
      hostReceipt: null,
      evidence: null,
      preparedAt: null,
      committedDraftVersion: null,
      outcome: null,
      completedAt: null,
      createdAt: new Date('2026-07-31T00:00:00.000Z'),
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    }
    const { agentSpikeIssueDigest } = await import('./agent-stage-commit.js')
    const existing = {
      ...base,
      issueDigest: agentSpikeIssueDigest({
        actorId: 'actor',
        projectId: base.projectId,
        taskId: base.taskId,
        stageId: base.stageId,
        executorId: base.executorId,
        operationId: base.operationId,
        grantJti: base.grantJti,
        baseDraftVersion: base.baseDraftVersion,
        inputDigest: base.inputDigest,
        executorInput: base.executorInput,
        compatibility: base.compatibility,
        expiresAt: base.expiresAt,
      }),
    }
    const makeTx = () => ({
      execute: vi.fn(),
      select: vi.fn(() => selectResult([existing], [])),
    })
    transaction.mockImplementationOnce(async run => run(makeTx())).mockImplementationOnce(async run => run(makeTx()))
    const { createPgRepository } = await import('./repository.js')
    const repository = createPgRepository(env)

    await expect(
      repository.issueAgentSpikeOperation('actor', {
        projectId: 'project',
        taskId: 'task',
        stageId: 'stage',
        executorId: 'executor',
        operationId: 'operation',
        baseDraftVersion: 4,
        inputDigest: 'a'.repeat(64),
        grantJti: 'grant-jti',
        executorInput: { changeSet: { operations: [] } },
        compatibility: { host: '1.0.0' },
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).resolves.toEqual(existing)
    await expect(
      repository.issueAgentSpikeOperation('actor', {
        projectId: 'project',
        taskId: 'task',
        stageId: 'other-stage',
        executorId: 'executor',
        operationId: 'operation',
        baseDraftVersion: 4,
        inputDigest: 'a'.repeat(64),
        grantJti: 'grant-jti',
        executorInput: { changeSet: { operations: [] } },
        compatibility: { host: '1.0.0' },
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).resolves.toBe('integrity_conflict')
  })

  it('does not prepare an issued operation after its durable dispatch is paused', async () => {
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      status: 'issued',
      expiresAt: new Date('2999-08-01T00:00:00.000Z'),
    }
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ state: 'paused', desired_state: 'paused', lease_active: false }] }),
      select: vi.fn(() => selectResult([operation], [])),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).prepareAgentSpikeOperation(
        'actor',
        {
          projectId: 'project',
          taskId: 'task',
          stageId: 'stage',
          executorId: 'executor',
          operationId: 'operation',
        },
        { candidateSchema: { componentsTree: [] }, hostReceipt: { applied: true }, evidence: { ok: true } },
      ),
    ).resolves.toBe('attempt_stale')

    expect(tx.update).not.toHaveBeenCalled()
  })

  it.each([
    ['older generation', { generation: 2, state: 'running', desired_state: 'running', lease_active: true }, 1],
    ['paused', { generation: 2, state: 'paused', desired_state: 'paused', lease_active: false }, 2],
    ['canceled', { generation: 2, state: 'running', desired_state: 'canceled', lease_active: true }, 2],
    ['expired', { generation: 2, state: 'running', desired_state: 'running', lease_active: false }, 2],
  ])('rejects a fenced prepare for an %s dispatch attempt', async (_case, dispatchState, leaseGeneration) => {
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      status: 'issued',
      expiresAt: new Date('2000-08-01T00:00:00.000Z'),
    }
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'dispatch-1',
              lease_owner: 'worker-2',
              ...dispatchState,
            },
          ],
        }),
      select: vi.fn(() => selectResult([operation], [])),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).prepareAgentSpikeOperation(
        'actor',
        {
          projectId: 'project',
          taskId: 'task',
          stageId: 'stage',
          executorId: 'executor',
          operationId: 'operation',
        },
        {
          dispatchAttempt: { dispatchId: 'dispatch-1', workerId: 'worker-2', leaseGeneration },
        },
        { candidateSchema: { componentsTree: [] }, hostReceipt: { applied: true }, evidence: { ok: true } },
      ),
    ).resolves.toBe('attempt_stale')
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('allows the exact current generation even after the immutable operation expiry', async () => {
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      status: 'issued',
      expiresAt: new Date('2000-08-01T00:00:00.000Z'),
    }
    const prepared = { ...operation, status: 'prepared' }
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'dispatch-1',
              state: 'running',
              desired_state: 'running',
              lease_owner: 'worker-2',
              generation: 2,
              lease_active: true,
            },
          ],
        }),
      select: vi.fn(() => selectResult([operation], [])),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => [prepared]) })) })),
      })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).prepareAgentSpikeOperation(
        'actor',
        {
          projectId: 'project',
          taskId: 'task',
          stageId: 'stage',
          executorId: 'executor',
          operationId: 'operation',
        },
        {
          dispatchAttempt: { dispatchId: 'dispatch-1', workerId: 'worker-2', leaseGeneration: 2 },
        },
        { candidateSchema: { componentsTree: [] }, hostReceipt: { applied: true }, evidence: { ok: true } },
      ),
    ).resolves.toEqual(prepared)
  })

  it.each([
    ['cancel requested', { state: 'running', desired_state: 'canceled', lease_active: true }],
    ['lease expired', { state: 'running', desired_state: 'running', lease_active: false }],
  ])('does not commit a prepared operation when its dispatch is %s', async (_case, dispatchState) => {
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      baseDraftVersion: 4,
      status: 'prepared',
      candidateSchema: { componentsTree: [] },
      candidateDigest: 'candidate',
      preparedDigest: 'prepared',
      hostReceipt: { applied: true },
      evidence: { ok: true },
      expiresAt: new Date('2999-08-01T00:00:00.000Z'),
    }
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [dispatchState] }),
      select: vi.fn(() => selectResult([operation], [])),
      update: vi.fn(),
      insert: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).commitAgentSpikeStage('actor', {
        projectId: 'project',
        taskId: 'task',
        stageId: 'stage',
        executorId: 'executor',
        operationId: 'operation',
      }),
    ).resolves.toBe('attempt_stale')

    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('replays an already committed receipt without consulting the later dispatch state', async () => {
    const committed = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      status: 'committed',
    }
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selectResult([committed], [])),
      update: vi.fn(),
      insert: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).commitAgentSpikeStage('actor', {
        projectId: 'project',
        taskId: 'task',
        stageId: 'stage',
        executorId: 'executor',
        operationId: 'operation',
      }),
    ).resolves.toEqual(committed)

    expect(tx.execute).toHaveBeenCalledTimes(3)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('commits a prepared candidate, automatic revision, and durable outcome in one actor transaction', async () => {
    const candidateSchema = {
      componentsTree: [{ docId: 'page-1', $dashboard: { rect: { width: 2560, height: 1440 } } }],
    }
    const { agentSpikeCandidateDigest, agentSpikePreparedDigest } = await import('./agent-stage-commit.js')
    const hostReceipt = { applied: true }
    const evidence = { screenshot: 'artifact://render' }
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      baseDraftVersion: 4,
      candidateDigest: agentSpikeCandidateDigest(candidateSchema),
      candidateSchema,
      preparedDigest: agentSpikePreparedDigest({ candidateSchema, hostReceipt, evidence }),
      hostReceipt,
      evidence,
      expiresAt: new Date('2999-08-01T00:00:00.000Z'),
      status: 'prepared',
    }
    const latestAuto = {
      from: vi.fn(() => {
        const chain = {
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(async () => []),
        }
        chain.where.mockReturnValue(chain)
        chain.orderBy.mockReturnValue(chain)
        return chain
      }),
    }
    const revisionNumber = () => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ value: 0 }]),
      })),
    })
    const selections = [
      selectResult([operation], []),
      selectResult([{ id: 'project', draftVersion: 4, draftSchema: { componentsTree: [] } }], []),
      revisionNumber(),
      latestAuto,
      revisionNumber(),
    ]
    const projectReturning = vi.fn(async () => [{ id: 'project' }])
    const committed = {
      ...operation,
      status: 'committed',
      committedDraftVersion: 5,
      outcome: { status: 'committed', committedDraftVersion: 5 },
    }
    const operationReturning = vi.fn(async () => [committed])
    const update = vi.fn(table => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: table === projects ? projectReturning : operationReturning,
        })),
      })),
    }))
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'revision-1' }]),
      })),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      update,
      insert,
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).commitAgentSpikeStage('actor', {
        projectId: 'project',
        taskId: 'task',
        stageId: 'stage',
        executorId: 'executor',
        operationId: 'operation',
      }),
    ).resolves.toEqual(committed)

    expect(transaction).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(projects)
    expect(update).toHaveBeenCalledWith(agentSpikeOperations)
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('persists a prepared candidate once and rejects a different candidate for the same operation', async () => {
    const issued = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      status: 'issued',
      candidateDigest: null,
      expiresAt: new Date('2999-08-01T00:00:00.000Z'),
    }
    const firstCandidate = { componentsTree: [] as [] }
    const { agentSpikeCandidateDigest, agentSpikePreparedDigest } = await import('./agent-stage-commit.js')
    const hostReceipt = { applied: true }
    const evidence = { screenshot: 'artifact://render' }
    const prepared = {
      ...issued,
      status: 'prepared',
      candidateDigest: agentSpikeCandidateDigest(firstCandidate),
      preparedDigest: agentSpikePreparedDigest({ candidateSchema: firstCandidate, hostReceipt, evidence }),
      candidateSchema: firstCandidate,
      hostReceipt,
      evidence,
    }
    const prepareTx = {
      execute: vi.fn(),
      select: vi.fn(() => selectResult([issued], [])),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => [prepared]) })),
        })),
      })),
    }
    const retryTx = {
      execute: vi.fn(),
      select: vi.fn(() => selectResult([prepared], [])),
    }
    transaction.mockImplementationOnce(async run => run(prepareTx)).mockImplementationOnce(async run => run(retryTx))
    transaction.mockImplementationOnce(async run => run(retryTx))
    const { createPgRepository } = await import('./repository.js')
    const repository = createPgRepository(env)
    const binding = {
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
    }

    await expect(
      repository.prepareAgentSpikeOperation('actor', binding, {
        candidateSchema: firstCandidate,
        hostReceipt,
        evidence,
      }),
    ).resolves.toEqual(prepared)
    await expect(
      repository.prepareAgentSpikeOperation('actor', binding, {
        candidateSchema: firstCandidate,
        hostReceipt,
        evidence,
      }),
    ).resolves.toEqual(prepared)
    await expect(
      repository.prepareAgentSpikeOperation('actor', binding, {
        candidateSchema: firstCandidate,
        hostReceipt,
        evidence: { screenshot: 'artifact://other' },
      }),
    ).resolves.toBe('integrity_conflict')
    expect(prepareTx.update).toHaveBeenCalledWith(agentSpikeOperations)
  })

  it('durably classifies a stale prepared candidate without overwriting the newer draft', async () => {
    const candidateSchema = { componentsTree: [] as [] }
    const { agentSpikeCandidateDigest, agentSpikePreparedDigest } = await import('./agent-stage-commit.js')
    const hostReceipt = { applied: true }
    const evidence = { screenshot: 'artifact://render' }
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      baseDraftVersion: 4,
      candidateDigest: agentSpikeCandidateDigest(candidateSchema),
      preparedDigest: agentSpikePreparedDigest({ candidateSchema, hostReceipt, evidence }),
      candidateSchema,
      hostReceipt,
      evidence,
      status: 'prepared',
      expiresAt: new Date('2999-08-01T00:00:00.000Z'),
    }
    const selections = [selectResult([operation], []), selectResult([{ id: 'project', draftVersion: 5 }], [])]
    const capturedUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = []
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      update: vi.fn(table => ({
        set: vi.fn((values: Record<string, unknown>) => {
          capturedUpdates.push({ table, values })
          return { where: vi.fn(async () => []) }
        }),
      })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).commitAgentSpikeStage('actor', {
        projectId: 'project',
        taskId: 'task',
        stageId: 'stage',
        executorId: 'executor',
        operationId: 'operation',
      }),
    ).resolves.toBe('conflict')

    expect(capturedUpdates).toHaveLength(1)
    expect(capturedUpdates[0]?.table).toBe(agentSpikeOperations)
    expect(capturedUpdates[0]?.values).toMatchObject({
      status: 'rejected_stale',
      outcome: {
        expectedDraftVersion: 4,
        actualDraftVersion: 5,
      },
    })
  })

  it('moves a prepared operation with a contradictory persisted candidate digest to indeterminate', async () => {
    const candidateSchema = { componentsTree: [] as [] }
    const { agentSpikePreparedDigest } = await import('./agent-stage-commit.js')
    const hostReceipt = { applied: true }
    const evidence = { screenshot: 'artifact://render' }
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      stageId: 'stage',
      executorId: 'executor',
      operationId: 'operation',
      baseDraftVersion: 4,
      candidateDigest: 'f'.repeat(64),
      preparedDigest: agentSpikePreparedDigest({ candidateSchema, hostReceipt, evidence }),
      candidateSchema,
      hostReceipt,
      evidence,
      status: 'prepared',
      expiresAt: new Date('2999-08-01T00:00:00.000Z'),
    }
    const capturedUpdates: Array<Record<string, unknown>> = []
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selectResult([operation], [])),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          capturedUpdates.push(values)
          return { where: vi.fn(async () => []) }
        }),
      })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).commitAgentSpikeStage('actor', {
        projectId: 'project',
        taskId: 'task',
        stageId: 'stage',
        executorId: 'executor',
        operationId: 'operation',
      }),
    ).resolves.toBe('integrity_conflict')

    expect(capturedUpdates).toEqual([
      expect.objectContaining({
        status: 'indeterminate',
        outcome: {
          status: 'indeterminate',
          reason: 'persisted_prepare_digest_mismatch',
        },
      }),
    ])
  })

  it('safely undoes Agent paths while preserving unrelated later draft edits', async () => {
    const baseSchema = { title: 'Before', theme: 'light', componentsTree: [] as [] }
    const appliedSchema = { title: 'After', theme: 'light', componentsTree: [] as [] }
    const currentSchema = { title: 'After', theme: 'dark', componentsTree: [] as [] }
    const restoredSchema = { title: 'Before', theme: 'dark', componentsTree: [] as [] }
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      operationId: 'operation',
      status: 'committed',
      candidateSchema: appliedSchema,
      committedDraftVersion: 5,
      rollbackRevisionId: 'rollback-revision',
      rolledBackAt: null,
      rollbackReceipt: null,
    }
    const project = { draftVersion: 7, draftSchema: currentSchema }
    const revisionNumber = {
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ value: 11 }]),
      })),
    }
    const restoredAt = new Date('2026-08-01T01:00:00.000Z')
    const restoredProject = { id: 'project', draftVersion: 8, draftSchema: restoredSchema }
    const detailLookup = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [restoredProject]),
    }
    detailLookup.from.mockReturnValue(detailLookup)
    detailLookup.leftJoin.mockReturnValue(detailLookup)
    detailLookup.where.mockReturnValue(detailLookup)

    const selections = [
      selectResult([operation], []),
      selectResult([project], []),
      selectResult([{ schema: baseSchema }], []),
      revisionNumber,
      detailLookup,
    ]
    let insertedRevision: Record<string, unknown> | undefined
    const insert = vi.fn((table: unknown) => {
      expect(table).toBe(projectRevisions)
      return {
        values: vi.fn((values: Record<string, unknown>) => {
          insertedRevision = values
          return { returning: vi.fn(async () => [{ id: 'pre-restore-revision', ...values }]) }
        }),
      }
    })
    const capturedUpdates: Array<{ table: unknown; values: Record<string, unknown> }> = []
    let projectUpdateWhere: unknown
    const update = vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        capturedUpdates.push({ table, values })
        return {
          where: vi.fn((condition: unknown) => {
            if (table === projects) projectUpdateWhere = condition
            return {
              returning: vi.fn(async () => (table === projects ? [{ id: 'project' }] : [{ rolledBackAt: restoredAt }])),
            }
          }),
        }
      }),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      insert,
      update,
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).undoAgentSpikeOperation?.('actor', 'project', 'operation')).resolves.toEqual({
      project: restoredProject,
      rolledBackAt: restoredAt,
      receipt: {
        receiptVersion: 'easy-dashboard.agent-undo-receipt.v2',
        operationId: 'operation',
        rollbackRevisionId: 'rollback-revision',
        revertedPaths: ['/title'],
        sourceCommittedDraftVersion: 5,
        preUndoDraftVersion: 7,
        restoredDraftVersion: 8,
      },
    })

    expect(insertedRevision).toMatchObject({
      projectId: 'project',
      schema: currentSchema,
      kind: 'pre_restore',
      sourceDraftVersion: 7,
      createdBy: 'actor',
    })
    expect(capturedUpdates).toEqual([
      expect.objectContaining({
        table: projects,
        values: expect.objectContaining({ draftSchema: restoredSchema, draftVersion: 8 }),
      }),
      expect.objectContaining({
        table: agentSpikeOperations,
        values: expect.objectContaining({
          rollbackReceipt: expect.objectContaining({
            receiptVersion: 'easy-dashboard.agent-undo-receipt.v2',
            revertedPaths: ['/title'],
          }),
        }),
      }),
    ])
    const cas = new PgDialect().sqlToQuery(projectUpdateWhere as SQL)
    expect(cas.sql).toContain('draft_version')
    expect(cas.params).toContain(7)
  })

  it('returns a safe-undo conflict before writing when a later edit changed the same path', async () => {
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      taskId: 'task',
      operationId: 'operation',
      status: 'committed',
      candidateSchema: { title: 'After' },
      committedDraftVersion: 5,
      rollbackRevisionId: 'rollback-revision',
      rolledBackAt: null,
      rollbackReceipt: null,
    }
    const selections = [
      selectResult([operation], []),
      selectResult([{ draftVersion: 7, draftSchema: { title: 'Later' } }], []),
      selectResult([{ schema: { title: 'Before' } }], []),
    ]
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      insert: vi.fn(),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).undoAgentSpikeOperation?.('actor', 'project', 'operation')).resolves.toBe(
      'conflict',
    )

    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('replays an existing Agent undo receipt without writing a second restore', async () => {
    const rolledBackAt = new Date('2026-08-01T01:00:00.000Z')
    const existingReceipt = {
      receiptVersion: 'easy-dashboard.agent-undo-receipt.v1',
      operationId: 'operation',
      rollbackRevisionId: 'rollback-revision',
      restoredDraftVersion: 6,
    }
    const operation = {
      id: 'ledger-1',
      actorId: 'actor',
      projectId: 'project',
      operationId: 'operation',
      rolledBackAt,
      rollbackReceipt: existingReceipt,
    }
    const currentProject = { id: 'project', draftVersion: 9, draftSchema: { title: 'Later' } }
    const detailLookup = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [currentProject]),
    }
    detailLookup.from.mockReturnValue(detailLookup)
    detailLookup.leftJoin.mockReturnValue(detailLookup)
    detailLookup.where.mockReturnValue(detailLookup)
    const selections = [selectResult([operation], []), detailLookup]
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => selections.shift()),
      insert: vi.fn(),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).undoAgentSpikeOperation?.('actor', 'project', 'operation')).resolves.toEqual({
      project: currentProject,
      rolledBackAt,
      receipt: existingReceipt,
    })

    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('thumbnail requested version SQL', () => {
  it('casts the CASE parameter to integer for draft saves and revision restores', async () => {
    const { thumbnailRequestedVersionCase } = await import('./repository.js')

    const query = new PgDialect().sqlToQuery(thumbnailRequestedVersionCase(5))

    expect(query.sql).toContain('then cast($1 as integer)')
    expect(query.params).toEqual([5])
  })
})

describe('publication serialization', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('locks the project row before deactivating a publication', async () => {
    const lockCalls: string[] = []
    const lock = selectResult([{ id: 'project', isOwner: true }], lockCalls)
    const returning = vi.fn(async () => [])
    const where = vi.fn(() => ({ returning }))
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(lock),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await createPgRepository(env).unpublish('actor', 'project')

    expect(lockCalls).toEqual(['update'])
    expect(tx.update).toHaveBeenCalledOnce()
  })
})

describe('publish snapshot repository gate', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('persists the locked full draft with its canonical digest before any approval can exist', async () => {
    const lockCalls: string[] = []
    const document = { z: 1, componentsTree: [{ id: 'page' }], a: { y: true, x: 'value' } }
    const projectLock = selectResult([{ id: 'project', draftVersion: 7, draftSchema: document }], lockCalls)
    const noPreview = selectResult([], [])
    const noAgentEvidence = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(async () => []),
    }
    noAgentEvidence.from.mockReturnValue(noAgentEvidence)
    noAgentEvidence.where.mockReturnValue(noAgentEvidence)
    noAgentEvidence.orderBy.mockReturnValue(noAgentEvidence)
    const noRendererArtifact = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(async () => []),
    }
    noRendererArtifact.from.mockReturnValue(noRendererArtifact)
    noRendererArtifact.where.mockReturnValue(noRendererArtifact)
    noRendererArtifact.orderBy.mockReturnValue(noRendererArtifact)
    let snapshotValues: Record<string, unknown> | undefined
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockReturnValueOnce(projectLock)
        .mockReturnValueOnce(noPreview)
        .mockReturnValueOnce(noAgentEvidence)
        .mockReturnValueOnce(noRendererArtifact),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          snapshotValues = values
          return {
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(async () => [{ id: 'snapshot', createdAt: new Date(), ...values }]),
            })),
          }
        }),
      })),
    }
    transaction.mockImplementation(async run => run(tx))
    const [{ createPgRepository }, { canonicalJsonSha256 }] = await Promise.all([
      import('./repository.js'),
      import('./agent-stage-commit.js'),
    ])

    await expect(createPgRepository(env).createPublishSnapshot('actor', 'project', 7)).resolves.toMatchObject({
      snapshot: { id: 'snapshot', draftVersion: 7, document },
      previewRun: null,
    })

    expect(lockCalls).toEqual(['update'])
    expect(snapshotValues).toMatchObject({
      projectId: 'project',
      draftVersion: 7,
      document,
      documentSha256: canonicalJsonSha256(document),
      createdBy: 'actor',
    })
  })
})

describe('release-to-draft restoration', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('backs up the current draft and restores immutable release content without changing the publication', async () => {
    const lockCalls: string[] = []
    const currentSchema = { componentsTree: [] as [] }
    const releaseSchema = {
      componentsTree: [
        {
          docId: 'page-release',
          $dashboard: { rect: { width: 2560, height: 1440 } },
        },
      ],
    }
    const projectLock = selectResult(
      [
        {
          id: 'project',
          draftVersion: 4,
          draftSchema: currentSchema,
          thumbnailMode: 'auto',
          thumbnailPath: null,
        },
      ],
      lockCalls,
    )
    const releaseLookup = selectResult([{ schema: releaseSchema }], [])
    const revisionNumber = {
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ value: 8 }]),
      })),
    }
    const restoredDetail = {
      id: 'project',
      draftVersion: 5,
      draftSchema: releaseSchema,
      publicationSlug: 'stable-dashboard',
      publishedRevisionId: 'published-revision',
      publishedAt: new Date('2026-07-30T01:00:00.000Z'),
      currentReleaseNumber: 2,
    }
    const detailLookup = {
      from: vi.fn(),
      leftJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [restoredDetail]),
    }
    detailLookup.from.mockReturnValue(detailLookup)
    detailLookup.leftJoin.mockReturnValue(detailLookup)
    detailLookup.where.mockReturnValue(detailLookup)

    let insertedRevision: Record<string, unknown> | undefined
    const insert = vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedRevision = values
        return {
          returning: vi.fn(async () => [{ id: 'pre-restore-revision', ...values }]),
        }
      }),
    }))
    let projectUpdate: Record<string, unknown> | undefined
    const update = vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        projectUpdate = values
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: 'project' }]),
          })),
        }
      }),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockReturnValueOnce(projectLock)
        .mockReturnValueOnce(releaseLookup)
        .mockReturnValueOnce(revisionNumber)
        .mockReturnValueOnce(detailLookup),
      insert,
      update,
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).restoreRelease('actor', 'project', 2, 4)).resolves.toEqual(restoredDetail)

    expect(lockCalls).toEqual(['update'])
    expect(insertedRevision).toMatchObject({
      projectId: 'project',
      schema: currentSchema,
      kind: 'pre_restore',
      sourceDraftVersion: 4,
      createdBy: 'actor',
    })
    expect(projectUpdate).toMatchObject({
      draftSchema: releaseSchema,
      draftVersion: 5,
      pageCount: 1,
      canvasWidth: 2560,
      canvasHeight: 1440,
      startPageId: 'page-release',
    })
    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(projects)
    expect(update).not.toHaveBeenCalledWith(projectPublications)
  })

  it('rejects a stale expected version before reading or mutating a release', async () => {
    const lockCalls: string[] = []
    const projectLock = selectResult([{ id: 'project', draftVersion: 5 }], lockCalls)
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(projectLock),
      insert: vi.fn(),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).restoreRelease('actor', 'project', 2, 4)).resolves.toBe('conflict')

    expect(lockCalls).toEqual(['update'])
    expect(tx.select).toHaveBeenCalledOnce()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('does not create a backup when the requested release does not exist', async () => {
    const projectLock = selectResult([{ id: 'project', draftVersion: 4, draftSchema: { componentsTree: [] } }], [])
    const missingRelease = selectResult([], [])
    const tx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(projectLock).mockReturnValueOnce(missingRelease),
      insert: vi.fn(),
      update: vi.fn(),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).restoreRelease('actor', 'project', 99, 4)).resolves.toBeNull()

    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('permanent project deletion', () => {
  beforeEach(() => {
    transaction.mockReset()
    storageRemove.mockClear()
  })

  it('requires the project to already be in trash', async () => {
    const lockCalls: string[] = []
    const activeProject = selectResult([{ id: 'project', deletedAt: null }], lockCalls)
    transaction.mockImplementation(async run => run({ execute: vi.fn(), select: vi.fn(() => activeProject) }))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'project')).resolves.toBe(
      'conflict',
    )

    expect(lockCalls).toEqual(['update'])
    expect(storageRemove).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledOnce()
  })

  it('keeps the project aggregate and asset ledger recoverable when Agent object cleanup fails', async () => {
    const deletedAt = new Date('2026-07-30T01:00:00.000Z')
    const project = selectResult([{ id: 'project', deletedAt }], [])
    const preflightTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ storage_path: 'actor/project/asset-1/data.csv' }] }),
      select: vi.fn().mockReturnValueOnce(project),
    }
    const finishTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ finished: true }] }),
    }
    transaction.mockImplementationOnce(async run => run(preflightTx)).mockImplementationOnce(async run => run(finishTx))
    storageRemove.mockResolvedValueOnce({ data: [], error: new Error('asset cleanup failed') })
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'project')).rejects.toThrow(
      'asset cleanup failed',
    )

    expect(storageRemove).toHaveBeenCalledWith(['actor/project/asset-1/data.csv'])
    expect(transaction).toHaveBeenCalledTimes(2)
  })

  it('cleans Agent assets and due thumbnail objects before deleting the trashed project aggregate', async () => {
    const preflight = selectResult([{ id: 'project', deletedAt: new Date('2026-07-30T01:00:00.000Z') }], [])
    const preflightTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ storage_path: 'actor/project/asset-1/data.csv' }] }),
      select: vi.fn().mockReturnValueOnce(preflight),
    }
    const finishTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ finished: true }] }),
    }
    const reconcileProject = selectResult(
      [
        {
          id: 'project',
          deletedAt: new Date('2026-07-30T01:00:00.000Z'),
          currentPath: null,
          pendingPath: null,
        },
      ],
      [],
    )
    const cleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ path: 'actor/project/4/thumbnail.webp' }]),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(reconcileProject).mockReturnValueOnce(cleanupCandidates),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }
    const markDeletedTx = {
      execute: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: 'artifact' }]),
          })),
        })),
      })),
    }
    let deletePredicate: SQL | undefined
    const projectDelete = {
      where: vi.fn((predicate: SQL) => {
        deletePredicate = predicate
        return {
          returning: vi.fn(async () => [{ id: 'project' }]),
        }
      }),
    }
    const deleteTx = {
      execute: vi.fn(),
      delete: vi.fn(() => projectDelete),
    }
    transaction
      .mockImplementationOnce(async run => run(preflightTx))
      .mockImplementationOnce(async run => run(finishTx))
      .mockImplementationOnce(async run => run(reconcileTx))
      .mockImplementationOnce(async run => run(markDeletedTx))
      .mockImplementationOnce(async run => run(deleteTx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'project')).resolves.toBe(true)

    expect(storageRemove).toHaveBeenNthCalledWith(1, ['actor/project/asset-1/data.csv'])
    expect(storageRemove).toHaveBeenNthCalledWith(2, ['actor/project/4/thumbnail.webp'])
    expect(deleteTx.delete).toHaveBeenCalledWith(projects)
    expect(projectDelete.where).toHaveBeenCalledOnce()

    const prepareQuery = new PgDialect().sqlToQuery(preflightTx.execute.mock.calls[1]?.[0] as SQL)
    const finishQuery = new PgDialect().sqlToQuery(finishTx.execute.mock.calls[1]?.[0] as SQL)
    const deleteQuery = new PgDialect().sqlToQuery(deletePredicate as SQL)
    const deleteToken = prepareQuery.params.find(
      parameter => typeof parameter === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parameter),
    )
    expect(deleteToken).toEqual(expect.any(String))
    expect(prepareQuery.sql).toContain('prepare_project_agent_asset_cleanup')
    expect(finishQuery.sql).toContain('finish_project_agent_asset_cleanup')
    expect(finishQuery.params).toContain(deleteToken)
    expect(deleteQuery.sql).toContain('"projects"."deleted_at" = $')
    expect(deleteQuery.sql).toContain('"projects"."permanent_delete_token" = $')
    expect(deleteQuery.params).toContain('2026-07-30T01:00:00.000Z')
    expect(deleteQuery.params).toContain(deleteToken)
  })

  it('rejects restoring a project while its permanent deletion token is present', async () => {
    const returning = vi.fn(async () => [])
    const where = vi.fn(() => ({ returning }))
    const set = vi.fn(() => ({ where }))
    const deletingProject = selectResult([{ id: 'project' }], [])
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({ set })),
      select: vi.fn(() => deletingProject),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).restoreProject('editor', 'project')).resolves.toBe('deletion_in_progress')

    expect(returning).toHaveBeenCalledOnce()
    expect(tx.select).toHaveBeenCalledOnce()
  })

  it('does not delete a project that was restored and re-trashed while thumbnail cleanup was running', async () => {
    const originalDeletedAt = new Date('2026-07-30T01:00:00.000Z')
    const retrashDeletedAt = new Date('2026-07-30T01:05:00.000Z')
    const preflight = selectResult([{ id: 'project', deletedAt: originalDeletedAt }], [])
    const preflightTx = {
      execute: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [] }),
      select: vi.fn().mockReturnValueOnce(preflight),
    }
    const finishTx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ finished: true }] }),
    }
    const reconcileProject = selectResult(
      [{ id: 'project', deletedAt: originalDeletedAt, currentPath: null, pendingPath: null }],
      [],
    )
    const noCleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(reconcileProject).mockReturnValueOnce(noCleanupCandidates),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    }
    let deletePredicate: SQL | undefined
    const projectDelete = {
      where: vi.fn((predicate: SQL) => {
        deletePredicate = predicate
        return {
          returning: vi.fn(async () => []),
        }
      }),
    }
    const reTrashedProject = selectResult([{ id: 'project', deletedAt: retrashDeletedAt }], [])
    const deleteTx = {
      execute: vi.fn(),
      delete: vi.fn(() => projectDelete),
      select: vi.fn(() => reTrashedProject),
    }
    transaction
      .mockImplementationOnce(async run => run(preflightTx))
      .mockImplementationOnce(async run => run(finishTx))
      .mockImplementationOnce(async run => run(reconcileTx))
      .mockImplementationOnce(async run => run(deleteTx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'project')).resolves.toBe(
      'conflict',
    )

    expect(deletePredicate).toBeDefined()
    const query = new PgDialect().sqlToQuery(deletePredicate as SQL)
    expect(query.sql).toContain('"projects"."deleted_at" = $')
    expect(query.params).toContain(originalDeletedAt.toISOString())
    expect(query.params).not.toContain(retrashDeletedAt.toISOString())
  })

  it('returns not found without attempting cleanup when the project is inaccessible', async () => {
    const missingProject = selectResult([], [])
    transaction.mockImplementation(async run => run({ execute: vi.fn(), select: vi.fn(() => missingProject) }))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).permanentlyDeleteProject('actor', 'token', 'missing-project'),
    ).resolves.toBeNull()

    expect(storageRemove).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledOnce()
  })
})

describe('lightweight public publication probes', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it.each([
    ['stable URL', undefined, 1],
    ['version URL', 2, 2],
  ])('checks %s visibility without selecting the project schema', async (_label, releaseNumber, joinCount) => {
    let selection: Record<string, unknown> | undefined
    let predicate: SQL | undefined
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn((value: SQL) => {
        predicate = value
        return chain
      }),
      limit: vi.fn(async () => [{ projectId: 'project' }]),
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn((fields: Record<string, unknown>) => {
        selection = fields
        return chain
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).isPublicProjectAvailable('dashboard', releaseNumber)).resolves.toBe(true)

    expect(Object.keys(selection ?? {})).toEqual(['projectId'])
    expect(chain.innerJoin).toHaveBeenCalledTimes(joinCount)
    expect(predicate).toBeDefined()
    const query = new PgDialect().sqlToQuery(predicate as SQL)
    expect(query.sql).toContain('"project_publications"."slug"')
    expect(query.sql).toContain('"project_publications"."is_published"')
    expect(query.sql).toContain('"projects"."deleted_at" is null')
    if (releaseNumber === undefined) {
      expect(query.sql).not.toContain('"project_releases"."release_number"')
    } else {
      expect(query.sql).toContain('"project_releases"."release_number"')
    }
  })

  it('reports an unavailable publication without falling back to a full public-project read', async () => {
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => []),
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn(() => chain),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).isPublicProjectAvailable('dashboard')).resolves.toBe(false)
  })
})

describe('thumbnail attempt compare-and-set', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it.each([
    ['an older overlapping attempt', 'actor/project/4/old-attempt.webp'],
    ['a failure callback after complete made the project ready', 'actor/project/4/completed-attempt.webp'],
  ])('rejects %s unless the exact path is still rendering', async (_scenario, path) => {
    let updatePredicate: SQL | undefined
    const returning = vi.fn(async () => [])
    const where = vi.fn((predicate: SQL) => {
      updatePredicate = predicate
      return { returning }
    })
    const existing = selectResult([{ id: 'project' }], [])
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
      select: vi.fn().mockReturnValue(existing),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).failThumbnailUpload('actor', 'access-token', 'project', {
        draftVersion: 4,
        path,
        errorCode: 'thumbnail-upload-failed',
      }),
    ).resolves.toBe('conflict')

    expect(updatePredicate).toBeDefined()
    const query = new PgDialect().sqlToQuery(updatePredicate as SQL)
    expect(query.sql).toContain('"project_thumbnail_artifacts"."path" = $')
    expect(query.sql).toContain('"project_thumbnail_artifacts"."status" = $')
    expect(query.sql).toContain('"project_thumbnail_artifacts"."draft_version" = $')
    expect(query.params).toEqual(expect.arrayContaining(['project', path, 'pending', 4]))
  })
})

describe('thumbnail transaction rollback', () => {
  beforeEach(() => {
    transaction.mockReset()
    storageInfo.mockClear()
  })

  function updateResult(rows: unknown[] | undefined) {
    const returning = vi.fn(async () => rows ?? [])
    const whereResult = rows === undefined ? Promise.resolve(undefined) : { returning }
    const set = vi.fn((_values: Record<string, unknown>) => ({
      where: vi.fn(() => whereResult),
    }))
    return {
      set,
    }
  }

  it('rolls back a prepared ledger artifact when the project CAS loses after insertion', async () => {
    const projectLock = selectResult([{ id: 'project', draftVersion: 4 }], [])
    const reconcileProject = selectResult(
      [{ id: 'project', deletedAt: null, currentPath: null, pendingPath: null }],
      [],
    )
    const cleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(reconcileProject).mockReturnValueOnce(cleanupCandidates),
      update: vi.fn(() => updateResult(undefined)),
    }
    let rolledBack = false
    const supersededArtifactUpdate = updateResult(undefined)
    const createTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(projectLock),
      update: vi.fn().mockReturnValueOnce(supersededArtifactUpdate).mockReturnValueOnce(updateResult([])),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    }
    transaction
      .mockImplementationOnce(async run => run(reconcileTx))
      .mockImplementationOnce(async run => {
        try {
          return await run(createTx)
        } catch (error) {
          rolledBack = true
          throw error
        }
      })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).createThumbnailUpload('actor', 'token', 'project', {
        draftVersion: 4,
        mode: 'auto',
        source: 'renderer',
        contentType: 'image/webp',
        size: 1024,
      }),
    ).resolves.toBe('conflict')

    expect(rolledBack).toBe(true)
    expect(createTx.insert).toHaveBeenCalledOnce()
    const supersededValues = supersededArtifactUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    const cleanupQuery = new PgDialect().sqlToQuery(supersededValues.nextCleanupAt as SQL)
    expect(cleanupQuery.sql).toContain('greatest(')
    expect(cleanupQuery.sql).toContain('"expires_at"')
  })

  it('rolls back current promotion and old-current cleanup when the project CAS loses', async () => {
    const pending = selectResult(
      [
        {
          draftVersion: 4,
          path: 'actor/project/4/new.webp',
          contentType: 'image/webp',
          size: 1024,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
      [],
    )
    const projectLock = selectResult(
      [{ id: 'project', draftVersion: 4, requestedVersion: 4, pendingPath: 'actor/project/4/new.webp' }],
      [],
    )
    let rolledBack = false
    const replacedArtifactUpdate = updateResult(undefined)
    const completeTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValue(projectLock),
      update: vi
        .fn()
        .mockReturnValueOnce(updateResult([{ id: 'artifact' }]))
        .mockReturnValueOnce(replacedArtifactUpdate)
        .mockReturnValueOnce(updateResult([])),
    }
    transaction
      .mockImplementationOnce(async run =>
        run({
          execute: vi.fn(),
          select: vi.fn().mockReturnValue(pending),
        }),
      )
      .mockImplementationOnce(async run => {
        try {
          return await run(completeTx)
        } catch (error) {
          rolledBack = true
          throw error
        }
      })
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).completeThumbnailUpload('actor', 'token', 'project', {
        draftVersion: 4,
        path: 'actor/project/4/new.webp',
      }),
    ).resolves.toBe('conflict')

    expect(rolledBack).toBe(true)
    expect(completeTx.update).toHaveBeenCalledTimes(3)
    const replacedValues = replacedArtifactUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    const cleanupQuery = new PgDialect().sqlToQuery(replacedValues.nextCleanupAt as SQL)
    expect(cleanupQuery.sql).toContain('greatest(')
    expect(cleanupQuery.sql).toContain('"expires_at"')
  })

  it('trashes publication and thumbnail references atomically, then reconciles without early cleanup', async () => {
    const projectTrashUpdate = updateResult([{ id: 'project' }])
    const artifactTrashUpdate = updateResult(undefined)
    const publicationTrashUpdate = updateResult(undefined)
    const trashTx = {
      execute: vi.fn(),
      update: vi
        .fn()
        .mockReturnValueOnce(projectTrashUpdate)
        .mockReturnValueOnce(artifactTrashUpdate)
        .mockReturnValueOnce(publicationTrashUpdate),
    }
    const deletedProject = selectResult(
      [{ id: 'project', deletedAt: new Date(), currentPath: null, pendingPath: null }],
      [],
    )
    const cleanupCandidates = {
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }
    const reconcileTx = {
      execute: vi.fn(),
      select: vi.fn().mockReturnValueOnce(deletedProject).mockReturnValueOnce(cleanupCandidates),
      update: vi.fn(() => updateResult(undefined)),
    }
    transaction.mockImplementationOnce(async run => run(trashTx)).mockImplementationOnce(async run => run(reconcileTx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).trashProject('actor', 'token', 'project')).resolves.toBe(true)

    const projectValues = projectTrashUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(projectValues).toMatchObject({
      deletedAt: expect.any(Date),
      thumbnailPath: null,
      thumbnailUrl: null,
      thumbnailDraftVersion: null,
      thumbnailPendingPath: null,
    })
    const artifactValues = artifactTrashUpdate.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(artifactValues.status).toBe('cleanup_pending')
    const cleanupQuery = new PgDialect().sqlToQuery(artifactValues.nextCleanupAt as SQL)
    expect(cleanupQuery.sql).toContain('greatest(')
    expect(cleanupQuery.sql).toContain('"expires_at"')
  })
})

describe('immutable release metadata', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('selects publication time and release number only through the current published revision', async () => {
    let selection: Record<string, unknown> | undefined
    const joins: Array<{ table: unknown; predicate: SQL }> = []
    const chain = {
      from: vi.fn(),
      leftJoin: vi.fn((table: unknown, predicate: SQL) => {
        joins.push({ table, predicate })
        return chain
      }),
      where: vi.fn(),
      orderBy: vi.fn(async () => []),
    }
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn((fields: Record<string, unknown>) => {
        selection = fields
        return chain
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).listProjects('actor')).resolves.toEqual([])

    expect(selection?.publishedAt).toBe(projectPublications.publishedAt)
    expect(selection?.currentReleaseNumber).toBe(projectReleases.releaseNumber)
    expect(joins).toHaveLength(2)
    expect(joins[0]?.table).toBe(projectPublications)
    expect(joins[1]?.table).toBe(projectReleases)
    const publicationJoin = new PgDialect().sqlToQuery(joins[0]?.predicate as SQL)
    const releaseJoin = new PgDialect().sqlToQuery(joins[1]?.predicate as SQL)
    expect(publicationJoin.sql).toContain('"project_publications"."is_published"')
    expect(releaseJoin.sql).toContain('"project_releases"."revision_id"')
    expect(releaseJoin.sql).toContain('"project_publications"."revision_id"')
  })

  it.each([
    ['stable URL', (repository: Repository) => repository.getPublicProject('dashboard')],
    ['version URL', (repository: Repository) => repository.getPublicProjectVersion('dashboard', 1)],
  ])('reads %s name and description from the immutable release snapshot', async (_label, readPublicProject) => {
    let selection: Record<string, unknown> | undefined
    const row = {
      slug: 'dashboard',
      projectId: 'project',
      name: '发布时名称',
      description: '发布时描述',
      revisionId: 'revision-1',
      revisionNumber: 1,
      releaseNumber: 1,
      schema: { componentsTree: [] },
      publishedAt: new Date('2026-07-30T01:00:00.000Z'),
    }
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(async () => [row]),
    }
    chain.from.mockReturnValue(chain)
    chain.innerJoin.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    const tx = {
      execute: vi.fn(),
      select: vi.fn((fields: Record<string, unknown>) => {
        selection = fields
        return chain
      }),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(readPublicProject(createPgRepository(env))).resolves.toMatchObject({
      name: '发布时名称',
      description: '发布时描述',
    })
    expect(selection?.name).toBe(projectReleases.name)
    expect(selection?.description).toBe(projectReleases.description)
  })
})
