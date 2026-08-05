import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import type { AgentTaskRunBounds } from '../types.js'
import type { ProjectSchema } from '../validation.js'
import { createAgentTaskRunFixture } from './agent-task-test-fixture.js'
import { createPgRepository } from './repository.js'

const repository = readFileSync(new URL('./repository.ts', import.meta.url), 'utf8')
const types = readFileSync(new URL('../types.ts', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('../../../supabase/migrations/20260804120000_agent_task_loop_persistence_kernel.sql', import.meta.url),
  'utf8',
).toLowerCase()
const rowLockGrantMigration = readFileSync(
  new URL('../../../supabase/migrations/20260805015826_grant_agent_model_binding_row_lock.sql', import.meta.url),
  'utf8',
).toLowerCase()

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const pgRepository = runtimeDatabaseUrl ? createPgRepository({ DATABASE_URL: runtimeDatabaseUrl } as AppEnv) : null
const now = new Date('2026-08-04T00:00:00.000Z')
const bounds: AgentTaskRunBounds = {
  maxProviderTurns: 12,
  maxStepRevisions: 2,
  maxExecutorRetries: 1,
  tokenLimit: 40_000,
  costLimitMicros: 2_000_000,
}
const baseSchema: ProjectSchema = {
  formatVersion: 1,
  editorSchema: { version: '1.0.0', componentsTree: [] },
  presentation: { startPageId: 'page-home', theme: { mode: 'dark', tokens: {} } },
}

async function seedKernelProject() {
  if (!admin || !pgRepository) throw new Error('Agent task kernel integration database is unavailable')
  const actorId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  const project = await pgRepository.createProject(actorId, { name: 'Task kernel integration', schema: baseSchema })
  return { actorId, projectId: project.id }
}

function taskInput(projectId: string, conversationId: string, taskId: string, idempotencyKey = randomUUID()) {
  return {
    projectId,
    conversationId,
    taskId,
    idempotencyKey,
    binding: {
      provider: 'openai-compatible',
      model: 'kernel-model',
      profileId: 'profile-1',
      configDigest: 'a'.repeat(64),
    },
    bounds,
    taskStartDocumentRevision: 1,
    now,
  }
}

function method(name: string, nextName: string): string {
  const start = repository.indexOf(`${name}(`)
  const end = repository.indexOf(`${nextName}(`, start + name.length)
  expect(start, `${name} repository method`).toBeGreaterThan(-1)
  expect(end, `${nextName} repository method after ${name}`).toBeGreaterThan(start)
  return repository.slice(start, end)
}

describe('Agent task transition repository contract', () => {
  it.each([
    'resolveAgentConversationModelBinding',
    'createAgentTaskRun',
    'getAgentTaskRun',
    'createAgentTaskPlan',
    'reviseAgentTaskPlan',
    'appendAgentTaskEvent',
    'acquireAgentProjectTaskLease',
    'releaseAgentProjectTaskLease',
    'claimAgentTaskTransition',
    'heartbeatAgentTaskTransition',
    'completeAgentTaskTransition',
    'reconcileAgentTaskTransition',
  ])('exposes the durable %s repository seam', name => {
    expect(repository).toContain(`${name}(`)
    expect(types).toContain(`${name}`)
  })

  it('treats provider, model, profile, and effective non-secret digest as immutable conversation binding fields', () => {
    const source = method('resolveAgentConversationModelBinding', 'createAgentTaskRun')

    expect(source).toContain('configuration_drift')
    expect(source).toContain('provider')
    expect(source).toContain('model')
    expect(source).toContain('profileId')
    expect(source).toContain('configDigest')
  })

  it('does not persist credentials or secrets in the immutable conversation binding', () => {
    const source = method('resolveAgentConversationModelBinding', 'createAgentTaskRun').toLowerCase()

    expect(source).not.toMatch(/insert[\s\S]{0,1200}(api[_a-z]*key|credential|secret|access[_a-z]*token)/)
  })

  it('copies the resolved immutable binding snapshot into every new task run', () => {
    const source = method('createAgentTaskRun', 'getAgentTaskRun')

    expect(source).toContain('binding')
    expect(source).toContain('provider')
    expect(source).toContain('model')
    expect(source).toContain('configDigest')
  })

  it('grants the runtime role the privilege PostgreSQL requires for immutable binding row locks', () => {
    expect(rowLockGrantMigration).toContain(
      'grant update on app.agent_conversation_model_bindings to easy_dashboard_runtime',
    )
  })

  it('uses one project-scoped lease row to fence mutating chains across conversations', () => {
    const acquire = method('acquireAgentProjectTaskLease', 'releaseAgentProjectTaskLease')

    expect(acquire).toContain('projectId')
    expect(acquire).toMatch(/generation/i)
    expect(acquire).toMatch(/leaseToken|lease_token/)
    expect(acquire).toMatch(/leaseUntil|lease_until/)
  })

  it('does not require the project semantic write lease when claiming planning work', () => {
    const claimStart = migration.indexOf('create function app.claim_agent_task_transition')
    const claim = migration.slice(claimStart, claimStart + 9000)

    expect(claimStart).toBeGreaterThan(-1)
    expect(claim).toMatch(/planning/)
    expect(claim).toMatch(/step_action|final_verification|rollback/)
  })

  it('claims only pending or expired transition leases with skip-locked concurrency', () => {
    const claim = method('claimAgentTaskTransition', 'heartbeatAgentTaskTransition').toLowerCase()

    expect(claim).toContain('pending')
    expect(claim).toContain('lease_until')
    expect(claim).toContain('skip locked')
  })

  it('supports an optional database-enforced transition-kind claim filter', () => {
    const claim = method('claimAgentTaskTransition', 'heartbeatAgentTaskTransition')
    const claimFunctionStart = migration.indexOf('create function app.claim_agent_task_transition')
    const claimFunction = migration.slice(claimFunctionStart, claimFunctionStart + 8_000)

    expect(claim).toMatch(/kinds/)
    expect(claim).toMatch(/agent_task_transition_kind\[\]/)
    expect(claimFunction).toMatch(/claim_kinds app\.agent_task_transition_kind\[\] default null/)
    expect(claimFunction).toMatch(/claim_kinds is null or transition\.kind = any\(claim_kinds\)/)
    expect(claimFunction).toMatch(/claim_kinds is null or earlier\.kind = any\(claim_kinds\)/)
  })

  it('returns the project lease fence with every claimed mutating transition', () => {
    const claim = method('claimAgentTaskTransition', 'heartbeatAgentTaskTransition')

    expect(claim).toMatch(/project_lease_generation as "projectLeaseGeneration"/)
    expect(claim).toMatch(/project_lease_token as "projectLeaseToken"/)
    expect(claim).toMatch(/project_lease_worker_id as "projectLeaseWorkerId"/)
  })

  it('prevents a second worker from claiming another transition for the same task run', () => {
    const claimStart = migration.indexOf('create function app.claim_agent_task_transition')
    const claim = migration.slice(claimStart, claimStart + 12_000)

    expect(claimStart).toBeGreaterThan(-1)
    expect(claim).toMatch(/not exists[\s\S]{0,1200}task_run_id[\s\S]{0,500}status\s*=\s*'leased'/)
  })

  it('heartbeats only the exact transition generation, token, worker, and live lease', () => {
    const heartbeat = method('heartbeatAgentTaskTransition', 'completeAgentTaskTransition')

    expect(heartbeat).toMatch(/leaseGeneration|lease_generation/)
    expect(heartbeat).toMatch(/leaseToken|lease_token/)
    expect(heartbeat).toMatch(/workerId|leaseOwner|lease_owner/)
    expect(heartbeat).toMatch(/leaseUntil|lease_until/)
    expect(heartbeat).toContain('stale')
  })

  it.each([
    ['heartbeat', 'heartbeatAgentTaskTransition', 'completeAgentTaskTransition'],
    ['completion', 'completeAgentTaskTransition', 'reconcileAgentTaskTransition'],
  ])('fences mutating %s with the exact live project lease', (_label, start, end) => {
    const source = method(start, end)

    expect(source).toMatch(/projectLeaseGeneration|project_lease_generation/)
    expect(source).toMatch(/projectLeaseToken|project_lease_token/)
    expect(source).toMatch(/projectLeaseWorkerId|project_lease_worker_id/)
    expect(source).toMatch(/agentProjectTaskLeases|agent_project_task_leases/)
    expect(source).toContain('stale')
  })

  it('completes state, events, accounting, and at most one next transition in one transaction', () => {
    const complete = method('completeAgentTaskTransition', 'reconcileAgentTaskTransition')

    expect(complete).toMatch(/transaction/i)
    expect(complete).toMatch(/taskRunPatch/)
    expect(complete).toMatch(/events/)
    expect(complete).toMatch(/nextTransition/)
    expect(complete).toMatch(/transitionKey|transition_key/)
  })

  it('returns the stable completed result when the same transition completion is replayed', () => {
    const complete = method('completeAgentTaskTransition', 'reconcileAgentTaskTransition')

    expect(complete).toMatch(/completed/)
    expect(complete).toMatch(/stale/)
    expect(complete).toMatch(/invalid_state/)
  })

  it('validates next-transition kind before writing plans, steps, events, or accounting', () => {
    const complete = method('completeAgentTaskTransition', 'reconcileAgentTaskTransition')
    const nextKindValidation = complete.indexOf('allowedNextKinds')
    const firstPlanWrite = complete.indexOf('.insert(agentTaskPlans)')

    expect(nextKindValidation).toBeGreaterThan(-1)
    expect(firstPlanWrite).toBeGreaterThan(-1)
    expect(nextKindValidation).toBeLessThan(firstPlanWrite)
  })

  it('returns conflict when completed transition input is replayed with a different completion digest', () => {
    const complete = method('completeAgentTaskTransition', 'reconcileAgentTaskTransition')
    const replay = complete.slice(0, complete.indexOf("transition.status !== 'leased'"))

    expect(replay).toMatch(/completionDigest|completion_digest/)
    expect(replay).toContain("'conflict'")
  })

  it('releases the exact project lease for waiting, paused, and terminal task completion', () => {
    const complete = method('completeAgentTaskTransition', 'reconcileAgentTaskTransition')

    expect(complete).toMatch(/waiting_user[\s\S]{0,500}paused/)
    expect(complete).toMatch(/agentProjectTaskLeases|agent_project_task_leases/)
    expect(complete).toMatch(/leaseGeneration|lease_generation/)
    expect(complete).toMatch(/leaseToken|lease_token/)
    expect(complete).toMatch(/leaseOwner|lease_owner/)
  })

  it('rejects lifecycle-incompatible enqueue before inserting or consuming a generation', () => {
    const enqueue = method('enqueueAgentTaskTransition', 'createAgentTaskPlan')
    const rejection = enqueue.indexOf("'invalid_state'")
    const insert = enqueue.indexOf('.insert(agentTaskTransitions)')

    expect(rejection).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(-1)
    expect(rejection).toBeLessThan(insert)
  })

  it.each([
    ['task lifecycle', /run\.status/],
    ['transition kind', /transition\.kind/],
    ['active plan', /activePlanVersion/],
    ['cross-run step', /taskRunId/],
    ['executor retry budget', /maxExecutorRetries/],
    ['semantic revision budget', /maxStepRevisions/],
    ['additive accounting', /accountingDelta/],
  ])('rejects completion that violates the %s invariant', (_label, invariant) => {
    const complete = method('completeAgentTaskTransition', 'reconcileAgentTaskTransition')

    expect(complete).toMatch(invariant)
    expect(complete).toContain("'invalid_state'")
  })

  it('rejects provider-owned transition accounting fields even when their value is zero', () => {
    const complete = method('completeAgentTaskTransition', 'reconcileAgentTaskTransition')

    expect(complete).toContain("['providerTurns', 'promptTokens', 'completionTokens', 'costMicros']")
    expect(complete).toMatch(/hasOwnProperty\.call\(input\.accountingDelta/)
    expect(complete).toContain("'invalid_state'")
  })

  it('binds task and transition idempotency keys to canonical request digests', () => {
    const create = method('createAgentTaskRun', 'getAgentTaskRun')
    const enqueue = method('enqueueAgentTaskTransition', 'createAgentTaskPlan')

    for (const source of [create, enqueue]) {
      expect(source).toMatch(/requestDigest|request_digest/)
      expect(source).toContain("'conflict'")
    }
  })

  it('rejects unordered plan ordinals instead of sorting provider output', () => {
    const start = repository.indexOf('function normalizedAgentPlanSteps')
    const normalize = repository.slice(start, repository.indexOf('\n}\n', start) + 2)

    expect(start).toBeGreaterThan(-1)
    expect(normalize).toMatch(/every\(\(ordinal, index\) => ordinal === index \+ 1\)/)
    expect(normalize).not.toMatch(/\.sort\(/)
  })

  it('redacts protocol-shaped fields before persisting public task events', () => {
    const append = method('appendAgentTaskEvent', 'acquireAgentProjectTaskLease')

    expect(append).toMatch(/redact|saniti[sz]e|publicAgentTask/i)
    expect(append).not.toContain('publicPayload: input.publicPayload ?? {}')
  })

  it('drops nested protocol-bearing public string values instead of preserving them', () => {
    const start = repository.indexOf('function sanitizePublicAgentTaskValue')
    const sanitize = repository.slice(start, repository.indexOf('\n}\n', start) + 2)

    expect(start).toBeGreaterThan(-1)
    expect(sanitize).toMatch(/typeof value === ['"]string['"]/)
    expect(sanitize).toMatch(/isAgentConversationImplementationDetailText/)
  })

  it('reuses the conversation policy implementation-detail predicate for every public task event value', () => {
    expect(repository).toContain('import { isAgentConversationImplementationDetailText }')
    expect(repository).toContain("from '../agent/conversation-policy.js'")
    expect(repository).not.toContain('const agentTaskPublicProtocolPattern')
    expect(repository).toMatch(/isAgentConversationImplementationDetailText\(value\)/)
    expect(repository).toMatch(/isAgentConversationImplementationDetailText\(event\.summary\)/)
  })

  it('reserves transition accounting deltas for executor retries and semantic revisions', () => {
    const start = types.indexOf('export interface AgentTaskCompletionInput')
    const completionInput = types.slice(start, types.indexOf('\nexport interface', start + 1))

    expect(completionInput).toContain('executorRetries?: number')
    expect(completionInput).toContain('semanticRevisions?: number')
    expect(completionInput).not.toContain('providerTurns?: number')
    expect(completionInput).not.toContain('promptTokens?: number')
    expect(completionInput).not.toContain('completionTokens?: number')
    expect(completionInput).not.toContain('costMicros?: number')
  })

  it('reconciles persisted pending and expired work without recreating completed transitions', () => {
    const start = repository.indexOf('reconcileAgentTaskTransition(')
    expect(start).toBeGreaterThan(-1)
    const reconcile = repository.slice(start, start + 5000).toLowerCase()

    expect(reconcile).toContain('pending')
    expect(reconcile).toMatch(/leaseUntil|lease_until/i)
    expect(reconcile).not.toMatch(/status[^\n]{0,80}=\s*['"]completed['"]/)
  })
})

describeWithDatabase('Agent task transition PostgreSQL concurrency', () => {
  afterAll(async () => admin?.end())

  it('claims later planning work without touching an earlier pending step action', async () => {
    if (
      !admin ||
      !pgRepository?.createAgentTaskRun ||
      !pgRepository.claimAgentTaskTransition ||
      !pgRepository.completeAgentTaskTransition ||
      !pgRepository.acquireAgentProjectTaskLease
    ) {
      throw new Error('Agent task filtered claim repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const first = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-filter-step', 'task-filter-step'),
      )
      if (!first || typeof first === 'string') throw new Error('First filtered claim run could not be created')
      const planningWorker = 'filter-seed-planning-worker'
      const planning = await pgRepository.claimAgentTaskTransition(
        planningWorker,
        now,
        new Date(now.getTime() + 30_000),
      )
      if (!planning?.leaseToken) throw new Error('Initial planning transition could not be claimed')
      const planned = await pgRepository.completeAgentTaskTransition(
        fixture.actorId,
        {
          transitionId: planning.id,
          workerId: planningWorker,
          leaseGeneration: planning.leaseGeneration,
          leaseToken: planning.leaseToken,
        },
        {
          status: 'completed',
          taskRunPatch: { status: 'running' },
          plan: {
            summary: 'Filtered claim plan',
            assumptions: [],
            verification: {},
            steps: [{ id: 'filtered-step', ordinal: 1, title: 'Execute later', intent: {} }],
          },
          nextTransition: { kind: 'step_action', stepOrdinal: 1, transitionKey: 'filtered-step:action' },
          now,
        },
      )
      if (typeof planned === 'string') throw new Error('Filtered claim plan could not be completed')
      const filteredWorker = 'planning-only-filter-worker'
      const lease = await pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
        taskRunId: first.id,
        workerId: filteredWorker,
        now,
        leaseUntil: new Date(now.getTime() + 60_000),
      })
      if (!lease || typeof lease === 'string') throw new Error('Filtered claim project lease could not be acquired')
      const later = new Date(now.getTime() + 1_000)
      const second = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, {
        ...taskInput(fixture.projectId, 'conversation-filter-planning', 'task-filter-planning'),
        now: later,
      })
      if (!second || typeof second === 'string') throw new Error('Second filtered claim run could not be created')

      const claimed = await pgRepository.claimAgentTaskTransition(
        filteredWorker,
        later,
        new Date(later.getTime() + 30_000),
        ['planning'],
      )

      expect(claimed).toMatchObject({ taskRunId: second.id, kind: 'planning', claimAttempts: 1 })
      const stepAction = await admin.query<{ status: string; claim_attempts: number }>(
        `select status, claim_attempts from app.agent_task_transitions
         where task_run_id=$1 and kind='step_action'`,
        [first.id],
      )
      expect(stepAction.rows[0]).toEqual({ status: 'pending', claim_attempts: 0 })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('creates one idempotent task root with an immutable model snapshot and one planning transition', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun) throw new Error('Agent task repository is unavailable')
    const fixture = await seedKernelProject()
    const input = taskInput(fixture.projectId, 'conversation-1', 'task-1')
    try {
      const first = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, input)
      const replay = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, input)

      expect(replay).toEqual(first)
      expect(first).toMatchObject({
        provider: 'openai-compatible',
        model: 'kernel-model',
        configDigest: 'a'.repeat(64),
      })
      const counts = await admin.query<{ runs: number; bindings: number; transitions: number }>(
        `select
          (select count(*)::int from app.agent_task_runs where project_id = $1) as runs,
          (select count(*)::int from app.agent_conversation_model_bindings where project_id = $1) as bindings,
          (select count(*)::int from app.agent_task_transitions where project_id = $1 and kind = 'planning') as transitions`,
        [fixture.projectId],
      )
      expect(counts.rows[0]).toEqual({ runs: 1, bindings: 1, transitions: 1 })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it.each([
    ['provider', { provider: 'another-provider' }],
    ['model', { model: 'another-model' }],
    ['profile', { profileId: 'profile-2' }],
    ['effective non-secret configuration', { configDigest: 'b'.repeat(64) }],
  ])('rejects %s drift for an existing conversation binding', async (_label, bindingOverride) => {
    if (!admin || !pgRepository?.createAgentTaskRun) throw new Error('Agent task repository is unavailable')
    const fixture = await seedKernelProject()
    try {
      const first = taskInput(fixture.projectId, 'conversation-drift', 'task-first')
      await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, first)
      await expect(
        createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, {
          ...taskInput(fixture.projectId, 'conversation-drift', 'task-second'),
          binding: { ...first.binding, ...bindingOverride },
        }),
      ).resolves.toBe('configuration_drift')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('allows planning transitions from two conversations in one project to be claimed concurrently', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.claimAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const first = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-a', 'task-a'),
      )
      const second = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-b', 'task-b'),
      )
      if (!first || typeof first === 'string' || !second || typeof second === 'string') {
        throw new Error('Agent task run fixture could not be created')
      }
      const leaseUntil = new Date(now.getTime() + 30_000)
      const claims = await Promise.all([
        pgRepository.claimAgentTaskTransition('planning-worker-a', now, leaseUntil),
        pgRepository.claimAgentTaskTransition('planning-worker-b', now, leaseUntil),
      ])

      expect(new Set(claims.map(claim => claim?.taskRunId))).toEqual(new Set([first.id, second.id]))
      expect(claims.every(claim => claim?.kind === 'planning')).toBe(true)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('allows only one of two conversations to hold the project semantic write lease', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.acquireAgentProjectTaskLease) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const first = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-a', 'task-a'),
      )
      const second = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-b', 'task-b'),
      )
      if (!first || typeof first === 'string' || !second || typeof second === 'string') {
        throw new Error('Agent task run fixture could not be created')
      }
      const leaseUntil = new Date(now.getTime() + 30_000)
      const leases = await Promise.all([
        pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
          taskRunId: first.id,
          workerId: 'mutation-worker-a',
          now,
          leaseUntil,
        }),
        pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
          taskRunId: second.id,
          workerId: 'mutation-worker-b',
          now,
          leaseUntil,
        }),
      ])

      expect(leases.filter(lease => lease === 'busy')).toHaveLength(1)
      expect(leases.filter(lease => lease && typeof lease !== 'string')).toHaveLength(1)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('claims transitions from the same task run sequentially across two workers', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.enqueueAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-sequential', 'task-sequential'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      await pgRepository.enqueueAgentTaskTransition(fixture.actorId, {
        taskRunId: run.id,
        kind: 'planning',
        transitionKey: 'planning:2',
        input: { revision: 2 },
        now,
      })

      const leaseUntil = new Date(now.getTime() + 30_000)
      const first = await pgRepository.claimAgentTaskTransition?.('same-task-worker-a', now, leaseUntil)
      const second = await pgRepository.claimAgentTaskTransition?.('same-task-worker-b', now, leaseUntil)

      expect(first).toMatchObject({ taskRunId: run.id, generation: 1, leaseOwner: 'same-task-worker-a' })
      expect(second).toBeNull()
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('returns conflict when a task idempotency key is replayed with changed immutable input', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun) throw new Error('Agent task repository is unavailable')
    const fixture = await seedKernelProject()
    const idempotencyKey = randomUUID()
    try {
      const input = taskInput(fixture.projectId, 'conversation-idempotency', 'task-idempotency', idempotencyKey)
      await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, input)

      await expect(
        createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, {
          ...input,
          bounds: { ...input.bounds, tokenLimit: input.bounds.tokenLimit + 1 },
        }),
      ).resolves.toBe('conflict')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('removes protocol fields recursively from public event payloads', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.appendAgentTaskEvent) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-redaction', 'task-redaction'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')

      const event = await pgRepository.appendAgentTaskEvent(fixture.actorId, run.id, {
        eventKey: 'redaction:1',
        type: 'step_started',
        summary: 'Safe progress update',
        publicPayload: {
          message: 'The shell is ready',
          nodeId: 'secret-node',
          nested: {
            keep: 'visible',
            protocolText: 'nodeId=secret-node',
            values: ['safe', 'fieldPath=props.width'],
            fieldPath: 'props.width',
            coordinates: { x: 10, y: 20 },
          },
        },
        technicalPayload: { nodeId: 'technical-node' },
        now,
      })

      expect(event?.publicPayload).toEqual({
        message: 'The shell is ready',
        nested: { keep: 'visible', values: ['safe'] },
      })
      expect(event?.technicalPayload).toEqual({ nodeId: 'technical-node' })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it.each([
    {
      name: 'raw JSON summary',
      summary: '{"title":"Quarterly revenue"}',
      publicPayload: { message: 'Visible progress' },
      expectedSummary: 'Agent activity updated.',
      expectedPayload: { message: 'Visible progress' },
    },
    {
      name: 'nested JSON-shaped implementation text',
      summary: 'Visible progress',
      publicPayload: { message: 'Visible progress', nested: { keep: 'visible', unsafe: 'Apply {"x":120,"y":48}' } },
      expectedSummary: 'Visible progress',
      expectedPayload: { message: 'Visible progress', nested: { keep: 'visible' } },
    },
    {
      name: 'nested numeric layout text',
      summary: 'Visible progress',
      publicPayload: {
        message: 'Visible progress',
        nested: { keep: 'visible', unsafe: 'Move to x=120, y=48, width=320, height=180' },
      },
      expectedSummary: 'Visible progress',
      expectedPayload: { message: 'Visible progress', nested: { keep: 'visible' } },
    },
  ])('redacts $name using the conversation policy boundary', async testCase => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.appendAgentTaskEvent) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, `conversation-${randomUUID()}`, `task-${randomUUID()}`),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')

      const event = await pgRepository.appendAgentTaskEvent(fixture.actorId, run.id, {
        eventKey: `conversation-policy:${randomUUID()}`,
        type: 'step_started',
        summary: testCase.summary,
        publicPayload: testCase.publicPayload,
        technicalPayload: {},
        now,
      })

      expect(event?.summary).toBe(testCase.expectedSummary)
      expect(event?.publicPayload).toEqual(testCase.expectedPayload)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('persists provider semantic step ids under server-owned UUID primary keys', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.claimAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-semantic-id', 'task-semantic-id'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const claim = await pgRepository.claimAgentTaskTransition(
        'semantic-id-worker',
        now,
        new Date(now.getTime() + 30_000),
      )
      if (!claim?.leaseToken) throw new Error('Planning transition fixture could not be claimed')

      const completed = await pgRepository.completeAgentTaskTransition?.(
        fixture.actorId,
        {
          transitionId: claim.id,
          workerId: 'semantic-id-worker',
          leaseGeneration: claim.leaseGeneration,
          leaseToken: claim.leaseToken,
        },
        {
          status: 'completed',
          taskRunPatch: { status: 'running' },
          plan: {
            summary: 'Build a safe dashboard shell',
            assumptions: [],
            verification: {},
            steps: [{ id: 'provider-step-shell', ordinal: 1, title: 'Build shell', intent: {} }],
          },
          nextTransition: {
            stepOrdinal: 1,
            kind: 'step_action',
            transitionKey: 'step-action:1',
          },
          now,
        },
      )

      expect(completed).not.toBe('invalid_state')
      expect(completed).not.toBe('stale')
      const persisted = await admin.query<{ id: string; semantic_step_key: string }>(
        'select id, semantic_step_key from app.agent_task_steps where task_run_id = $1',
        [run.id],
      )
      expect(persisted.rows).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
          semantic_step_key: 'provider-step-shell',
        }),
      ])
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it.each([
    ['unordered', [2, 1]],
    ['non-contiguous', [1, 3]],
  ])('rejects %s persisted plan ordinals', async (_label, ordinals) => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.claimAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, `conversation-ordinal-${_label}`, `task-ordinal-${_label}`),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const workerId = `ordinal-worker-${_label}`
      const claim = await pgRepository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 30_000))
      if (!claim?.leaseToken) throw new Error('Planning transition fixture could not be claimed')

      await expect(
        pgRepository.completeAgentTaskTransition?.(
          fixture.actorId,
          {
            transitionId: claim.id,
            workerId,
            leaseGeneration: claim.leaseGeneration,
            leaseToken: claim.leaseToken,
          },
          {
            status: 'completed',
            taskRunPatch: { status: 'running' },
            plan: {
              summary: 'Invalid ordinal plan',
              assumptions: [],
              verification: {},
              steps: ordinals.map((ordinal, index) => ({
                id: `semantic-${index + 1}`,
                ordinal,
                title: `Step ${index + 1}`,
                intent: {},
              })),
            },
            now,
          },
        ),
      ).resolves.toBe('invalid_state')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('rejects an old mutating fence after its project lease expires and is taken over', async () => {
    if (
      !admin ||
      !pgRepository?.createAgentTaskRun ||
      !pgRepository.claimAgentTaskTransition ||
      !pgRepository.acquireAgentProjectTaskLease ||
      !pgRepository.heartbeatAgentTaskTransition ||
      !pgRepository.completeAgentTaskTransition
    ) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-takeover', 'task-takeover'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const planning = await pgRepository.claimAgentTaskTransition(
        'planning-worker',
        now,
        new Date(now.getTime() + 60_000),
      )
      if (!planning?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
      const planningResult = await pgRepository.completeAgentTaskTransition(
        fixture.actorId,
        {
          transitionId: planning.id,
          workerId: 'planning-worker',
          leaseGeneration: planning.leaseGeneration,
          leaseToken: planning.leaseToken,
        },
        {
          status: 'completed',
          taskRunPatch: { status: 'running' },
          plan: {
            summary: 'Create one mutation step',
            assumptions: [],
            verification: {},
            steps: [{ id: 'semantic-mutation', ordinal: 1, title: 'Mutate safely', intent: {} }],
          },
          nextTransition: { stepOrdinal: 1, kind: 'step_action', transitionKey: 'step-action:takeover' },
          now,
        },
      )
      if (typeof planningResult === 'string') throw new Error('Planning completion fixture could not be created')
      const firstLease = await pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
        taskRunId: run.id,
        workerId: 'mutation-worker-a',
        now,
        leaseUntil: new Date(now.getTime() + 10_000),
      })
      if (!firstLease || typeof firstLease === 'string') throw new Error('Project lease fixture could not be acquired')
      const mutation = await pgRepository.claimAgentTaskTransition(
        'mutation-worker-a',
        now,
        new Date(now.getTime() + 60_000),
      )
      if (!mutation?.leaseToken) throw new Error('Mutation transition fixture could not be claimed')
      const oldFence = {
        transitionId: mutation.id,
        workerId: 'mutation-worker-a',
        leaseGeneration: mutation.leaseGeneration,
        leaseToken: mutation.leaseToken,
        projectLeaseGeneration: mutation.projectLeaseGeneration,
        projectLeaseToken: mutation.projectLeaseToken,
        projectLeaseWorkerId: mutation.projectLeaseWorkerId,
      }
      const takeoverAt = new Date(now.getTime() + 11_000)
      const takeover = await pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
        taskRunId: run.id,
        workerId: 'mutation-worker-b',
        now: takeoverAt,
        leaseUntil: new Date(now.getTime() + 41_000),
      })
      expect(takeover).toMatchObject({
        leaseOwner: 'mutation-worker-b',
        leaseGeneration: firstLease.leaseGeneration + 1,
      })

      await expect(
        pgRepository.heartbeatAgentTaskTransition(
          fixture.actorId,
          oldFence,
          takeoverAt,
          new Date(now.getTime() + 60_000),
        ),
      ).resolves.toBe('stale')
      await expect(
        pgRepository.completeAgentTaskTransition(fixture.actorId, oldFence, {
          status: 'completed',
          now: takeoverAt,
        }),
      ).resolves.toBe('stale')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it.each([
    ['provider-turn ownership', { providerTurns: 0 }],
    ['prompt-token ownership', { promptTokens: 0 }],
    ['completion-token ownership', { completionTokens: 0 }],
    ['cost ownership', { costMicros: 0 }],
    ['non-additive accounting', { executorRetries: -1 }],
  ])('rejects completion that violates the %s invariant', async (_label, accountingDelta) => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.claimAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, `conversation-budget-${_label}`, `task-budget-${_label}`),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const workerId = `budget-worker-${_label}`
      const claim = await pgRepository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 30_000))
      if (!claim?.leaseToken) throw new Error('Planning transition fixture could not be claimed')

      await expect(
        pgRepository.completeAgentTaskTransition?.(
          fixture.actorId,
          {
            transitionId: claim.id,
            workerId,
            leaseGeneration: claim.leaseGeneration,
            leaseToken: claim.leaseToken,
          },
          {
            status: 'completed',
            taskRunPatch: { status: 'running' },
            accountingDelta: accountingDelta as { executorRetries?: number; semanticRevisions?: number },
            plan: {
              summary: 'Budget validation plan',
              assumptions: [],
              verification: {},
              steps: [{ id: 'budget-step', ordinal: 1, title: 'Validate budget', intent: {} }],
            },
            now,
          },
        ),
      ).resolves.toBe('invalid_state')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('rolls back every completion write when the proposed next transition kind is invalid', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.claimAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-invalid-completion', 'task-invalid-completion'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const workerId = 'invalid-completion-worker'
      const claim = await pgRepository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 30_000))
      if (!claim?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
      const snapshot = () =>
        admin.query(
          `select
            (select row_to_json(task) from (
              select status, active_plan_version, next_event_sequence, next_transition_generation,
                current_transition_key, provider_turns, executor_retries, semantic_revisions,
                prompt_tokens, completion_tokens, cost_micros
              from app.agent_task_runs where id = $1
            ) task) as task,
            (select row_to_json(transition) from (
              select status, lease_owner, lease_generation, lease_token, output_json, error_json, completed_at
              from app.agent_task_transitions where id = $2
            ) transition) as transition,
            (select count(*)::int from app.agent_task_plans where task_run_id = $1) as plans,
            (select count(*)::int from app.agent_task_steps where task_run_id = $1) as steps,
            (select count(*)::int from app.agent_task_events where task_run_id = $1) as events,
            (select count(*)::int from app.agent_task_transitions where task_run_id = $1) as transitions`,
          [run.id, claim.id],
        )
      const before = (await snapshot()).rows[0]

      await expect(
        pgRepository.completeAgentTaskTransition?.(
          fixture.actorId,
          {
            transitionId: claim.id,
            workerId,
            leaseGeneration: claim.leaseGeneration,
            leaseToken: claim.leaseToken,
          },
          {
            status: 'completed',
            taskRunPatch: { status: 'running' },
            plan: {
              summary: 'This plan must roll back',
              assumptions: [],
              verification: {},
              steps: [{ id: 'rollback-proof-step', ordinal: 1, title: 'Do not persist', intent: {} }],
            },
            events: [
              {
                eventKey: 'invalid-completion:event',
                type: 'plan_created',
                summary: 'Must not persist',
                publicPayload: { safe: true },
              },
            ],
            nextTransition: {
              stepOrdinal: 1,
              kind: 'rollback',
              transitionKey: 'invalid-completion:rollback',
            },
            now,
          },
        ),
      ).resolves.toBe('invalid_state')

      expect((await snapshot()).rows[0]).toEqual(before)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('returns conflict without changing state when a completed transition is replayed with a different digest', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.claimAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-late-conflict', 'task-late-conflict'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const workerId = 'late-conflict-worker'
      const claim = await pgRepository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 30_000))
      if (!claim?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
      const fence = {
        transitionId: claim.id,
        workerId,
        leaseGeneration: claim.leaseGeneration,
        leaseToken: claim.leaseToken,
      }
      const completion = {
        status: 'completed' as const,
        taskRunPatch: { status: 'running' as const },
        plan: {
          summary: 'Stable completion',
          assumptions: [],
          verification: {},
          steps: [{ id: 'stable-step', ordinal: 1, title: 'Stable step', intent: {} }],
        },
        events: [{ eventKey: 'stable:event', type: 'plan_created' as const, summary: 'Stable event' }],
        nextTransition: {
          stepOrdinal: 1,
          kind: 'step_action' as const,
          transitionKey: 'stable:step-action',
          input: { version: 1 },
        },
        now,
      }
      const first = await pgRepository.completeAgentTaskTransition?.(fixture.actorId, fence, completion)
      if (!first || typeof first === 'string') throw new Error('Initial completion fixture could not be created')
      const before = await admin.query(
        `select
          (select row_to_json(task) from app.agent_task_runs task where task.id=$1) as task,
          (select json_agg(row_to_json(transition) order by generation)
            from app.agent_task_transitions transition where transition.task_run_id=$1) as transitions,
          (select count(*)::int from app.agent_task_plans where task_run_id=$1) as plans,
          (select count(*)::int from app.agent_task_steps where task_run_id=$1) as steps,
          (select count(*)::int from app.agent_task_events where task_run_id=$1) as events`,
        [run.id],
      )

      await expect(
        pgRepository.completeAgentTaskTransition?.(fixture.actorId, fence, {
          ...completion,
          accountingDelta: { executorRetries: 1 },
          nextTransition: { ...completion.nextTransition, kind: 'observation', input: { version: 2 } },
        }),
      ).resolves.toBe('conflict')

      const after = await admin.query(
        `select
          (select row_to_json(task) from app.agent_task_runs task where task.id=$1) as task,
          (select json_agg(row_to_json(transition) order by generation)
            from app.agent_task_transitions transition where transition.task_run_id=$1) as transitions,
          (select count(*)::int from app.agent_task_plans where task_run_id=$1) as plans,
          (select count(*)::int from app.agent_task_steps where task_run_id=$1) as steps,
          (select count(*)::int from app.agent_task_events where task_run_id=$1) as events`,
        [run.id],
      )
      expect(after.rows[0]).toEqual(before.rows[0])
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('rejects lifecycle-incompatible enqueue without consuming a transition generation', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.enqueueAgentTaskTransition) {
      throw new Error('Agent task repository is unavailable')
    }
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-enqueue-lifecycle', 'task-enqueue-lifecycle'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const before = await admin.query<{ next_transition_generation: number; transitions: number }>(
        `select next_transition_generation,
          (select count(*)::int from app.agent_task_transitions where task_run_id=$1) as transitions
         from app.agent_task_runs where id=$1`,
        [run.id],
      )

      await expect(
        pgRepository.enqueueAgentTaskTransition(fixture.actorId, {
          taskRunId: run.id,
          kind: 'step_action',
          transitionKey: 'invalid-enqueue:step-action',
          input: {},
          now,
        }),
      ).resolves.toBe('invalid_state')

      const after = await admin.query<{ next_transition_generation: number; transitions: number }>(
        `select next_transition_generation,
          (select count(*)::int from app.agent_task_transitions where task_run_id=$1) as transitions
         from app.agent_task_runs where id=$1`,
        [run.id],
      )
      expect(after.rows[0]).toEqual(before.rows[0])
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it.each(['waiting_user', 'paused', 'failed'] as const)(
    'releases the exact project lease when normal completion moves the task to %s',
    async taskStatus => {
      if (
        !admin ||
        !pgRepository?.createAgentTaskRun ||
        !pgRepository.claimAgentTaskTransition ||
        !pgRepository.completeAgentTaskTransition ||
        !pgRepository.acquireAgentProjectTaskLease
      ) {
        throw new Error('Agent task repository is unavailable')
      }
      const fixture = await seedKernelProject()
      try {
        const first = await createAgentTaskRunFixture(
          admin,
          pgRepository,
          fixture.actorId,
          taskInput(fixture.projectId, `conversation-release-${taskStatus}`, `task-release-${taskStatus}`),
        )
        if (!first || typeof first === 'string') throw new Error('Agent task run fixture could not be created')
        const planningWorker = `planning-release-${taskStatus}`
        const planning = await pgRepository.claimAgentTaskTransition(
          planningWorker,
          now,
          new Date(now.getTime() + 30_000),
        )
        if (!planning?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
        const planned = await pgRepository.completeAgentTaskTransition(
          fixture.actorId,
          {
            transitionId: planning.id,
            workerId: planningWorker,
            leaseGeneration: planning.leaseGeneration,
            leaseToken: planning.leaseToken,
          },
          {
            status: 'completed',
            taskRunPatch: { status: 'running' },
            plan: {
              summary: 'Lease release plan',
              assumptions: [],
              verification: {},
              steps: [{ id: 'lease-release-step', ordinal: 1, title: 'Release lease', intent: {} }],
            },
            nextTransition: { stepOrdinal: 1, kind: 'step_action', transitionKey: `release:${taskStatus}:step` },
            now,
          },
        )
        if (typeof planned === 'string') throw new Error('Planning completion fixture could not be created')
        const second = await createAgentTaskRunFixture(
          admin,
          pgRepository,
          fixture.actorId,
          taskInput(fixture.projectId, `conversation-other-${taskStatus}`, `task-other-${taskStatus}`),
        )
        if (!second || typeof second === 'string') throw new Error('Competing task run fixture could not be created')
        const mutationWorker = `mutation-release-${taskStatus}`
        const held = await pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
          taskRunId: first.id,
          workerId: mutationWorker,
          now,
          leaseUntil: new Date(now.getTime() + 60_000),
        })
        if (!held || typeof held === 'string') throw new Error('Project lease fixture could not be acquired')
        const mutation = await pgRepository.claimAgentTaskTransition(
          mutationWorker,
          now,
          new Date(now.getTime() + 60_000),
        )
        if (!mutation?.leaseToken) throw new Error('Mutation transition fixture could not be claimed')
        const completedAt = new Date(now.getTime() + 1_000)
        const completed = await pgRepository.completeAgentTaskTransition(
          fixture.actorId,
          {
            transitionId: mutation.id,
            workerId: mutationWorker,
            leaseGeneration: mutation.leaseGeneration,
            leaseToken: mutation.leaseToken,
            projectLeaseGeneration: mutation.projectLeaseGeneration,
            projectLeaseToken: mutation.projectLeaseToken,
            projectLeaseWorkerId: mutation.projectLeaseWorkerId,
          },
          { status: 'completed', taskRunPatch: { status: taskStatus }, now: completedAt },
        )
        expect(completed).not.toBe('stale')
        expect(completed).not.toBe('invalid_state')

        const acquired = await pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
          taskRunId: second.id,
          workerId: `other-worker-${taskStatus}`,
          now: completedAt,
          leaseUntil: new Date(completedAt.getTime() + 30_000),
        })
        expect(acquired).toMatchObject({ taskRunId: second.id, leaseOwner: `other-worker-${taskStatus}` })
      } finally {
        await admin.query('delete from auth.users where id = $1', [fixture.actorId])
      }
    },
  )

  it('blocks downgrade while a task transition remains nonterminal', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun) throw new Error('Agent task repository is unavailable')
    const fixture = await seedKernelProject()
    try {
      const run = await createAgentTaskRunFixture(
        admin,
        pgRepository,
        fixture.actorId,
        taskInput(fixture.projectId, 'conversation-downgrade', 'task-downgrade'),
      )
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')

      await expect(admin.query('select app.assert_agent_task_loop_downgrade_safe()')).rejects.toMatchObject({
        code: '55000',
      })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })
})
