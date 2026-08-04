import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'
import type { AgentRunCostRecord } from '../types.js'

const transaction = vi.hoisted(() => vi.fn())

vi.mock('./client.js', () => ({
  createDatabase: () => ({
    db: { transaction },
    pool: { query: vi.fn() },
  }),
}))

const env = {} as AppEnv
const actorId = '00000000-0000-4000-8000-000000000001'
const projectId = '00000000-0000-4000-8000-000000000002'
const baseTime = new Date('2026-08-01T00:00:00.000Z')

function cost(input: Partial<AgentRunCostRecord> & Pick<AgentRunCostRecord, 'turnId'>): AgentRunCostRecord {
  const { turnId, ...overrides } = input
  return {
    id: `cost-${turnId}`,
    actorId,
    projectId,
    taskId: 'task-1',
    turnId,
    inputDigest: overrides.inputDigest ?? turnId.padEnd(64, 'a').slice(0, 64),
    state: 'reserved',
    reservedMicros: 100,
    settledMicros: 0,
    minimumMicros: null,
    maximumMicros: null,
    operationId: `operation-${turnId}`,
    provider: 'openai-compatible',
    model: 'model-1',
    profile: 'platform:default',
    promptTokens: null,
    completionTokens: null,
    traceId: null,
    decisionOutput: null,
    decisionUsage: null,
    decisionTrace: null,
    billingScope: 'project',
    payerId: projectId,
    reservationExpiresAt: new Date(baseTime.getTime() + 600_000),
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  }
}

