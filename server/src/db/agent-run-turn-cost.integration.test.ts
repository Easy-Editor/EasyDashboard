import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import type { Repository } from '../types.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip

const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null

function repositoryEnv(databaseUrl: string): AppEnv {
  return {
    NODE_ENV: 'test',
    APP_ORIGIN: 'https://app.example.com',
    PUBLIC_VIEWER_ORIGIN: 'https://view.example.com',
    PORT: 8787,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890',
    DATABASE_URL: databaseUrl,
  }
}

async function seedProject() {
  if (!admin) throw new Error('Agent turn cost integration test requires an administrator database')
  const actorId = randomUUID()
  const spaceId = randomUUID()
  const projectId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  await admin.query(
    `insert into app.spaces (id, kind, name, personal_owner_id, created_by)
     values ($1, 'personal', 'Turn cost integration', $2, $2)`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.space_members (space_id, user_id, role)
     values ($1, $2, 'owner')`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.projects (id, owner_id, space_id, name, draft_schema)
     values ($1, $2, $3, 'Turn cost integration', '{}'::jsonb)`,
    [projectId, actorId, spaceId],
  )
  await admin.query(
    `insert into app.project_members (project_id, user_id, role, created_by) values ($1, $2, 'owner', $2)`,
    [projectId, actorId],
  )
  return { actorId, projectId }
}

async function seedSecondProject(actorId: string, firstProjectId: string) {
  if (!admin) throw new Error('Agent turn cost integration test requires an administrator database')
  const projectId = randomUUID()
  await admin.query(
    `insert into app.projects (id, owner_id, space_id, name, draft_schema)
     select $1, $2, space_id, 'Second turn cost integration', '{}'::jsonb
     from app.projects
     where id = $3`,
    [projectId, actorId, firstProjectId],
  )
  await admin.query(
    `insert into app.project_members (project_id, user_id, role, created_by) values ($1, $2, 'owner', $2)`,
    [projectId, actorId],
  )
  return projectId
}

async function cleanupActor(actorId: string) {
  await admin?.query('delete from auth.users where id = $1', [actorId])
}

function requireCostRepository(repository: Repository) {
  if (
    !repository.reserveAgentRunCost ||
    !repository.settleAgentRunCost ||
    !repository.getAgentRunCost ||
    !repository.getAgentRunCostByTurn ||
    !repository.getAgentBudgetUsage
  ) {
    throw new Error('PostgreSQL repository must implement durable Agent turn cost methods')
  }
  return {
    reserve: repository.reserveAgentRunCost,
    settle: repository.settleAgentRunCost,
    getTask: repository.getAgentRunCost,
    getTurn: repository.getAgentRunCostByTurn,
    getBudgetUsage: repository.getAgentBudgetUsage,
  }
}

function reservationInput(
  projectId: string,
  input: {
    taskId: string
    turnId: string
    inputDigest: string
    estimatedMicros: number
    operationId?: string
    taskLimitMicros?: number
    projectMonthLimitMicros?: number
  },
) {
  const now = new Date()
  return {
    projectId,
    taskId: input.taskId,
    turnId: input.turnId,
    inputDigest: input.inputDigest,
    estimatedMicros: input.estimatedMicros,
    taskLimitMicros: input.taskLimitMicros ?? 10_000,
    projectMonthLimitMicros: input.projectMonthLimitMicros ?? 100_000,
    operationId: input.operationId,
    provider: 'openai-compatible',
    model: 'integration-model',
    profile: 'platform:default',
    billingScope: 'project' as const,
    payerId: projectId,
    now,
    reservationExpiresAt: new Date(now.getTime() + 600_000),
  }
}

