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
const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const pgRepository = runtimeDatabaseUrl ? createPgRepository({ DATABASE_URL: runtimeDatabaseUrl } as AppEnv) : null
const now = new Date('2026-08-04T00:00:00.000Z')
const baseSchema: ProjectSchema = {
  formatVersion: 1,
  editorSchema: { version: '1.0.0', componentsTree: [] },
  presentation: { startPageId: 'page-home', theme: { mode: 'dark', tokens: {} } },
}
const providerBounds: AgentTaskRunBounds = {
  maxProviderTurns: 2,
  maxStepRevisions: 2,
  maxExecutorRetries: 1,
  tokenLimit: 1_000,
  costLimitMicros: 1_000,
}

async function seedTransitionProviderFixture(bounds: AgentTaskRunBounds = providerBounds) {
  if (!admin || !pgRepository?.createAgentTaskRun || !pgRepository.claimAgentTaskTransition) {
    throw new Error('Agent provider transition integration database is unavailable')
  }
  const actorId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  const project = await pgRepository.createProject(actorId, { name: 'Provider transition bounds', schema: baseSchema })
  const run = await createAgentTaskRunFixture(admin, pgRepository, actorId, {
    projectId: project.id,
    conversationId: `conversation-${randomUUID()}`,
    taskId: `task-${randomUUID()}`,
    idempotencyKey: randomUUID(),
    binding: {
      provider: 'openai-compatible',
      model: 'kernel-model',
      profileId: 'profile-1',
      configDigest: 'a'.repeat(64),
    },
    bounds,
    taskStartDocumentRevision: 1,
    now,
  })
  if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
  const workerId = `provider-worker-${randomUUID()}`
  const claim = await pgRepository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 30_000))
  if (!claim?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
  return {
    actorId,
    project,
    run,
    fence: {
      kind: 'transition' as const,
      transitionId: claim.id,
      workerId,
      leaseGeneration: claim.leaseGeneration,
      leaseToken: claim.leaseToken,
    },
  }
}

async function seedMutatingTransitionProviderFixture(bounds: AgentTaskRunBounds = providerBounds) {
  if (
    !pgRepository?.completeAgentTaskTransition ||
    !pgRepository.acquireAgentProjectTaskLease ||
    !pgRepository.claimAgentTaskTransition
  ) {
    throw new Error('Agent provider transition integration database is unavailable')
  }
  const fixture = await seedTransitionProviderFixture(bounds)
  const planningCompletion = await pgRepository.completeAgentTaskTransition(fixture.actorId, fixture.fence, {
    status: 'completed',
    taskRunPatch: { status: 'running' },
    plan: {
      summary: 'Build the visible dashboard shell',
      assumptions: [],
      verification: {},
      steps: [{ id: 'recovery-step', ordinal: 1, title: 'Build the shell', intent: {} }],
    },
    nextTransition: {
      stepOrdinal: 1,
      kind: 'step_action',
      transitionKey: `recovery-step:${randomUUID()}`,
    },
    now,
  })
  if (!planningCompletion || typeof planningCompletion === 'string') {
    throw new Error('Planning transition fixture could not be completed')
  }
  const workerId = `mutating-provider-worker-${randomUUID()}`
  const leaseUntil = new Date(now.getTime() + 30_000)
  const projectLease = await pgRepository.acquireAgentProjectTaskLease(fixture.actorId, {
    taskRunId: fixture.run.id,
    workerId,
    now,
    leaseUntil,
  })
  if (!projectLease || typeof projectLease === 'string') {
    throw new Error('Mutating project lease fixture could not be acquired')
  }
  const claim = await pgRepository.claimAgentTaskTransition(workerId, now, leaseUntil)
  if (!claim?.leaseToken || !claim.projectLeaseToken || claim.projectLeaseGeneration === null) {
    throw new Error('Mutating transition fixture could not be claimed')
  }
  return {
    ...fixture,
    transition: claim,
    fence: {
      kind: 'transition' as const,
      transitionId: claim.id,
      workerId,
      leaseGeneration: claim.leaseGeneration,
      leaseToken: claim.leaseToken,
      projectLeaseGeneration: claim.projectLeaseGeneration,
      projectLeaseToken: claim.projectLeaseToken,
      projectLeaseWorkerId: claim.projectLeaseWorkerId,
    },
  }
}

async function seedSucceededPlanningProviderResult(
  decisionUsage: Record<string, unknown> | null = { promptTokens: 20, completionTokens: 10 },
) {
  if (
    !pgRepository?.prepareAgentProviderAttempt ||
    !pgRepository.markAgentProviderAttemptStarted ||
    !pgRepository.completeAgentProviderAttempt
  ) {
    throw new Error('Agent provider result repository is unavailable')
  }
  const fixture = await seedTransitionProviderFixture()
  const providerInput = {
    projectId: fixture.project.id,
    taskId: fixture.run.taskId,
    turnId: `planning-result-${randomUUID()}`,
    providerRequestKey: `provider-result-${randomUUID()}`,
    requestBodyDigest: 'd'.repeat(64),
    idempotencyMode: 'stable' as const,
    reservedMicros: 100,
    now,
  }
  const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
  if (typeof prepared === 'string') throw new Error('Provider result attempt could not be prepared')
  const started = await pgRepository.markAgentProviderAttemptStarted(fixture.actorId, prepared.id, fixture.fence, now)
  if (!started) throw new Error('Provider result attempt could not be started')
  const decisionOutput = { purpose: 'planning', output: { action: 'execute', summary: 'Persisted decision' } }
  const decisionTrace = { traceId: 'planning-trace-1', provider: 'openai-compatible' }
  const completed = await pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, {
    state: 'succeeded',
    providerAttempt: {
      providerRequestKey: providerInput.providerRequestKey,
      requestBodyDigest: providerInput.requestBodyDigest,
      idempotencyMode: providerInput.idempotencyMode,
      idempotencyHeaderSent: true,
    },
    decisionOutput,
    decisionUsage,
    decisionTrace,
    promptTokens: 20,
    completionTokens: 10,
    estimatedMicros: 100,
    now,
  })
  if (completed === 'stale') throw new Error('Provider result attempt could not be completed')
  return { ...fixture, attemptId: prepared.id, decisionOutput, decisionUsage, decisionTrace }
}

async function seedPlanningProviderAttemptState(state: 'prepared' | 'started' | 'failed_definite' | 'outcome_unknown') {
  if (
    !pgRepository?.prepareAgentProviderAttempt ||
    !pgRepository.markAgentProviderAttemptStarted ||
    !pgRepository.completeAgentProviderAttempt
  ) {
    throw new Error('Agent provider result repository is unavailable')
  }
  const fixture = await seedTransitionProviderFixture()
  const providerInput = {
    projectId: fixture.project.id,
    taskId: fixture.run.taskId,
    turnId: `planning-state-${randomUUID()}`,
    providerRequestKey: `provider-state-${randomUUID()}`,
    requestBodyDigest: 'f'.repeat(64),
    idempotencyMode: 'stable' as const,
    reservedMicros: 100,
    now,
  }
  const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
  if (typeof prepared === 'string') throw new Error('Provider state attempt could not be prepared')
  if (state === 'prepared') return fixture
  const started = await pgRepository.markAgentProviderAttemptStarted(fixture.actorId, prepared.id, fixture.fence, now)
  if (!started) throw new Error('Provider state attempt could not be started')
  if (state === 'started') return fixture
  const completed = await pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, {
    state,
    providerAttempt: {
      providerRequestKey: providerInput.providerRequestKey,
      requestBodyDigest: providerInput.requestBodyDigest,
      idempotencyMode: providerInput.idempotencyMode,
      idempotencyHeaderSent: true,
      reason: `test_${state}`,
    },
    promptTokens: 20,
    completionTokens: 10,
    estimatedMicros: 100,
    now,
  })
  if (completed === 'stale') throw new Error('Provider state attempt could not be completed')
  return fixture
}