function selectedRows(rows: AgentRunCostRecord[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    for: vi.fn(),
    orderBy: vi.fn(async () => rows),
    limit: vi.fn(async () => rows),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.for.mockReturnValue(chain)
  return chain
}

describe('Agent run turn cost repository', () => {
  beforeEach(() => {
    transaction.mockReset()
  })

  it('aggregates every turn in a task while retaining the latest turn decision metadata', async () => {
    const latest = cost({
      turnId: 'turn-3',
      state: 'settled',
      accuracy: 'billing_indeterminate',
      reservedMicros: 250,
      settledMicros: 200,
      minimumMicros: 0,
      maximumMicros: 250,
      promptTokens: 20,
      completionTokens: 10,
      decisionOutput: { action: 'ask_user', message: '请选择数据范围' },
      decisionUsage: { totalTokens: 30 },
      decisionTrace: { promptBundleId: 'bundle-latest' },
      operationId: 'operation-latest',
      createdAt: new Date('2026-08-01T00:02:00.000Z'),
      updatedAt: new Date('2026-08-01T00:02:00.000Z'),
    })
    const reserved = cost({
      turnId: 'turn-2',
      state: 'reserved',
      reservedMicros: 300,
      createdAt: new Date('2026-08-01T00:01:00.000Z'),
      updatedAt: new Date('2026-08-01T00:01:00.000Z'),
    })
    const settled = cost({
      turnId: 'turn-1',
      state: 'settled',
      reservedMicros: 150,
      settledMicros: 100,
      minimumMicros: 100,
      maximumMicros: 100,
      promptTokens: 10,
      completionTokens: 5,
    })
    const tx = { execute: vi.fn(), select: vi.fn(() => selectedRows([latest, reserved, settled])) }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).getAgentRunCost?.(actorId, projectId, 'task-1')).resolves.toMatchObject({
      id: latest.id,
      turnId: 'turn-3',
      operationId: 'operation-latest',
      state: 'reserved',
      reservedMicros: 700,
      settledMicros: 300,
      minimumMicros: 100,
      maximumMicros: 650,
      promptTokens: 30,
      completionTokens: 15,
      decisionOutput: latest.decisionOutput,
      decisionUsage: latest.decisionUsage,
      decisionTrace: latest.decisionTrace,
      createdAt: baseTime,
      updatedAt: new Date('2026-08-01T00:02:00.000Z'),
    })
  })

  it('retrieves one durable decision checkpoint by turn identity', async () => {
    const turn = cost({
      turnId: 'turn-checkpoint',
      state: 'settled',
      accuracy: 'billing_indeterminate',
      decisionOutput: { action: 'ask_user', message: '请选择时间范围' },
      decisionUsage: { promptTokens: 20, completionTokens: 8 },
      decisionTrace: { promptBundleId: 'bundle-checkpoint' },
    })
    const tx = { execute: vi.fn(), select: vi.fn(() => selectedRows([turn])) }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).getAgentRunCostByTurn?.(actorId, projectId, turn.turnId)).resolves.toEqual(
      turn,
    )
  })

  it('expires every stale reservation before returning the task aggregate', async () => {
    const events: string[] = []
    const expired = cost({
      turnId: 'turn-2',
      state: 'settled',
      accuracy: 'billing_indeterminate',
      reservedMicros: 250,
      settledMicros: 250,
      minimumMicros: 0,
      maximumMicros: 250,
      updatedAt: new Date('2026-08-01T00:11:00.000Z'),
      createdAt: new Date('2026-08-01T00:01:00.000Z'),
    })
    const settled = cost({
      turnId: 'turn-1',
      state: 'settled',
      reservedMicros: 150,
      settledMicros: 100,
      minimumMicros: 100,
      maximumMicros: 100,
      promptTokens: 10,
      completionTokens: 4,
    })
    const updateResult = vi.fn(async () => {
      events.push('expire')
      return []
    })
    const rows = selectedRows([expired, settled])
    rows.orderBy.mockImplementation(async () => {
      events.push('aggregate')
      return [expired, settled]
    })
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateResult })) })),
      select: vi.fn(() => rows),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).reconcileAgentRunCost?.(
        actorId,
        projectId,
        'task-1',
        new Date('2026-08-01T00:11:00.000Z'),
      ),
    ).resolves.toMatchObject({
      state: 'settled',
      accuracy: 'billing_indeterminate',
      reservedMicros: 400,
      settledMicros: 350,
      minimumMicros: 100,
      maximumMicros: 350,
      promptTokens: 10,
      completionTokens: 4,
    })
    expect(events).toEqual(['expire', 'aggregate'])
  })

  it('atomically settles one turn with its validated decision checkpoint', async () => {
    const decisionOutput = { action: 'ask_user', message: '请选择时间范围', question: { id: 'range', text: '范围？' } }
    const decisionUsage = { promptTokens: 20, completionTokens: 8, totalTokens: 28 }
    const decisionTrace = { promptBundleId: 'bundle-1', promptBundleVersion: '1' }
    const settled = cost({
      turnId: 'turn-checkpoint',
      state: 'settled',
      settledMicros: 280,
      minimumMicros: 280,
      maximumMicros: 280,
      promptTokens: 20,
      completionTokens: 8,
      decisionOutput,
      decisionUsage,
      decisionTrace,
    })
    let predicate: SQL | undefined
    const set = vi.fn(() => ({
      where: vi.fn((where: SQL) => {
        predicate = where
        return { returning: vi.fn(async () => [settled]) }
      }),
    }))
    const tx = { execute: vi.fn(), update: vi.fn(() => ({ set })) }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).settleAgentRunCost?.(actorId, {
        projectId,
        taskId: 'task-1',
        turnId: settled.turnId,
        settledMicros: 280,
        minimumMicros: 280,
        maximumMicros: 280,
        promptTokens: 20,
        completionTokens: 8,
        decisionOutput,
        decisionUsage,
        decisionTrace,
      }),
    ).resolves.toEqual(settled)

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ decisionOutput, decisionUsage, decisionTrace, promptTokens: 20, completionTokens: 8 }),
    )
    const query = new PgDialect().sqlToQuery(predicate as SQL)
    expect(query.sql).toContain('"turn_id" = $')
    expect(query.params).toContain(settled.turnId)
  })

  it('replays an already settled turn without replacing its durable decision', async () => {
    const durable = cost({
      turnId: 'turn-replay',
      state: 'settled',
      settledMicros: 120,
      minimumMicros: 120,
      maximumMicros: 120,
      decisionOutput: { action: 'ask_user', message: '原始已验证问题' },
      decisionUsage: { totalTokens: 12 },
      decisionTrace: { promptBundleId: 'original-bundle' },
    })
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        })),
      })),
      select: vi.fn(() => selectedRows([durable])),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).settleAgentRunCost?.(actorId, {
        projectId,
        taskId: durable.taskId,
        turnId: durable.turnId,
        settledMicros: 999,
        decisionOutput: { action: 'execute', summary: '不应覆盖' },
        decisionUsage: { totalTokens: 999 },
        decisionTrace: { promptBundleId: 'replacement-bundle' },
      }),
    ).resolves.toEqual(durable)
  })

  it('reserves a new turn independently within an existing task', async () => {
    let existingPredicate: SQL | undefined
    let inserted: Record<string, unknown> | undefined
    const reserved = cost({ turnId: 'turn-new', reservedMicros: 200 })
    const projectRows = selectedRows([{ id: projectId } as unknown as AgentRunCostRecord])
    const existingRows = selectedRows([])
    existingRows.where.mockImplementation((where: SQL) => {
      existingPredicate = where
      return existingRows
    })
    const usage = {
      from: vi.fn(),
      where: vi.fn(async () => [{ taskMicros: 100, projectMonthMicros: 500 }]),
    }
    usage.from.mockReturnValue(usage)
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockImplementationOnce(() => projectRows)
        .mockImplementationOnce(() => existingRows)
        .mockImplementationOnce(() => usage),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          inserted = values
          return { returning: vi.fn(async () => [reserved]) }
        }),
      })),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).reserveAgentRunCost?.(actorId, {
        projectId,
        taskId: 'task-1',
        turnId: reserved.turnId,
        inputDigest: reserved.inputDigest,
        estimatedMicros: 200,
        taskLimitMicros: 1_000,
        projectMonthLimitMicros: 10_000,
        operationId: reserved.operationId ?? undefined,
        billingScope: 'project',
        payerId: projectId,
        now: baseTime,
        reservationExpiresAt: reserved.reservationExpiresAt,
      }),
    ).resolves.toEqual(reserved)

    const query = new PgDialect().sqlToQuery(existingPredicate as SQL)
    expect(query.sql).toContain('"turn_id" = $')
    expect(query.params).toContain(reserved.turnId)
    expect(inserted).toMatchObject({ taskId: 'task-1', turnId: reserved.turnId })
  })

  it('rejects rebinding one turn identity to another task', async () => {
    const existing = cost({ turnId: 'turn-shared', taskId: 'task-original' })
    const insert = vi.fn()
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockImplementationOnce(() => selectedRows([{ id: projectId } as unknown as AgentRunCostRecord]))
        .mockImplementationOnce(() => selectedRows([existing])),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
      insert,
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).reserveAgentRunCost?.(actorId, {
        projectId,
        taskId: 'task-rebound',
        turnId: existing.turnId,
        inputDigest: existing.inputDigest,
        estimatedMicros: 200,
        taskLimitMicros: 1_000,
        projectMonthLimitMicros: 10_000,
        billingScope: 'project',
        payerId: projectId,
        now: baseTime,
        reservationExpiresAt: existing.reservationExpiresAt,
      }),
    ).resolves.toBe('conflict')
    expect(insert).not.toHaveBeenCalled()
  })

  it('counts prior turns when enforcing the task budget', async () => {
    const reserved = cost({ turnId: 'turn-budget', reservedMicros: 200 })
    const usage = {
      from: vi.fn(),
      where: vi.fn(async () => [{ taskMicros: 900, projectMonthMicros: 900 }]),
    }
    usage.from.mockReturnValue(usage)
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(async () => [reserved]) })),
    }))
    const tx = {
      execute: vi.fn(),
      select: vi
        .fn()
        .mockImplementationOnce(() => selectedRows([{ id: projectId } as unknown as AgentRunCostRecord]))
        .mockImplementationOnce(() => selectedRows([]))
        .mockImplementationOnce(() => usage),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
      insert,
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(
      createPgRepository(env).reserveAgentRunCost?.(actorId, {
        projectId,
        taskId: 'task-1',
        turnId: reserved.turnId,
        inputDigest: reserved.inputDigest,
        estimatedMicros: 200,
        taskLimitMicros: 1_000,
        projectMonthLimitMicros: 10_000,
        billingScope: 'project',
        payerId: projectId,
        now: baseTime,
        reservationExpiresAt: reserved.reservationExpiresAt,
      }),
    ).resolves.toBe('task_budget_exceeded')
    expect(insert).not.toHaveBeenCalled()
  })

  it('releases every live reservation in a task and returns the remaining aggregate', async () => {
    const events: string[] = []
    const released = cost({
      turnId: 'turn-2',
      state: 'released',
      reservedMicros: 250,
      createdAt: new Date('2026-08-01T00:01:00.000Z'),
      updatedAt: new Date('2026-08-01T00:02:00.000Z'),
    })
    const settled = cost({
      turnId: 'turn-1',
      state: 'settled',
      reservedMicros: 150,
      settledMicros: 100,
      minimumMicros: 100,
      maximumMicros: 100,
      promptTokens: 10,
      completionTokens: 4,
    })
    const updateResult = vi.fn(async () => {
      events.push('release')
      return []
    })
    const rows = selectedRows([released, settled])
    rows.orderBy.mockImplementation(async () => {
      events.push('aggregate')
      return [released, settled]
    })
    const tx = {
      execute: vi.fn(),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateResult })) })),
      select: vi.fn(() => rows),
    }
    transaction.mockImplementation(async run => run(tx))
    const { createPgRepository } = await import('./repository.js')

    await expect(createPgRepository(env).releaseAgentRunCost?.(actorId, projectId, 'task-1')).resolves.toMatchObject({
      id: released.id,
      turnId: released.turnId,
      state: 'settled',
      reservedMicros: 150,
      settledMicros: 100,
      minimumMicros: 100,
      maximumMicros: 100,
      promptTokens: 10,
      completionTokens: 4,
    })
    expect(events).toEqual(['release', 'aggregate'])
  })
})