describeWithDatabase('Agent run turn cost PostgreSQL integration', () => {
  afterAll(async () => {
    await admin?.end()
  })

  it('reuses one durable operation when concurrent retries reserve the same turn input', async () => {
    const fixture = await seedProject()
    const { reserve } = requireCostRepository(createPgRepository(repositoryEnv(runtimeDatabaseUrl!)))
    const operationId = randomUUID()
    const input = reservationInput(fixture.projectId, {
      taskId: `task-${randomUUID()}`,
      turnId: `turn-${randomUUID()}`,
      inputDigest: 'a'.repeat(64),
      estimatedMicros: 240,
      operationId,
    })

    try {
      const [first, retry] = await Promise.all([reserve(fixture.actorId, input), reserve(fixture.actorId, input)])

      expect(first).toMatchObject({ operationId, turnId: input.turnId })
      expect(retry).toEqual(first)
      const persisted = await admin!.query<{ count: string; operation_id: string }>(
        `select count(*)::text as count, min(operation_id) as operation_id
         from app.agent_run_costs
         where actor_id = $1 and project_id = $2 and turn_id = $3`,
        [fixture.actorId, fixture.projectId, input.turnId],
      )
      expect(persisted.rows[0]).toEqual({ count: '1', operation_id: operationId })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('returns conflict when the same turn is retried with a different input digest', async () => {
    const fixture = await seedProject()
    const { reserve } = requireCostRepository(createPgRepository(repositoryEnv(runtimeDatabaseUrl!)))
    const input = reservationInput(fixture.projectId, {
      taskId: `task-${randomUUID()}`,
      turnId: `turn-${randomUUID()}`,
      inputDigest: 'b'.repeat(64),
      estimatedMicros: 100,
      operationId: randomUUID(),
    })

    try {
      await reserve(fixture.actorId, input)
      await expect(
        reserve(fixture.actorId, { ...input, inputDigest: 'c'.repeat(64), operationId: randomUUID() }),
      ).resolves.toBe('conflict')
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('persists different turns independently within the same task', async () => {
    const fixture = await seedProject()
    const { reserve, getTurn } = requireCostRepository(createPgRepository(repositoryEnv(runtimeDatabaseUrl!)))
    const taskId = `task-${randomUUID()}`
    const firstTurnId = `turn-${randomUUID()}`
    const secondTurnId = `turn-${randomUUID()}`

    try {
      await reserve(
        fixture.actorId,
        reservationInput(fixture.projectId, {
          taskId,
          turnId: firstTurnId,
          inputDigest: 'd'.repeat(64),
          estimatedMicros: 120,
        }),
      )
      await reserve(
        fixture.actorId,
        reservationInput(fixture.projectId, {
          taskId,
          turnId: secondTurnId,
          inputDigest: 'e'.repeat(64),
          estimatedMicros: 230,
        }),
      )

      await expect(getTurn(fixture.actorId, fixture.projectId, firstTurnId)).resolves.toMatchObject({
        taskId,
        turnId: firstTurnId,
        reservedMicros: 120,
      })
      await expect(getTurn(fixture.actorId, fixture.projectId, secondTurnId)).resolves.toMatchObject({
        taskId,
        turnId: secondTurnId,
        reservedMicros: 230,
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('aggregates every durable turn when reading task cost', async () => {
    const fixture = await seedProject()
    const { reserve, settle, getTask } = requireCostRepository(createPgRepository(repositoryEnv(runtimeDatabaseUrl!)))
    const taskId = `task-${randomUUID()}`
    const settledTurnId = `turn-${randomUUID()}`
    const reservedTurnId = `turn-${randomUUID()}`

    try {
      await reserve(
        fixture.actorId,
        reservationInput(fixture.projectId, {
          taskId,
          turnId: settledTurnId,
          inputDigest: 'f'.repeat(64),
          estimatedMicros: 120,
        }),
      )
      await settle(fixture.actorId, {
        projectId: fixture.projectId,
        taskId,
        turnId: settledTurnId,
        settledMicros: 90,
        minimumMicros: 90,
        maximumMicros: 90,
        promptTokens: 12,
        completionTokens: 3,
      })
      await reserve(
        fixture.actorId,
        reservationInput(fixture.projectId, {
          taskId,
          turnId: reservedTurnId,
          inputDigest: '0'.repeat(64),
          estimatedMicros: 230,
        }),
      )

      await expect(getTask(fixture.actorId, fixture.projectId, taskId)).resolves.toMatchObject({
        state: 'reserved',
        reservedMicros: 350,
        settledMicros: 90,
        minimumMicros: 90,
        maximumMicros: 320,
        promptTokens: 12,
        completionTokens: 3,
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('reads a settled decision checkpoint, usage, and trace by turn', async () => {
    const fixture = await seedProject()
    const { reserve, settle, getTurn } = requireCostRepository(createPgRepository(repositoryEnv(runtimeDatabaseUrl!)))
    const taskId = `task-${randomUUID()}`
    const turnId = `turn-${randomUUID()}`
    const decisionOutput = { action: 'ask_user', message: '请选择数据范围' }
    const decisionUsage = { promptTokens: 20, completionTokens: 8, totalTokens: 28 }
    const decisionTrace = { promptBundleId: 'bundle-integration', promptBundleVersion: '1' }

    try {
      await reserve(
        fixture.actorId,
        reservationInput(fixture.projectId, {
          taskId,
          turnId,
          inputDigest: '1'.repeat(64),
          estimatedMicros: 280,
        }),
      )
      await settle(fixture.actorId, {
        projectId: fixture.projectId,
        taskId,
        turnId,
        settledMicros: 260,
        minimumMicros: 260,
        maximumMicros: 260,
        promptTokens: 20,
        completionTokens: 8,
        decisionOutput,
        decisionUsage,
        decisionTrace,
      })

      await expect(getTurn(fixture.actorId, fixture.projectId, turnId)).resolves.toMatchObject({
        state: 'settled',
        turnId,
        decisionOutput,
        decisionUsage,
        decisionTrace,
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('includes every turn in the same task when enforcing its budget', async () => {
    const fixture = await seedProject()
    const { reserve, settle } = requireCostRepository(createPgRepository(repositoryEnv(runtimeDatabaseUrl!)))
    const taskId = `task-${randomUUID()}`
    const firstTurnId = `turn-${randomUUID()}`

    try {
      await reserve(
        fixture.actorId,
        reservationInput(fixture.projectId, {
          taskId,
          turnId: firstTurnId,
          inputDigest: '2'.repeat(64),
          estimatedMicros: 200,
        }),
      )
      await settle(fixture.actorId, {
        projectId: fixture.projectId,
        taskId,
        turnId: firstTurnId,
        settledMicros: 200,
      })
      await reserve(
        fixture.actorId,
        reservationInput(fixture.projectId, {
          taskId,
          turnId: `turn-${randomUUID()}`,
          inputDigest: '3'.repeat(64),
          estimatedMicros: 300,
        }),
      )

      await expect(
        reserve(
          fixture.actorId,
          reservationInput(fixture.projectId, {
            taskId,
            turnId: `turn-${randomUUID()}`,
            inputDigest: '4'.repeat(64),
            estimatedMicros: 1,
            taskLimitMicros: 500,
          }),
        ),
      ).resolves.toBe('task_budget_exceeded')
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('serializes concurrent user-month reservations across projects and aggregates their usage', async () => {
    const fixture = await seedProject()
    const secondProjectId = await seedSecondProject(fixture.actorId, fixture.projectId)
    const { reserve, getBudgetUsage } = requireCostRepository(createPgRepository(repositoryEnv(runtimeDatabaseUrl!)))
    const firstInput = {
      ...reservationInput(fixture.projectId, {
        taskId: `task-${randomUUID()}`,
        turnId: `turn-${randomUUID()}`,
        inputDigest: '5'.repeat(64),
        estimatedMicros: 600,
        projectMonthLimitMicros: 1_000,
      }),
      billingScope: 'user' as const,
      payerId: fixture.actorId,
    }
    const secondInput = {
      ...reservationInput(secondProjectId, {
        taskId: `task-${randomUUID()}`,
        turnId: `turn-${randomUUID()}`,
        inputDigest: '6'.repeat(64),
        estimatedMicros: 600,
        projectMonthLimitMicros: 1_000,
      }),
      billingScope: 'user' as const,
      payerId: fixture.actorId,
    }

    try {
      const results = await Promise.all([reserve(fixture.actorId, firstInput), reserve(fixture.actorId, secondInput)])

      expect(results.filter(result => result === 'project_budget_exceeded')).toHaveLength(1)
      expect(results.filter(result => typeof result === 'object' && result !== null)).toHaveLength(1)

      await expect(
        getBudgetUsage(fixture.actorId, {
          projectId: secondProjectId,
          taskId: secondInput.taskId,
          billingScope: 'user',
          payerId: fixture.actorId,
        }),
      ).resolves.toEqual({ taskMicros: results[1] === 'project_budget_exceeded' ? 0 : 600, projectMonthMicros: 600 })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })
})