async function snapshotTransitionUnknownOutcome(taskRunId: string, transitionId: string, attemptId: string) {
  if (!admin) throw new Error('Agent provider transition integration database is unavailable')
  const result = await admin.query<{
    status: string
    current_transition_key: string | null
    provider_turns: number
    prompt_tokens: number
    completion_tokens: number
    cost_micros: number
    transition_status: string
    transition_generation: number
    attempt_state: string
    attempt_accuracy: string
    attempt_reserved_micros: number
    attempt_amount_micros: number
    attempt_prompt_tokens: number | null
    attempt_completion_tokens: number | null
    project_lease_generation: number
    project_lease_token: string
    project_lease_owner: string
    project_lease_until: Date
    public_events: number
    operational_events: number
    attempts: number
  }>(
    `select run.status, run.current_transition_key, run.provider_turns, run.prompt_tokens,
      run.completion_tokens, run.cost_micros,
      transition.status as transition_status, transition.lease_generation as transition_generation,
      attempt.state as attempt_state, attempt.cost_accuracy as attempt_accuracy,
      attempt.reservation_delta_micros as attempt_reserved_micros,
      attempt.amount_micros as attempt_amount_micros,
      attempt.prompt_tokens as attempt_prompt_tokens,
      attempt.completion_tokens as attempt_completion_tokens,
      project_lease.lease_generation as project_lease_generation,
      project_lease.lease_token as project_lease_token,
      project_lease.lease_owner as project_lease_owner,
      project_lease.lease_until as project_lease_until,
      (select count(*)::int from app.agent_task_events where task_run_id=run.id
        and event_key='provider-outcome-unknown:'||transition.id) as public_events,
      (select count(*)::int from app.agent_task_operational_events where task_run_id=run.id
        and dedupe_key='provider-outcome-unknown:'||transition.id) as operational_events,
      (select count(*)::int from app.agent_provider_attempts
        where task_transition_id=transition.id) as attempts
     from app.agent_task_runs run
     join app.agent_task_transitions transition on transition.id=$2
     join app.agent_provider_attempts attempt on attempt.id=$3
     join app.agent_project_task_leases project_lease on project_lease.project_id=run.project_id
     where run.id=$1`,
    [taskRunId, transitionId, attemptId],
  )
  return result.rows[0]!
}

describe('Agent provider attempt repository accounting', () => {
  it('stores prompt, completion, and cached tokens in their separate columns', () => {
    const completion = repository.slice(
      repository.indexOf('completeAgentProviderAttempt(actorId'),
      repository.indexOf('reconcileAgentProviderAttempt:'),
    )
    expect(completion).toContain('promptTokens: input.promptTokens ?? null')
    expect(completion).toContain('completionTokens: input.completionTokens ?? null')
    expect(completion).toContain('cachedTokens: input.cachedTokens ?? null')
    expect(completion).toContain('durationMs: input.providerAttempt.durationMs ?? null')
    expect(completion).not.toContain('promptTokens: input.observedTokens')
  })

  it('always scopes task-budget aggregation by actor, project, and task', () => {
    const sections = [
      repository.slice(repository.indexOf('enqueueAgentTurn(actorId'), repository.indexOf('getAgentTurnByDispatch')),
      repository.slice(
        repository.indexOf('prepareAgentProviderAttempt(actorId'),
        repository.indexOf('markAgentProviderAttemptStarted'),
      ),
      repository.slice(repository.indexOf('respondToAgentTask(actorId'), repository.indexOf('getAgentRunDispatch(')),
      repository.slice(
        repository.indexOf('async reserveAgentRunCost(actorId'),
        repository.indexOf('async settleAgentRunCost'),
      ),
    ]
    for (const section of sections) {
      const taskUsage = section.slice(section.indexOf('taskMicros:'), section.indexOf('projectMonthMicros:'))
      expect(taskUsage).toContain('${agentRunCosts.actorId} = ${actorId}')
      expect(taskUsage).toContain('${agentRunCosts.projectId} = ${input.projectId}')
      expect(taskUsage).toContain('${agentRunCosts.taskId} = ${input.taskId}')
    }
  })
})

describe('Agent provider attempt dual-parent fencing', () => {
  it('defines an explicit dispatch-or-transition fence union', () => {
    const types = readFileSync(new URL('../types.ts', import.meta.url), 'utf8')

    expect(types).toContain('DispatchProviderAttemptFence')
    expect(types).toContain('TransitionProviderAttemptFence')
    expect(types).toMatch(/DispatchProviderAttemptFence\s*\|\s*TransitionProviderAttemptFence/)
  })

  it('prepares transition-owned attempts without fabricating an operation dispatch', () => {
    const prepare = repository.slice(
      repository.indexOf('prepareAgentProviderAttempt(actorId'),
      repository.indexOf('markAgentProviderAttemptStarted'),
    )

    expect(prepare).toMatch(/taskTransitionId|task_transition_id/)
    expect(prepare).toMatch(/transitionLeaseGeneration|transition_lease_generation/)
    expect(prepare).toMatch(/transitionLeaseToken|transition_lease_token/)
    expect(prepare).toMatch(/transitionWorkerId|transition_worker_id/)
  })

  it.each([
    ['start', 'markAgentProviderAttemptStarted', 'completeAgentProviderAttempt'],
    ['settle or fail', 'completeAgentProviderAttempt', 'reconcileAgentProviderAttempt'],
  ])(
    'matches transition parent, generation, token, worker, lease, and state when attempting to %s',
    (_label, start, end) => {
      const source = repository.slice(repository.indexOf(`${start}(`), repository.indexOf(`${end}(`))

      expect(source).toMatch(/taskTransitionId|task_transition_id/)
      expect(source).toMatch(/transitionLeaseGeneration|transition_lease_generation/)
      expect(source).toMatch(/transitionLeaseToken|transition_lease_token/)
      expect(source).toMatch(/transitionWorkerId|transition_worker_id/)
      expect(source).toMatch(/leaseUntil|lease_until/)
      expect(source).toMatch(/state/)
    },
  )

  it('keeps the existing stable stale-settlement outcome for a mismatched transition fence', () => {
    const complete = repository.slice(
      repository.indexOf('completeAgentProviderAttempt(actorId'),
      repository.indexOf('reconcileAgentProviderAttempt:'),
    )

    expect(complete).toContain("'stale'")
  })

  it('classifies a restarted started transition attempt as outcome unknown instead of allocating another attempt', () => {
    const reconcileStart = repository.indexOf('reconcileAgentProviderAttempt:')
    const reconcile = repository.slice(reconcileStart, reconcileStart + 9000)

    expect(reconcileStart).toBeGreaterThan(-1)
    expect(reconcile).toContain('outcome_unknown')
    expect(reconcile).toMatch(/started/)
  })

  it('checks transition task hard bounds before preparing a provider attempt', () => {
    const prepare = repository.slice(
      repository.indexOf('prepareAgentProviderAttempt(actorId'),
      repository.indexOf('markAgentProviderAttemptStarted'),
    )

    expect(prepare).toMatch(/maxProviderTurns/)
    expect(prepare).toMatch(/costLimitMicros/)
    expect(prepare).toContain('task_budget_exceeded')
  })

  it('classifies actual transition provider overage as paused after truthful settlement', () => {
    const complete = repository.slice(
      repository.indexOf('completeAgentProviderAttempt(actorId'),
      repository.indexOf('reconcileAgentProviderAttempt:'),
    )

    expect(complete).toContain('task_budget_exceeded_paused')
    expect(complete).toMatch(/agentTaskRuns|agent_task_runs/)
    expect(complete).toMatch(/agentTaskEvents|agent_task_events/)
    expect(complete).toMatch(/agentTaskOperationalEvents|agent_task_operational_events/)
  })

  it('accounts a definite provider failure only when the attempt was started', () => {
    const complete = repository.slice(
      repository.indexOf('completeAgentProviderAttempt(actorId'),
      repository.indexOf('reconcileAgentProviderAttempt:'),
    )

    expect(complete).toMatch(/attempt\.state\s*===\s*['"]started['"]/)
    expect(complete).toContain("input.state === 'failed_definite'")
    expect(complete).toMatch(/providerTurns:\s*nextProviderTurns/)
    expect(complete).toMatch(/promptTokens:\s*nextPromptTokens/)
    expect(complete).toMatch(/completionTokens:\s*nextCompletionTokens/)
    expect(complete).toMatch(/costMicros:\s*nextCostMicros/)
  })

  it('rejects a prior transition outcome-unknown attempt before validating a newer lease generation', () => {
    const prepare = repository.slice(
      repository.indexOf('prepareAgentProviderAttempt(actorId'),
      repository.indexOf('markAgentProviderAttemptStarted'),
    )
    const priorUnknown = prepare.indexOf("eq(agentProviderAttempts.state, 'outcome_unknown')")
    const generationFence = prepare.indexOf('eq(agentTaskTransitions.leaseGeneration')

    expect(priorUnknown).toBeGreaterThan(-1)
    expect(generationFence).toBeGreaterThan(-1)
    expect(priorUnknown).toBeLessThan(generationFence)
    expect(prepare.slice(priorUnknown, generationFence)).toContain("return 'outcome_unknown'")
  })

  it('routes direct and already-persisted transition outcome-unknown settlement through the atomic pause helper', () => {
    const completeStart = repository.indexOf('completeAgentProviderAttempt(actorId')
    const reconcileStart = repository.indexOf('reconcileAgentProviderAttempt:', completeStart)
    const complete = repository.slice(completeStart, reconcileStart)

    expect(completeStart).toBeGreaterThan(-1)
    expect(reconcileStart).toBeGreaterThan(completeStart)
    expect(complete).toMatch(
      /attempt\.state\s*===\s*['"]outcome_unknown['"][\s\S]{0,1600}pauseTransitionForUnknownProviderOutcome/,
    )
    expect(complete).toMatch(
      /input\.state\s*===\s*['"]outcome_unknown['"][\s\S]{0,2400}pauseTransitionForUnknownProviderOutcome/,
    )
  })

  it('checkpoints and reads only a complete latest succeeded transition provider result', () => {
    expect(repository).toContain('getAgentTaskTransitionProviderResult(')
    const readStart = repository.indexOf('getAgentTaskTransitionProviderResult(')
    const read = repository.slice(readStart, repository.indexOf('enqueueAgentTaskTransition(', readStart))

    expect(read).toMatch(/orderBy\(desc\(agentProviderAttempts\.attemptNo\)\)/)
    expect(read).toContain("latestAttempt.state !== 'succeeded'")
    expect(read).toMatch(/decisionOutput/)
    expect(read).toMatch(/decisionUsage/)
    expect(read).toMatch(/decisionTrace/)
    expect(read).not.toMatch(/requestBody|inputSnapshot|systemPrompt|userText/)
  })
})

describeWithDatabase('Agent provider attempt transition fence PostgreSQL integration', () => {
  afterAll(async () => admin?.end())

  it('replays a complete persisted succeeded provider result without exposing request input', async () => {
    if (!admin || !pgRepository?.getAgentTaskTransitionProviderResult) {
      throw new Error('Agent provider result repository is unavailable')
    }
    const fixture = await seedSucceededPlanningProviderResult()
    try {
      const result = await pgRepository.getAgentTaskTransitionProviderResult(
        fixture.actorId,
        fixture.run.id,
        fixture.fence.transitionId,
      )

      expect(result).toEqual({
        attemptId: fixture.attemptId,
        decisionOutput: fixture.decisionOutput,
        decisionUsage: fixture.decisionUsage,
        decisionTrace: fixture.decisionTrace,
      })
      expect(JSON.stringify(result)).not.toMatch(/requestBodyDigest|providerRequestKey|systemPrompt|userText/)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('replays a succeeded provider result with explicitly unavailable usage', async () => {
    if (!admin || !pgRepository?.getAgentTaskTransitionProviderResult) {
      throw new Error('Agent provider result repository is unavailable')
    }
    const fixture = await seedSucceededPlanningProviderResult(null)
    try {
      await expect(
        pgRepository.getAgentTaskTransitionProviderResult(fixture.actorId, fixture.run.id, fixture.fence.transitionId),
      ).resolves.toMatchObject({ attemptId: fixture.attemptId, decisionUsage: null })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it.each(['prepared', 'started', 'failed_definite', 'outcome_unknown'] as const)(
    'does not replay a %s latest provider attempt',
    async state => {
      if (!admin || !pgRepository?.getAgentTaskTransitionProviderResult) {
        throw new Error('Agent provider result repository is unavailable')
      }
      const fixture = await seedPlanningProviderAttemptState(state)
      try {
        await expect(
          pgRepository.getAgentTaskTransitionProviderResult(
            fixture.actorId,
            fixture.run.id,
            fixture.fence.transitionId,
          ),
        ).resolves.toBeNull()
      } finally {
        await admin.query('delete from auth.users where id = $1', [fixture.actorId])
      }
    },
  )

  it('does not replay across an actor or task-run boundary', async () => {
    if (!admin || !pgRepository?.getAgentTaskTransitionProviderResult) {
      throw new Error('Agent provider result repository is unavailable')
    }
    const fixture = await seedSucceededPlanningProviderResult()
    const otherActorId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1)', [otherActorId])
    try {
      await expect(
        pgRepository.getAgentTaskTransitionProviderResult(otherActorId, fixture.run.id, fixture.fence.transitionId),
      ).resolves.toBeNull()
      await expect(
        pgRepository.getAgentTaskTransitionProviderResult(fixture.actorId, randomUUID(), fixture.fence.transitionId),
      ).resolves.toBeNull()
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [fixture.actorId, otherActorId])
    }
  })

  it('does not return an older success when a newer attempt is non-succeeded', async () => {
    if (!admin || !pgRepository?.getAgentTaskTransitionProviderResult) {
      throw new Error('Agent provider result repository is unavailable')
    }
    const fixture = await seedSucceededPlanningProviderResult()
    try {
      await admin.query(
        `insert into app.agent_provider_attempts (
          actor_id, project_id, task_transition_id, transition_lease_generation,
          transition_lease_token, transition_worker_id, attempt_no, request_body_digest,
          state, reservation_delta_micros, prepared_at, completed_at, created_at, updated_at
        ) select actor_id, project_id, task_transition_id, transition_lease_generation,
          transition_lease_token, transition_worker_id, attempt_no + 1, $2,
          'failed_definite', 0, $3, $3, $3, $3
        from app.agent_provider_attempts where id=$1`,
        [fixture.attemptId, 'e'.repeat(64), new Date(now.getTime() + 1)],
      )

      await expect(
        pgRepository.getAgentTaskTransitionProviderResult(fixture.actorId, fixture.run.id, fixture.fence.transitionId),
      ).resolves.toBeNull()
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('persists a transition-owned attempt with no fabricated dispatch parent and rejects a stale token', async () => {
    if (
      !admin ||
      !pgRepository?.createAgentTaskRun ||
      !pgRepository.claimAgentTaskTransition ||
      !pgRepository.prepareAgentProviderAttempt
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const actorId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1)', [actorId])
    try {
      const project = await pgRepository.createProject(actorId, {
        name: 'Provider transition fence',
        schema: baseSchema,
      })
      const run = await createAgentTaskRunFixture(admin, pgRepository, actorId, {
        projectId: project.id,
        conversationId: 'conversation-provider-fence',
        taskId: 'task-provider-fence',
        idempotencyKey: randomUUID(),
        binding: {
          provider: 'openai-compatible',
          model: 'kernel-model',
          profileId: 'profile-1',
          configDigest: 'a'.repeat(64),
        },
        bounds: {
          maxProviderTurns: 12,
          maxStepRevisions: 2,
          maxExecutorRetries: 1,
          tokenLimit: 40_000,
          costLimitMicros: 2_000_000,
        },
        taskStartDocumentRevision: 1,
        now,
      })
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const claimed = await pgRepository.claimAgentTaskTransition(
        'provider-worker',
        now,
        new Date(now.getTime() + 30_000),
      )
      if (!claimed) throw new Error('Planning transition fixture could not be claimed')
      const fence = {
        kind: 'transition' as const,
        transitionId: claimed.id,
        workerId: 'provider-worker',
        leaseGeneration: claimed.leaseGeneration,
        leaseToken: claimed.leaseToken!,
      }
      const input = {
        projectId: project.id,
        taskId: run.taskId,
        turnId: 'planning-turn-1',
        providerRequestKey: 'planning-request-1',
        requestBodyDigest: 'b'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 500,
        now,
      }

      const prepared = await pgRepository.prepareAgentProviderAttempt(actorId, fence, input)
      expect(prepared).toMatchObject({ state: 'prepared' })
      const persisted = await admin.query<{
        dispatch_id: string | null
        task_transition_id: string
        transition_lease_generation: number
        transition_lease_token: string
        transition_worker_id: string
      }>(
        `select dispatch_id, task_transition_id, transition_lease_generation,
          transition_lease_token, transition_worker_id
         from app.agent_provider_attempts where task_transition_id = $1`,
        [claimed.id],
      )
      expect(persisted.rows[0]).toEqual({
        dispatch_id: null,
        task_transition_id: claimed.id,
        transition_lease_generation: claimed.leaseGeneration,
        transition_lease_token: claimed.leaseToken,
        transition_worker_id: 'provider-worker',
      })
      await expect(
        pgRepository.prepareAgentProviderAttempt(actorId, { ...fence, leaseToken: randomUUID() }, input),
      ).resolves.toBe('stale')
    } finally {
      await admin.query('delete from auth.users where id = $1', [actorId])
    }
  })

  it('pauses an expired started transition attempt once and never requeues or prepares it again', async () => {
    if (
      !admin ||
      !pgRepository?.prepareAgentProviderAttempt ||
      !pgRepository.markAgentProviderAttemptStarted ||
      !pgRepository.reconcileAgentProviderAttempt ||
      !pgRepository.reconcileAgentTaskTransition ||
      !pgRepository.claimAgentTaskTransition
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedMutatingTransitionProviderFixture()
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'expired-started-recovery-turn',
        providerRequestKey: 'expired-started-recovery-request',
        requestBodyDigest: '3'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 250,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      const started = await pgRepository.markAgentProviderAttemptStarted(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        now,
      )
      if (!started) throw new Error('Provider attempt fixture could not be started')
      const expiredAt = new Date(now.getTime() + 31_000)

      const providerRecovery = await pgRepository.reconcileAgentProviderAttempt(
        fixture.actorId,
        fixture.fence,
        expiredAt,
      )
      expect(providerRecovery).toMatchObject({
        classification: 'started_outcome_unknown',
        attempt: { id: prepared.id, state: 'outcome_unknown' },
      })
      const taskRecovery = await pgRepository.reconcileAgentTaskTransition(fixture.actorId, fixture.fence, expiredAt)
      expect(taskRecovery).toMatchObject({
        classification: 'provider_outcome_unknown_paused',
        transition: { id: fixture.transition.id, status: 'failed', leaseGeneration: fixture.fence.leaseGeneration },
      })

      const snapshot = () =>
        admin.query<{
          status: string
          current_transition_key: string | null
          transition_status: string
          provider_turns: number
          prompt_tokens: number
          completion_tokens: number
          cost_micros: number
          transition_generation: number
          attempt_state: string
          attempt_accuracy: string
          attempt_reserved_micros: number
          attempt_amount_micros: number
          attempt_prompt_tokens: number | null
          attempt_completion_tokens: number | null
          project_lease_generation: number
          project_lease_token: string
          project_lease_owner: string
          project_lease_until: Date
          public_events: number
          operational_events: number
          attempts: number
        }>(
          `select run.status, run.current_transition_key, run.provider_turns, run.prompt_tokens,
            run.completion_tokens, run.cost_micros,
            transition.status as transition_status, transition.lease_generation as transition_generation,
            attempt.state as attempt_state, attempt.cost_accuracy as attempt_accuracy,
            attempt.reservation_delta_micros as attempt_reserved_micros,
            attempt.amount_micros as attempt_amount_micros,
            attempt.prompt_tokens as attempt_prompt_tokens,
            attempt.completion_tokens as attempt_completion_tokens,
            project_lease.lease_generation as project_lease_generation,
            project_lease.lease_token as project_lease_token,
            project_lease.lease_owner as project_lease_owner,
            project_lease.lease_until as project_lease_until,
            (select count(*)::int from app.agent_task_events where task_run_id=run.id
              and event_key='provider-outcome-unknown:'||transition.id) as public_events,
            (select count(*)::int from app.agent_task_operational_events where task_run_id=run.id
              and dedupe_key='provider-outcome-unknown:'||transition.id) as operational_events,
            (select count(*)::int from app.agent_provider_attempts
              where task_transition_id=transition.id) as attempts
           from app.agent_task_runs run
           join app.agent_task_transitions transition on transition.id=$2
           join app.agent_provider_attempts attempt on attempt.id=$3
           join app.agent_project_task_leases project_lease on project_lease.project_id=run.project_id
           where run.id=$1`,
          [fixture.run.id, fixture.transition.id, prepared.id],
        )
      const expected = {
        status: 'paused',
        current_transition_key: null,
        provider_turns: 1,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_micros: 250,
        transition_status: 'failed',
        transition_generation: fixture.fence.leaseGeneration,
        attempt_state: 'outcome_unknown',
        attempt_accuracy: 'billing_indeterminate',
        attempt_reserved_micros: 250,
        attempt_amount_micros: 250,
        attempt_prompt_tokens: null,
        attempt_completion_tokens: null,
        project_lease_generation: fixture.fence.projectLeaseGeneration,
        project_lease_token: fixture.fence.projectLeaseToken,
        project_lease_owner: fixture.fence.projectLeaseWorkerId,
        project_lease_until: expiredAt,
        public_events: 1,
        operational_events: 1,
        attempts: 1,
      }
      expect((await snapshot()).rows[0]).toEqual(expected)

      await expect(
        pgRepository.reconcileAgentProviderAttempt(fixture.actorId, fixture.fence, expiredAt),
      ).resolves.toMatchObject({ classification: 'started_outcome_unknown', attempt: { id: prepared.id } })
      await expect(
        pgRepository.reconcileAgentTaskTransition(fixture.actorId, fixture.fence, expiredAt),
      ).resolves.toMatchObject({ classification: 'provider_outcome_unknown_paused' })
      await expect(
        pgRepository.claimAgentTaskTransition!(
          'recovery-reclaim-worker',
          new Date(expiredAt.getTime() + 1),
          new Date(expiredAt.getTime() + 30_001),
        ),
      ).resolves.toBeNull()

      const newerFence = {
        ...fixture.fence,
        workerId: 'recovery-reclaim-worker',
        leaseGeneration: fixture.fence.leaseGeneration + 1,
        leaseToken: randomUUID(),
        projectLeaseGeneration: fixture.fence.projectLeaseGeneration + 1,
        projectLeaseToken: randomUUID(),
        projectLeaseWorkerId: 'recovery-reclaim-worker',
      }
      await expect(
        pgRepository.prepareAgentProviderAttempt(fixture.actorId, newerFence, {
          ...providerInput,
          turnId: 'forbidden-reprepare-turn',
          providerRequestKey: 'forbidden-reprepare-request',
          requestBodyDigest: '4'.repeat(64),
          now: new Date(expiredAt.getTime() + 1),
        }),
      ).resolves.toBe('outcome_unknown')
      expect((await snapshot()).rows[0]).toEqual(expected)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('atomically pauses direct transition outcome-unknown settlement across every recovery replay', async () => {
    if (
      !admin ||
      !pgRepository?.prepareAgentProviderAttempt ||
      !pgRepository.markAgentProviderAttemptStarted ||
      !pgRepository.completeAgentProviderAttempt ||
      !pgRepository.pauseAgentTaskTransitionUnknownOutcome ||
      !pgRepository.reconcileAgentProviderAttempt ||
      !pgRepository.reconcileAgentTaskTransition ||
      !pgRepository.reconcileAgentTaskTransitions ||
      !pgRepository.claimAgentTaskTransition
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedMutatingTransitionProviderFixture()
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'direct-outcome-unknown-turn',
        providerRequestKey: 'direct-outcome-unknown-request',
        requestBodyDigest: '5'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 250,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      const started = await pgRepository.markAgentProviderAttemptStarted(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        now,
      )
      if (!started) throw new Error('Provider attempt fixture could not be started')
      const completion = {
        state: 'outcome_unknown' as const,
        providerAttempt: {
          providerRequestKey: providerInput.providerRequestKey,
          requestBodyDigest: providerInput.requestBodyDigest,
          idempotencyMode: providerInput.idempotencyMode,
          idempotencyHeaderSent: true,
          reason: 'response_lost_after_send',
        },
        promptTokens: 80,
        completionTokens: 30,
        estimatedMicros: 250,
        now,
      }

      const first = await pgRepository.completeAgentProviderAttempt(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        completion,
      )
      expect(first).toMatchObject({
        taskOutcomeClassification: 'provider_outcome_unknown_paused',
        attempt: { id: prepared.id, state: 'outcome_unknown' },
      })
      const expected = {
        status: 'paused',
        current_transition_key: null,
        provider_turns: 1,
        prompt_tokens: 80,
        completion_tokens: 30,
        cost_micros: 250,
        transition_status: 'failed',
        transition_generation: fixture.fence.leaseGeneration,
        attempt_state: 'outcome_unknown',
        attempt_accuracy: 'billing_indeterminate',
        attempt_reserved_micros: 250,
        attempt_amount_micros: 250,
        attempt_prompt_tokens: 80,
        attempt_completion_tokens: 30,
        project_lease_generation: fixture.fence.projectLeaseGeneration,
        project_lease_token: fixture.fence.projectLeaseToken,
        project_lease_owner: fixture.fence.projectLeaseWorkerId,
        project_lease_until: now,
        public_events: 1,
        operational_events: 1,
        attempts: 1,
      }
      expect(await snapshotTransitionUnknownOutcome(fixture.run.id, fixture.transition.id, prepared.id)).toEqual(
        expected,
      )

      await expect(
        pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, completion),
      ).resolves.toMatchObject({ taskOutcomeClassification: 'provider_outcome_unknown_paused' })
      const eventKey = `provider-outcome-unknown:${fixture.transition.id}`
      await expect(
        pgRepository.pauseAgentTaskTransitionUnknownOutcome(fixture.actorId, fixture.fence, {
          now,
          event: {
            eventKey,
            type: 'waiting_user',
            summary: 'Execution paused because the provider outcome could not be confirmed.',
            publicPayload: { state: 'paused', reason: 'provider_outcome_unknown' },
            technicalPayload: { providerAttemptId: prepared.id, transitionId: fixture.transition.id },
          },
          operationalEvent: {
            dedupeKey: eventKey,
            code: 'agent_task_provider_outcome_unknown',
            severity: 'critical',
            details: { providerAttemptId: prepared.id },
          },
        }),
      ).resolves.toMatchObject({ classification: 'provider_outcome_unknown_paused' })
      await expect(
        pgRepository.reconcileAgentProviderAttempt(fixture.actorId, fixture.fence, now),
      ).resolves.toMatchObject({ classification: 'started_outcome_unknown', attempt: { id: prepared.id } })
      await expect(
        pgRepository.reconcileAgentTaskTransition(fixture.actorId, fixture.fence, now),
      ).resolves.toMatchObject({ classification: 'provider_outcome_unknown_paused' })
      await expect(pgRepository.reconcileAgentTaskTransitions(now)).resolves.toEqual([])
      await expect(
        pgRepository.claimAgentTaskTransition('direct-unknown-reclaim-worker', now, new Date(now.getTime() + 30_000)),
      ).resolves.toBeNull()

      const newerFence = {
        ...fixture.fence,
        workerId: 'direct-unknown-reclaim-worker',
        leaseGeneration: fixture.fence.leaseGeneration + 1,
        leaseToken: randomUUID(),
        projectLeaseGeneration: fixture.fence.projectLeaseGeneration + 1,
        projectLeaseToken: randomUUID(),
        projectLeaseWorkerId: 'direct-unknown-reclaim-worker',
      }
      await expect(
        pgRepository.prepareAgentProviderAttempt(fixture.actorId, newerFence, {
          ...providerInput,
          turnId: 'direct-unknown-forbidden-reprepare-turn',
          providerRequestKey: 'direct-unknown-forbidden-reprepare-request',
          requestBodyDigest: '6'.repeat(64),
        }),
      ).resolves.toBe('outcome_unknown')
      expect(await snapshotTransitionUnknownOutcome(fixture.run.id, fixture.transition.id, prepared.id)).toEqual(
        expected,
      )
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('repairs an already-persisted transition outcome unknown without double accounting', async () => {
    if (
      !admin ||
      !pgRepository?.prepareAgentProviderAttempt ||
      !pgRepository.markAgentProviderAttemptStarted ||
      !pgRepository.completeAgentProviderAttempt
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedMutatingTransitionProviderFixture()
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'persisted-outcome-unknown-turn',
        providerRequestKey: 'persisted-outcome-unknown-request',
        requestBodyDigest: '7'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 250,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      const started = await pgRepository.markAgentProviderAttemptStarted(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        now,
      )
      if (!started) throw new Error('Provider attempt fixture could not be started')
      await admin.query(
        `update app.agent_provider_attempts
         set state='outcome_unknown', cost_accuracy='billing_indeterminate', amount_micros=250,
           minimum_micros=0, maximum_micros=250, prompt_tokens=10, completion_tokens=5,
           error_code='migration_era_unknown', completed_at=$2, updated_at=$2
         where id=$1`,
        [prepared.id, now],
      )
      await admin.query(
        `update app.agent_task_runs
         set provider_turns=1, prompt_tokens=10, completion_tokens=5, cost_micros=250, updated_at=$2
         where id=$1`,
        [fixture.run.id, now],
      )
      const completion = {
        state: 'outcome_unknown' as const,
        providerAttempt: {
          providerRequestKey: providerInput.providerRequestKey,
          requestBodyDigest: providerInput.requestBodyDigest,
          idempotencyMode: providerInput.idempotencyMode,
          idempotencyHeaderSent: true,
          reason: 'migration_era_unknown',
        },
        promptTokens: 10,
        completionTokens: 5,
        estimatedMicros: 250,
        now,
      }

      await expect(
        pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, completion),
      ).resolves.toMatchObject({ taskOutcomeClassification: 'provider_outcome_unknown_paused' })
      const expected = {
        status: 'paused',
        current_transition_key: null,
        provider_turns: 1,
        prompt_tokens: 10,
        completion_tokens: 5,
        cost_micros: 250,
        transition_status: 'failed',
        transition_generation: fixture.fence.leaseGeneration,
        attempt_state: 'outcome_unknown',
        attempt_accuracy: 'billing_indeterminate',
        attempt_reserved_micros: 250,
        attempt_amount_micros: 250,
        attempt_prompt_tokens: 10,
        attempt_completion_tokens: 5,
        project_lease_generation: fixture.fence.projectLeaseGeneration,
        project_lease_token: fixture.fence.projectLeaseToken,
        project_lease_owner: fixture.fence.projectLeaseWorkerId,
        project_lease_until: now,
        public_events: 1,
        operational_events: 1,
        attempts: 1,
      }
      expect(await snapshotTransitionUnknownOutcome(fixture.run.id, fixture.transition.id, prepared.id)).toEqual(
        expected,
      )

      await expect(
        pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, completion),
      ).resolves.toMatchObject({ taskOutcomeClassification: 'provider_outcome_unknown_paused' })
      expect(await snapshotTransitionUnknownOutcome(fixture.run.id, fixture.transition.id, prepared.id)).toEqual(
        expected,
      )
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('rejects provider preparation after the task provider-turn hard bound is exhausted', async () => {
    if (!admin || !pgRepository?.prepareAgentProviderAttempt) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedTransitionProviderFixture()
    try {
      await admin.query('update app.agent_task_runs set provider_turns=$2 where id=$1', [
        fixture.run.id,
        providerBounds.maxProviderTurns,
      ])

      await expect(
        pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, {
          projectId: fixture.project.id,
          taskId: fixture.run.taskId,
          turnId: 'hard-bound-turn',
          providerRequestKey: 'hard-bound-request',
          requestBodyDigest: 'c'.repeat(64),
          idempotencyMode: 'stable',
          reservedMicros: 0,
          now,
        }),
      ).resolves.toBe('task_budget_exceeded')
      const transition = await admin.query<{ status: string; error_json: { code?: string } | null }>(
        'select status, error_json from app.agent_task_transitions where id=$1',
        [fixture.fence.transitionId],
      )
      expect(transition.rows[0]).toEqual({
        status: 'failed',
        error_json: { code: 'task_budget_exceeded' },
      })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('rejects provider preparation whose reservation exceeds the remaining task cost bound', async () => {
    if (!admin || !pgRepository?.prepareAgentProviderAttempt) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedTransitionProviderFixture()
    try {
      await admin.query('update app.agent_task_runs set cost_micros=$2 where id=$1', [fixture.run.id, 900])

      await expect(
        pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, {
          projectId: fixture.project.id,
          taskId: fixture.run.taskId,
          turnId: 'cost-bound-turn',
          providerRequestKey: 'cost-bound-request',
          requestBodyDigest: 'd'.repeat(64),
          idempotencyMode: 'stable',
          reservedMicros: 101,
          now,
        }),
      ).resolves.toBe('task_budget_exceeded')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('counts a started definite failure once with truthful known usage and pauses on actual overage', async () => {
    if (
      !admin ||
      !pgRepository?.prepareAgentProviderAttempt ||
      !pgRepository.markAgentProviderAttemptStarted ||
      !pgRepository.completeAgentProviderAttempt
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedTransitionProviderFixture({
      ...providerBounds,
      maxProviderTurns: 1,
      tokenLimit: 100,
      costLimitMicros: 100,
    })
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'started-definite-failure-turn',
        providerRequestKey: 'started-definite-failure-request',
        requestBodyDigest: 'f'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 10,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      const started = await pgRepository.markAgentProviderAttemptStarted(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        now,
      )
      if (!started) throw new Error('Provider attempt fixture could not be started')
      const completion = {
        state: 'failed_definite' as const,
        providerAttempt: {
          providerRequestKey: providerInput.providerRequestKey,
          requestBodyDigest: providerInput.requestBodyDigest,
          idempotencyMode: providerInput.idempotencyMode,
          idempotencyHeaderSent: true,
          reason: 'upstream_rejected_after_start',
        },
        promptTokens: 80,
        completionTokens: 30,
        providerAmountMicros: 150,
        now,
      }
      const snapshot = () =>
        admin.query<{
          status: string
          current_transition_key: string | null
          transition_status: string
          provider_turns: number
          prompt_tokens: number
          completion_tokens: number
          cost_micros: number
          attempt_state: string
          attempt_accuracy: string
          attempt_amount_micros: number
          public_events: number
          operational_events: number
        }>(
          `select run.status, run.provider_turns, run.prompt_tokens, run.completion_tokens, run.cost_micros,
            attempt.state as attempt_state, attempt.cost_accuracy as attempt_accuracy,
            attempt.amount_micros as attempt_amount_micros,
            (select count(*)::int from app.agent_task_events where task_run_id=run.id
              and event_key='task-budget-exceeded:'||attempt.id) as public_events,
            (select count(*)::int from app.agent_task_operational_events where task_run_id=run.id
              and dedupe_key='task-budget-exceeded:'||attempt.id) as operational_events
           from app.agent_task_runs run
           join app.agent_provider_attempts attempt on attempt.id=$2
           where run.id=$1`,
          [fixture.run.id, prepared.id],
        )

      const first = await pgRepository.completeAgentProviderAttempt(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        completion,
      )
      expect(first).toMatchObject({ taskOutcomeClassification: 'task_budget_exceeded_paused' })
      const expected = {
        status: 'paused',
        provider_turns: 1,
        prompt_tokens: 80,
        completion_tokens: 30,
        cost_micros: 150,
        attempt_state: 'failed_definite',
        attempt_accuracy: 'actual',
        attempt_amount_micros: 150,
        public_events: 1,
        operational_events: 1,
      }
      expect((await snapshot()).rows[0]).toEqual(expected)

      const replay = await pgRepository.completeAgentProviderAttempt(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        completion,
      )
      expect(replay).toMatchObject({ taskOutcomeClassification: 'task_budget_exceeded_paused' })
      expect((await snapshot()).rows[0]).toEqual(expected)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('does not count a never-started definite failure and replays without mutation', async () => {
    if (!admin || !pgRepository?.prepareAgentProviderAttempt || !pgRepository.completeAgentProviderAttempt) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedTransitionProviderFixture({ ...providerBounds, maxProviderTurns: 1 })
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'never-started-definite-failure-turn',
        providerRequestKey: 'never-started-definite-failure-request',
        requestBodyDigest: '1'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 10,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      const completion = {
        state: 'failed_definite' as const,
        providerAttempt: {
          providerRequestKey: providerInput.providerRequestKey,
          requestBodyDigest: providerInput.requestBodyDigest,
          idempotencyMode: providerInput.idempotencyMode,
          idempotencyHeaderSent: false,
          reason: 'request_not_sent',
        },
        now,
      }
      const snapshot = () =>
        admin.query<{
          status: string
          provider_turns: number
          prompt_tokens: number
          completion_tokens: number
          cost_micros: number
          attempt_state: string
          attempt_amount_micros: number
          operational_events: number
        }>(
          `select run.status, run.provider_turns, run.prompt_tokens, run.completion_tokens, run.cost_micros,
            attempt.state as attempt_state, attempt.amount_micros as attempt_amount_micros,
            (select count(*)::int from app.agent_task_operational_events where task_run_id=run.id) as operational_events
           from app.agent_task_runs run
           join app.agent_provider_attempts attempt on attempt.id=$2
           where run.id=$1`,
          [fixture.run.id, prepared.id],
        )

      const first = await pgRepository.completeAgentProviderAttempt(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        completion,
      )
      expect(first).toMatchObject({ taskOutcomeClassification: 'within_budget' })
      const expected = {
        status: 'planning',
        provider_turns: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_micros: 0,
        attempt_state: 'failed_definite',
        attempt_amount_micros: 0,
        operational_events: 0,
      }
      expect((await snapshot()).rows[0]).toEqual(expected)

      const replay = await pgRepository.completeAgentProviderAttempt(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        completion,
      )
      expect(replay).toMatchObject({ taskOutcomeClassification: 'within_budget' })
      expect((await snapshot()).rows[0]).toEqual(expected)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('does not double-count provider accounting when a settled attempt is followed by transition completion', async () => {
    if (
      !admin ||
      !pgRepository?.prepareAgentProviderAttempt ||
      !pgRepository.markAgentProviderAttemptStarted ||
      !pgRepository.completeAgentProviderAttempt ||
      !pgRepository.completeAgentTaskTransition
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedTransitionProviderFixture()
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'single-accounting-owner-turn',
        providerRequestKey: 'single-accounting-owner-request',
        requestBodyDigest: '2'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 100,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      const started = await pgRepository.markAgentProviderAttemptStarted(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        now,
      )
      if (!started) throw new Error('Provider attempt fixture could not be started')
      const providerCompletion = {
        state: 'succeeded' as const,
        providerAttempt: {
          providerRequestKey: providerInput.providerRequestKey,
          requestBodyDigest: providerInput.requestBodyDigest,
          idempotencyMode: providerInput.idempotencyMode,
          idempotencyHeaderSent: true,
        },
        promptTokens: 100,
        completionTokens: 50,
        providerAmountMicros: 200,
        now,
      }
      await expect(
        pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, providerCompletion),
      ).resolves.toMatchObject({ taskOutcomeClassification: 'within_budget' })
      const snapshot = () =>
        admin.query<{
          status: string
          provider_turns: number
          prompt_tokens: number
          completion_tokens: number
          cost_micros: number
          plans: number
          completed_transitions: number
        }>(
          `select status, provider_turns, prompt_tokens, completion_tokens, cost_micros,
            (select count(*)::int from app.agent_task_plans where task_run_id=$1) as plans,
            (select count(*)::int from app.agent_task_transitions where task_run_id=$1 and status='completed')
              as completed_transitions
           from app.agent_task_runs where id=$1`,
          [fixture.run.id],
        )
      const settledSnapshot = (await snapshot()).rows[0]
      expect(settledSnapshot).toMatchObject({
        provider_turns: 1,
        prompt_tokens: 100,
        completion_tokens: 50,
        cost_micros: 200,
      })
      const transitionCompletion = {
        status: 'completed' as const,
        taskRunPatch: { status: 'running' as const },
        plan: {
          summary: 'Build the visible dashboard shell',
          assumptions: [],
          verification: {},
          steps: [{ id: 'single-accounting-step', ordinal: 1, title: 'Build the shell', intent: {} }],
        },
        nextTransition: {
          stepOrdinal: 1,
          kind: 'step_action' as const,
          transitionKey: 'single-accounting:step-action',
        },
        now,
      }

      await expect(
        pgRepository.completeAgentTaskTransition(fixture.actorId, fixture.fence, {
          ...transitionCompletion,
          accountingDelta: { providerTurns: 0 } as unknown as { executorRetries?: number },
        }),
      ).resolves.toBe('invalid_state')
      expect((await snapshot()).rows[0]).toEqual(settledSnapshot)

      const first = await pgRepository.completeAgentTaskTransition(fixture.actorId, fixture.fence, transitionCompletion)
      expect(first).toMatchObject({ transition: { status: 'completed' } })
      const completedSnapshot = (await snapshot()).rows[0]
      expect(completedSnapshot).toEqual({
        status: 'running',
        provider_turns: 1,
        prompt_tokens: 100,
        completion_tokens: 50,
        cost_micros: 200,
        plans: 1,
        completed_transitions: 1,
      })

      const replay = await pgRepository.completeAgentTaskTransition(
        fixture.actorId,
        fixture.fence,
        transitionCompletion,
      )
      expect(replay).toMatchObject({ transition: { status: 'completed' } })
      expect((await snapshot()).rows[0]).toEqual(completedSnapshot)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('pauses and evidences actual provider overage exactly once while preserving truthful accounting', async () => {
    if (
      !admin ||
      !pgRepository?.prepareAgentProviderAttempt ||
      !pgRepository.markAgentProviderAttemptStarted ||
      !pgRepository.completeAgentProviderAttempt
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedTransitionProviderFixture()
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'actual-overage-turn',
        providerRequestKey: 'actual-overage-request',
        requestBodyDigest: 'e'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 100,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      const started = await pgRepository.markAgentProviderAttemptStarted(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        now,
      )
      if (!started) throw new Error('Provider attempt fixture could not be started')
      const completion = {
        state: 'succeeded' as const,
        providerAttempt: {
          providerRequestKey: providerInput.providerRequestKey,
          requestBodyDigest: providerInput.requestBodyDigest,
          idempotencyMode: providerInput.idempotencyMode,
          idempotencyHeaderSent: true,
        },
        promptTokens: 900,
        completionTokens: 200,
        providerAmountMicros: 1_500,
        now,
      }

      const first = await pgRepository.completeAgentProviderAttempt(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        completion,
      )
      expect(first).toMatchObject({ taskOutcomeClassification: 'task_budget_exceeded_paused' })
      const snapshot = () =>
        admin.query<{
          status: string
          current_transition_key: string | null
          transition_status: string
          provider_turns: number
          prompt_tokens: number
          completion_tokens: number
          cost_micros: number
          public_events: number
          operational_events: number
        }>(
          `select status, current_transition_key, provider_turns, prompt_tokens, completion_tokens, cost_micros,
            (select status from app.agent_task_transitions where id=$3) as transition_status,
            (select count(*)::int from app.agent_task_events where task_run_id=$1
              and event_key='task-budget-exceeded:'||$2) as public_events,
            (select count(*)::int from app.agent_task_operational_events where task_run_id=$1
              and dedupe_key='task-budget-exceeded:'||$2) as operational_events
           from app.agent_task_runs where id=$1`,
          [fixture.run.id, prepared.id, fixture.fence.transitionId],
        )
      expect((await snapshot()).rows[0]).toEqual({
        status: 'paused',
        current_transition_key: null,
        transition_status: 'failed',
        provider_turns: 1,
        prompt_tokens: 900,
        completion_tokens: 200,
        cost_micros: 1_500,
        public_events: 1,
        operational_events: 1,
      })

      const replay = await pgRepository.completeAgentProviderAttempt(
        fixture.actorId,
        prepared.id,
        fixture.fence,
        completion,
      )
      expect(replay).toMatchObject({ taskOutcomeClassification: 'task_budget_exceeded_paused' })
      expect((await snapshot()).rows[0]).toEqual({
        status: 'paused',
        current_transition_key: null,
        transition_status: 'failed',
        provider_turns: 1,
        prompt_tokens: 900,
        completion_tokens: 200,
        cost_micros: 1_500,
        public_events: 1,
        operational_events: 1,
      })
      await expect(
        pgRepository.claimAgentTaskTransition!(
          'budget-reclaim-worker',
          new Date(now.getTime() + 60_000),
          new Date(now.getTime() + 90_000),
          ['planning'],
        ),
      ).resolves.toBeNull()
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('settles a succeeded but invalid planning response as one terminal fenced failure', async () => {
    if (
      !admin ||
      !pgRepository?.prepareAgentProviderAttempt ||
      !pgRepository.markAgentProviderAttemptStarted ||
      !pgRepository.completeAgentProviderAttempt ||
      !pgRepository.claimAgentTaskTransition
    ) {
      throw new Error('Agent provider transition integration database is unavailable')
    }
    const fixture = await seedTransitionProviderFixture()
    try {
      const providerInput = {
        projectId: fixture.project.id,
        taskId: fixture.run.taskId,
        turnId: 'invalid-response-turn',
        providerRequestKey: 'invalid-response-request',
        requestBodyDigest: '9'.repeat(64),
        idempotencyMode: 'stable' as const,
        reservedMicros: 10,
        now,
      }
      const prepared = await pgRepository.prepareAgentProviderAttempt(fixture.actorId, fixture.fence, providerInput)
      if (typeof prepared === 'string') throw new Error('Provider attempt fixture could not be prepared')
      await pgRepository.markAgentProviderAttemptStarted(fixture.actorId, prepared.id, fixture.fence, now)
      const completion = {
        state: 'succeeded' as const,
        providerAttempt: {
          providerRequestKey: providerInput.providerRequestKey,
          requestBodyDigest: providerInput.requestBodyDigest,
          idempotencyMode: providerInput.idempotencyMode,
          idempotencyHeaderSent: true,
        },
        decisionOutput: { purpose: 'planning', error: { code: 'provider_response_invalid' } },
        decisionTrace: { purpose: 'planning' },
        terminalTransitionFailure: {
          code: 'provider_response_invalid',
          summary: 'The planning response was invalid.',
          publicPayload: { action: 'retry' },
          technicalPayload: { validation: 'schema' },
        },
        providerAmountMicros: 20,
        now,
      }
      await expect(
        pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, completion),
      ).resolves.toMatchObject({ taskOutcomeClassification: 'transition_failed_terminal' })
      const snapshot = await admin.query<{
        run_status: string
        current_transition_key: string | null
        transition_status: string
        events: number
      }>(
        `select run.status as run_status, run.current_transition_key, transition.status as transition_status,
          (select count(*)::int from app.agent_task_events where task_run_id=run.id
            and event_key='provider-terminal-failure:'||$2) as events
         from app.agent_task_runs run join app.agent_task_transitions transition on transition.id=$3
         where run.id=$1`,
        [fixture.run.id, prepared.id, fixture.fence.transitionId],
      )
      expect(snapshot.rows[0]).toEqual({
        run_status: 'failed',
        current_transition_key: null,
        transition_status: 'failed',
        events: 1,
      })
      await expect(
        pgRepository.completeAgentProviderAttempt(fixture.actorId, prepared.id, fixture.fence, completion),
      ).resolves.toMatchObject({ taskOutcomeClassification: 'transition_failed_terminal' })
      await expect(
        pgRepository.claimAgentTaskTransition(
          'invalid-response-reclaim-worker',
          new Date(now.getTime() + 60_000),
          new Date(now.getTime() + 90_000),
          ['planning'],
        ),
      ).resolves.toBeNull()
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })
})
