import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import type { AgentTaskCompletionInput, AgentTaskRunBounds } from '../types.js'
import type { ProjectSchema } from '../validation.js'
import { createAgentTaskRunFixture } from './agent-task-test-fixture.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const repository = runtimeDatabaseUrl ? createPgRepository({ DATABASE_URL: runtimeDatabaseUrl } as AppEnv) : null
const now = new Date('2026-08-04T12:00:00.000Z')
const bounds: AgentTaskRunBounds = {
  maxProviderTurns: 12,
  maxStepRevisions: 2,
  maxExecutorRetries: 1,
  tokenLimit: 40_000,
  costLimitMicros: 2_000_000,
}
const schema: ProjectSchema = {
  formatVersion: 1,
  editorSchema: { version: '1.0.0', componentsTree: [] },
  presentation: { startPageId: 'page-home', theme: { mode: 'dark', tokens: {} } },
}

async function seedProject() {
  if (!admin || !repository) throw new Error('Phase 3 integration database is unavailable')
  const actorId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  const project = await repository.createProject(actorId, { name: 'Phase 3 persistence', schema })
  return { actorId, projectId: project.id }
}

function taskInput(projectId: string, conversationId = randomUUID(), taskId = randomUUID()) {
  return {
    projectId,
    conversationId,
    taskId,
    idempotencyKey: randomUUID(),
    binding: {
      provider: 'openai-compatible',
      model: 'phase3-model',
      profileId: 'profile-1',
      configDigest: 'a'.repeat(64),
    },
    bounds,
    taskStartDocumentRevision: 1,
    now,
  }
}

async function createPlannedRun(actorId: string, projectId: string) {
  if (!admin || !repository?.createAgentTaskRun || !repository.claimAgentTaskTransition) {
    throw new Error('Phase 3 task repository is unavailable')
  }
  const input = taskInput(projectId)
  const run = await createAgentTaskRunFixture(admin, repository, actorId, input)
  if (!run || typeof run === 'string') throw new Error('Task run fixture could not be created')
  const workerId = `planning-${randomUUID()}`
  const claim = await repository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 60_000))
  if (!claim?.leaseToken) throw new Error('Planning transition could not be claimed')
  const planned = await repository.completeAgentTaskTransition?.(
    actorId,
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
        summary: 'One safe step',
        assumptions: [],
        verification: { deterministic: true },
        steps: [{ id: 'phase3-step', ordinal: 1, title: 'Apply one change', intent: {} }],
      },
      nextTransition: { kind: 'step_action', stepOrdinal: 1, transitionKey: 'phase3:step-action:1' },
      now,
    },
  )
  if (!planned || typeof planned === 'string' || !planned.nextTransition) throw new Error('Plan fixture failed')
  return { run, input, stepId: planned.nextTransition.stepId! }
}

async function insertOperation(input: {
  actorId: string
  projectId: string
  taskId: string
  operationId?: string
  status?: 'issued' | 'committed'
}) {
  if (!admin) throw new Error('Phase 3 administrator database is unavailable')
  const operationId = input.operationId ?? randomUUID()
  const status = input.status ?? 'issued'
  const result = await admin.query<{ id: string }>(
    `insert into app.agent_spike_operations (
       actor_id, project_id, task_id, stage_id, executor_id, operation_id, grant_jti,
       base_draft_version, input_digest, executor_input, issue_digest, compatibility, expires_at,
       status, candidate_digest, prepared_digest, candidate_schema, host_receipt, evidence,
       prepared_at, committed_draft_version, outcome, completed_at
     ) values (
       $1,$2,$3,'phase3-step','phase3-executor',$4,$5,1,$6,'{}'::jsonb,$7,'{}'::jsonb,$8,
       $9,
       case when $9='committed' then $10 else null end,
       case when $9='committed' then $11 else null end,
       case when $9='committed' then '{}'::jsonb else null end,
       case when $9='committed' then '{"status":"applied"}'::jsonb else null end,
       case when $9='committed' then $12::jsonb else null end,
       case when $9='committed' then $13::timestamptz else null end,
       case when $9='committed' then 2 else null end,
       case when $9='committed' then '{"status":"committed"}'::jsonb else null end,
       case when $9='committed' then $13::timestamptz else null end
     ) returning id`,
    [
      input.actorId,
      input.projectId,
      input.taskId,
      operationId,
      randomUUID(),
      'b'.repeat(64),
      'c'.repeat(64),
      new Date(now.getTime() + 300_000),
      status,
      'd'.repeat(64),
      'e'.repeat(64),
      JSON.stringify({
        consoleErrors: [],
        requestFailures: [],
        render: { status: 'rendered', rendererReady: true, screenshotSha256: 'f'.repeat(64), resourceErrors: [] },
        materials: { missing: [] },
      }),
      now,
    ],
  )
  if (status === 'committed') {
    await admin.query('update app.projects set draft_version=2, updated_at=$2 where id=$1', [input.projectId, now])
  }
  return { id: result.rows[0]!.id, operationId }
}

async function claimMutating(actorId: string, runId: string, workerId: string) {
  if (!repository?.acquireAgentProjectTaskLease || !repository.claimAgentTaskTransition) {
    throw new Error('Phase 3 lease repository is unavailable')
  }
  const lease = await repository.acquireAgentProjectTaskLease(actorId, {
    taskRunId: runId,
    workerId,
    now,
    leaseUntil: new Date(now.getTime() + 60_000),
  })
  if (!lease || typeof lease === 'string') throw new Error('Project task lease could not be acquired')
  const claim = await repository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 60_000))
  if (!claim?.leaseToken) throw new Error('Mutating transition could not be claimed')
  return {
    claim,
    fence: {
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

async function advanceToFinalVerification(actorId: string, projectId: string) {
  if (!repository?.completeAgentTaskTransition) throw new Error('Phase 3 completion repository is unavailable')
  const fixture = await createPlannedRun(actorId, projectId)
  const action = await claimMutating(actorId, fixture.run.id, `action-${randomUUID()}`)
  const actionResult = await repository.completeAgentTaskTransition(actorId, action.fence, {
    status: 'completed',
    taskRunPatch: { status: 'running' },
    stepPatch: { stepId: fixture.stepId, status: 'verifying' },
    nextTransition: { kind: 'observation', stepId: fixture.stepId, transitionKey: 'phase3:observation:1' },
    now,
  })
  if (typeof actionResult === 'string') throw new Error('Step action fixture failed')
  const observation = await repository.claimAgentTaskTransition!(
    action.claim.leaseOwner!,
    now,
    new Date(now.getTime() + 60_000),
  )
  if (!observation?.leaseToken) throw new Error('Observation transition could not be claimed')
  const observationResult = await repository.completeAgentTaskTransition(
    actorId,
    {
      transitionId: observation.id,
      workerId: action.claim.leaseOwner!,
      leaseGeneration: observation.leaseGeneration,
      leaseToken: observation.leaseToken,
      projectLeaseGeneration: observation.projectLeaseGeneration,
      projectLeaseToken: observation.projectLeaseToken,
      projectLeaseWorkerId: observation.projectLeaseWorkerId,
    },
    {
      status: 'completed',
      taskRunPatch: { status: 'verifying' },
      stepPatch: { stepId: fixture.stepId, status: 'passed', lastObservation: { deterministic: 'passed' } },
      nextTransition: { kind: 'final_verification', transitionKey: 'phase3:final-verification:1' },
      now,
    },
  )
  if (typeof observationResult === 'string') throw new Error('Observation fixture failed')
  const finalClaim = await repository.claimAgentTaskTransition!(
    action.claim.leaseOwner!,
    now,
    new Date(now.getTime() + 60_000),
  )
  if (!finalClaim?.leaseToken) throw new Error('Final verification transition could not be claimed')
  return {
    ...fixture,
    fence: {
      transitionId: finalClaim.id,
      workerId: action.claim.leaseOwner!,
      leaseGeneration: finalClaim.leaseGeneration,
      leaseToken: finalClaim.leaseToken,
      projectLeaseGeneration: finalClaim.projectLeaseGeneration,
      projectLeaseToken: finalClaim.projectLeaseToken,
      projectLeaseWorkerId: finalClaim.projectLeaseWorkerId,
    },
  }
}

describeWithDatabase('Agent task Phase 3 PostgreSQL persistence safety', () => {
  afterAll(async () => admin?.end())

  it('acquires the project lease for the earliest pending mutating transition after restart', async () => {
    if (!repository?.acquireNextAgentProjectTaskLease) throw new Error('Phase 3 next-lease repository is unavailable')
    const fixture = await seedProject()
    try {
      const planned = await createPlannedRun(fixture.actorId, fixture.projectId)

      const lease = await repository.acquireNextAgentProjectTaskLease(
        'restarted-phase3-worker',
        now,
        new Date(now.getTime() + 60_000),
      )

      expect(lease).toMatchObject({
        projectId: fixture.projectId,
        taskRunId: planned.run.id,
        leaseOwner: 'restarted-phase3-worker',
      })
    } finally {
      await admin!.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('allows only one worker to acquire the next project lease concurrently', async () => {
    if (!repository?.acquireNextAgentProjectTaskLease) throw new Error('Phase 3 next-lease repository is unavailable')
    const fixture = await seedProject()
    try {
      await createPlannedRun(fixture.actorId, fixture.projectId)
      const leaseUntil = new Date(now.getTime() + 60_000)

      const leases = await Promise.all([
        repository.acquireNextAgentProjectTaskLease('phase3-worker-a', now, leaseUntil),
        repository.acquireNextAgentProjectTaskLease('phase3-worker-b', now, leaseUntil),
      ])

      expect(leases.filter(Boolean)).toHaveLength(1)
    } finally {
      await admin!.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('atomically completes one step action and replays it without duplicating attempt, event, or next transition', async () => {
    if (!admin || !repository?.completeAgentTaskTransition) throw new Error('Phase 3 repository is unavailable')
    const fixture = await seedProject()
    try {
      const planned = await createPlannedRun(fixture.actorId, fixture.projectId)
      const operation = await insertOperation({
        actorId: fixture.actorId,
        projectId: fixture.projectId,
        taskId: planned.input.taskId,
      })
      const claimed = await claimMutating(fixture.actorId, planned.run.id, `step-${randomUUID()}`)
      const completion: AgentTaskCompletionInput = {
        status: 'completed',
        taskRunPatch: { status: 'running' },
        stepPatch: { stepId: planned.stepId, status: 'running' },
        stepAttempt: {
          stepId: planned.stepId,
          decisionKind: 'execute',
          operationId: operation.operationId,
          executorRetryCount: 0,
          semanticRevisionCount: 0,
        },
        events: [
          {
            eventKey: 'phase3:step-started:1',
            stepId: planned.stepId,
            type: 'step_started',
            summary: '开始执行当前步骤',
          },
        ],
        nextTransition: { kind: 'observation', stepId: planned.stepId, transitionKey: 'phase3:observation:1' },
        now,
      }

      const first = await repository.completeAgentTaskTransition(fixture.actorId, claimed.fence, completion)
      const replay = await repository.completeAgentTaskTransition(fixture.actorId, claimed.fence, completion)

      expect(replay).toEqual(first)
      const persisted = await admin.query<{ attempts: number; events: number; next_transitions: number }>(
        `select
          (select count(*)::int from app.agent_task_step_attempts where task_run_id=$1) attempts,
          (select count(*)::int from app.agent_task_events where task_run_id=$1 and event_key='phase3:step-started:1') events,
          (select count(*)::int from app.agent_task_transitions where task_run_id=$1 and transition_key='phase3:observation:1') next_transitions`,
        [planned.run.id],
      )
      expect(persisted.rows[0]).toEqual({ attempts: 1, events: 1, next_transitions: 1 })
    } finally {
      await admin.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('rolls back step state and attempt when public event persistence fails', async () => {
    if (!admin || !repository?.completeAgentTaskTransition) throw new Error('Phase 3 repository is unavailable')
    const fixture = await seedProject()
    const triggerName = `phase3_fail_event_${randomUUID().replaceAll('-', '')}`
    try {
      const planned = await createPlannedRun(fixture.actorId, fixture.projectId)
      const operation = await insertOperation({
        actorId: fixture.actorId,
        projectId: fixture.projectId,
        taskId: planned.input.taskId,
      })
      const claimed = await claimMutating(fixture.actorId, planned.run.id, `rollback-${randomUUID()}`)
      await admin.query(`
        create function app.${triggerName}() returns trigger language plpgsql as $$
        begin
          if new.event_key = 'phase3:forced-event-failure' then
            raise exception 'phase3 injected event failure';
          end if;
          return new;
        end $$;
        create trigger ${triggerName} before insert on app.agent_task_events
        for each row execute function app.${triggerName}();
      `)

      await expect(
        repository.completeAgentTaskTransition(fixture.actorId, claimed.fence, {
          status: 'completed',
          stepPatch: { stepId: planned.stepId, status: 'running' },
          stepAttempt: {
            stepId: planned.stepId,
            decisionKind: 'execute',
            operationId: operation.operationId,
          },
          events: [
            {
              eventKey: 'phase3:forced-event-failure',
              stepId: planned.stepId,
              type: 'step_started',
              summary: 'This insert must fail',
            },
          ],
          now,
        }),
      ).rejects.toThrow('agent_task_events')
      const persisted = await admin.query<{ step_status: string; attempts: number; transition_status: string }>(
        `select step.status step_status,
          (select count(*)::int from app.agent_task_step_attempts where task_run_id=$1) attempts,
          transition.status transition_status
         from app.agent_task_steps step
         join app.agent_task_transitions transition on transition.id=$2
         where step.id=$3`,
        [planned.run.id, claimed.claim.id, planned.stepId],
      )
      expect(persisted.rows[0]).toEqual({ step_status: 'pending', attempts: 0, transition_status: 'leased' })
    } finally {
      await admin.query(`drop trigger if exists ${triggerName} on app.agent_task_events`)
      await admin.query(`drop function if exists app.${triggerName}()`)
      await admin.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('rejects a step attempt whose operation belongs to another task', async () => {
    if (!repository?.completeAgentTaskTransition) throw new Error('Phase 3 repository is unavailable')
    const fixture = await seedProject()
    try {
      const planned = await createPlannedRun(fixture.actorId, fixture.projectId)
      const operation = await insertOperation({
        actorId: fixture.actorId,
        projectId: fixture.projectId,
        taskId: 'another-task',
      })
      const claimed = await claimMutating(fixture.actorId, planned.run.id, `foreign-operation-${randomUUID()}`)
      await expect(
        repository.completeAgentTaskTransition(fixture.actorId, claimed.fence, {
          status: 'completed',
          stepPatch: { stepId: planned.stepId, status: 'running' },
          stepAttempt: { stepId: planned.stepId, decisionKind: 'execute', operationId: operation.operationId },
          now,
        }),
      ).resolves.toBe('invalid_state')
    } finally {
      await admin!.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('bounds executor retries per operation while retaining the run-wide observational total', async () => {
    if (!repository?.completeAgentTaskTransition || !repository.claimAgentTaskTransition) {
      throw new Error('Phase 3 repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const planned = await createPlannedRun(fixture.actorId, fixture.projectId)
      const firstOperation = await insertOperation({
        actorId: fixture.actorId,
        projectId: fixture.projectId,
        taskId: planned.input.taskId,
      })
      const secondOperation = await insertOperation({
        actorId: fixture.actorId,
        projectId: fixture.projectId,
        taskId: planned.input.taskId,
      })
      const workerId = `retry-${randomUUID()}`
      const firstAction = await claimMutating(fixture.actorId, planned.run.id, workerId)
      const firstCompletion = await repository.completeAgentTaskTransition(fixture.actorId, firstAction.fence, {
        status: 'completed',
        accountingDelta: { executorRetries: 1 },
        stepPatch: { stepId: planned.stepId, status: 'running' },
        stepAttempt: {
          stepId: planned.stepId,
          decisionKind: 'retry_same',
          operationId: firstOperation.operationId,
          executorRetryCount: 1,
        },
        nextTransition: { kind: 'observation', stepId: planned.stepId, transitionKey: 'phase3:retry-observation' },
        now,
      })
      if (typeof firstCompletion === 'string') throw new Error('First retry fixture failed')
      const observation = await repository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 60_000))
      if (!observation?.leaseToken) throw new Error('Retry observation could not be claimed')
      const observed = await repository.completeAgentTaskTransition(
        fixture.actorId,
        {
          transitionId: observation.id,
          workerId,
          leaseGeneration: observation.leaseGeneration,
          leaseToken: observation.leaseToken,
          projectLeaseGeneration: observation.projectLeaseGeneration,
          projectLeaseToken: observation.projectLeaseToken,
          projectLeaseWorkerId: observation.projectLeaseWorkerId,
        },
        {
          status: 'completed',
          stepPatch: { stepId: planned.stepId, status: 'revising' },
          nextTransition: { kind: 'step_action', stepId: planned.stepId, transitionKey: 'phase3:retry-action:2' },
          now,
        },
      )
      if (typeof observed === 'string') throw new Error('Retry observation fixture failed')
      const secondAction = await repository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 60_000))
      if (!secondAction?.leaseToken) throw new Error('Second retry action could not be claimed')
      const secondFence = {
        transitionId: secondAction.id,
        workerId,
        leaseGeneration: secondAction.leaseGeneration,
        leaseToken: secondAction.leaseToken,
        projectLeaseGeneration: secondAction.projectLeaseGeneration,
        projectLeaseToken: secondAction.projectLeaseToken,
        projectLeaseWorkerId: secondAction.projectLeaseWorkerId,
      }

      await expect(
        repository.completeAgentTaskTransition(fixture.actorId, secondFence, {
          status: 'completed',
          accountingDelta: { executorRetries: 1 },
          stepPatch: { stepId: planned.stepId, status: 'running' },
          stepAttempt: {
            stepId: planned.stepId,
            decisionKind: 'retry_same',
            operationId: firstOperation.operationId,
            executorRetryCount: 2,
          },
          now,
        }),
      ).resolves.toBe('invalid_state')

      const accepted = await repository.completeAgentTaskTransition(fixture.actorId, secondFence, {
        status: 'completed',
        accountingDelta: { executorRetries: 1 },
        stepPatch: { stepId: planned.stepId, status: 'running' },
        stepAttempt: {
          stepId: planned.stepId,
          decisionKind: 'retry_same',
          operationId: secondOperation.operationId,
          executorRetryCount: 1,
        },
        now,
      })

      expect(accepted).toMatchObject({ taskRun: { executorRetries: 2 } })
    } finally {
      await admin!.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('atomically replans from an observation without requiring an unreachable paused transition', async () => {
    if (!admin || !repository?.completeAgentTaskTransition || !repository.claimAgentTaskTransition) {
      throw new Error('Phase 3 repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const planned = await createPlannedRun(fixture.actorId, fixture.projectId)
      const workerId = `replan-${randomUUID()}`
      const action = await claimMutating(fixture.actorId, planned.run.id, workerId)
      const actionResult = await repository.completeAgentTaskTransition(fixture.actorId, action.fence, {
        status: 'completed',
        stepPatch: { stepId: planned.stepId, status: 'running' },
        nextTransition: { kind: 'observation', stepId: planned.stepId, transitionKey: 'phase3:replan-observation' },
        now,
      })
      if (typeof actionResult === 'string') throw new Error('Replan action fixture failed')
      const observation = await repository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 60_000))
      if (!observation?.leaseToken) throw new Error('Replan observation could not be claimed')

      const replanned = await repository.completeAgentTaskTransition(
        fixture.actorId,
        {
          transitionId: observation.id,
          workerId,
          leaseGeneration: observation.leaseGeneration,
          leaseToken: observation.leaseToken,
          projectLeaseGeneration: observation.projectLeaseGeneration,
          projectLeaseToken: observation.projectLeaseToken,
          projectLeaseWorkerId: observation.projectLeaseWorkerId,
        },
        {
          status: 'completed',
          taskRunPatch: { status: 'running' },
          stepPatch: {
            stepId: planned.stepId,
            status: 'superseded',
            lastObservation: { classification: 'replan_remaining' },
          },
          plan: {
            summary: 'Replanned remaining work',
            assumptions: [],
            verification: { deterministic: true },
            steps: [{ id: 'replacement-step', ordinal: 1, title: 'Apply replacement', intent: {} }],
          },
          events: [
            {
              eventKey: `agent-task-event:${observation.id}:step-superseded`,
              stepId: planned.stepId,
              type: 'step_superseded',
              summary: 'Current step was superseded by the replacement plan',
              publicPayload: {},
              technicalPayload: {},
              redactionVersion: 1,
            },
          ],
          nextTransition: { kind: 'step_action', stepOrdinal: 1, transitionKey: 'phase3:replacement-action' },
          now,
        },
      )

      expect(replanned).toMatchObject({ taskRun: { status: 'running', activePlanVersion: 2 } })
      const steps = await admin.query<{ plan_version: number; semantic_step_key: string; status: string }>(
        `select plan_version, semantic_step_key, status from app.agent_task_steps
         where task_run_id=$1 order by plan_version, ordinal`,
        [planned.run.id],
      )
      expect(steps.rows).toEqual([
        { plan_version: 1, semantic_step_key: 'phase3-step', status: 'superseded' },
        { plan_version: 2, semantic_step_key: 'replacement-step', status: 'pending' },
      ])
      const supersededEvents = await admin.query<{ step_id: string; type: string }>(
        `select step_id, type from app.agent_task_events
         where task_run_id=$1 and event_key=$2`,
        [planned.run.id, `agent-task-event:${observation.id}:step-superseded`],
      )
      expect(supersededEvents.rows).toEqual([{ step_id: planned.stepId, type: 'step_superseded' }])
    } finally {
      await admin.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('rejects final completion when deterministic final-verification evidence is missing', async () => {
    if (!repository?.completeAgentTaskTransition) throw new Error('Phase 3 repository is unavailable')
    const fixture = await seedProject()
    try {
      const final = await advanceToFinalVerification(fixture.actorId, fixture.projectId)
      await expect(
        repository.completeAgentTaskTransition(fixture.actorId, final.fence, {
          status: 'completed',
          taskRunPatch: { status: 'completed' },
          now,
        }),
      ).resolves.toBe('invalid_state')
    } finally {
      await admin!.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('rejects final completion while an active-plan step is not passed', async () => {
    if (!admin || !repository?.enqueueAgentTaskTransition || !repository.completeAgentTaskTransition) {
      throw new Error('Phase 3 repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const planned = await createPlannedRun(fixture.actorId, fixture.projectId)
      await admin.query(`update app.agent_task_runs set status='verifying' where id=$1`, [planned.run.id])
      await admin.query(`update app.agent_task_steps set status='verifying' where id=$1`, [planned.stepId])
      await admin.query(
        `update app.agent_task_transitions set status='canceled', completed_at=$2
         where task_run_id=$1 and kind='step_action' and status='pending'`,
        [planned.run.id, now],
      )
      const transition = await repository.enqueueAgentTaskTransition(fixture.actorId, {
        taskRunId: planned.run.id,
        kind: 'final_verification',
        transitionKey: 'phase3:premature-final',
        now,
      })
      if (!transition || typeof transition === 'string') throw new Error('Premature final transition fixture failed')
      const claimed = await claimMutating(fixture.actorId, planned.run.id, `premature-final-${randomUUID()}`)
      const operation = await insertOperation({
        actorId: fixture.actorId,
        projectId: fixture.projectId,
        taskId: planned.input.taskId,
        status: 'committed',
      })

      await expect(
        repository.completeAgentTaskTransition(fixture.actorId, claimed.fence, {
          status: 'completed',
          taskRunPatch: { status: 'completed' },
          finalVerification: {
            operationId: operation.operationId,
            receiptId: operation.id,
            committedDraftVersion: 2,
            verifiedAt: now.toISOString(),
            documentValid: true,
            renderReady: true,
            browserErrors: [],
            resourceErrors: [],
            freshContextVerified: true,
            receiptConsistent: true,
            visualAccepted: true,
            visualReviewConfidence: 0.95,
          },
          now,
        }),
      ).resolves.toBe('invalid_state')
    } finally {
      await admin.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('atomically reopens the passed step when final visual acceptance requests a bounded repair', async () => {
    if (!admin || !repository?.completeAgentTaskTransition) throw new Error('Phase 3 repository is unavailable')
    const fixture = await seedProject()
    try {
      const final = await advanceToFinalVerification(fixture.actorId, fixture.projectId)
      const nextTransitionKey = 'phase3:visual-repair:1'
      const completion = await repository.completeAgentTaskTransition(fixture.actorId, final.fence, {
        status: 'completed',
        output: { verified: false, recoveryClass: 'revise_step' },
        taskRunPatch: { status: 'running', currentTransitionKey: nextTransitionKey },
        accountingDelta: { semanticRevisions: 1 },
        stepPatch: {
          stepId: final.stepId,
          status: 'revising',
          lastObservation: { outcome: 'visual_acceptance_failed' },
        },
        nextTransition: {
          kind: 'step_action',
          stepId: final.stepId,
          transitionKey: nextTransitionKey,
          input: { visualRevisionCount: 1, recoveryClass: 'revise_step' },
        },
        now,
      })

      expect(completion).toMatchObject({
        taskRun: { status: 'running', semanticRevisions: 1, currentTransitionKey: nextTransitionKey },
        nextTransition: { kind: 'step_action', stepId: final.stepId, status: 'pending' },
      })
      const result = await admin.query<{ status: string }>(
        'select status from app.agent_task_steps where id=$1 and task_run_id=$2',
        [final.stepId, final.run.id],
      )
      expect(result.rows[0]?.status).toBe('revising')
    } finally {
      await admin.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })

  it('completes final verification once when all active steps passed and durable evidence matches', async () => {
    if (!admin || !repository?.completeAgentTaskTransition) throw new Error('Phase 3 repository is unavailable')
    const fixture = await seedProject()
    try {
      const final = await advanceToFinalVerification(fixture.actorId, fixture.projectId)
      const operation = await insertOperation({
        actorId: fixture.actorId,
        projectId: fixture.projectId,
        taskId: final.input.taskId,
        status: 'committed',
      })
      const completion: AgentTaskCompletionInput = {
        status: 'completed',
        taskRunPatch: { status: 'completed' },
        finalVerification: {
          operationId: operation.operationId,
          receiptId: operation.id,
          committedDraftVersion: 2,
          verifiedAt: now.toISOString(),
          documentValid: true,
          renderReady: true,
          browserErrors: [],
          resourceErrors: [],
          freshContextVerified: true,
          receiptConsistent: true,
          visualAccepted: true,
          visualReviewConfidence: 0.95,
        },
        events: [{ eventKey: 'phase3:task-completed:1', type: 'task_completed', summary: '任务已完成' }],
        now,
      }

      const first = await repository.completeAgentTaskTransition(fixture.actorId, final.fence, completion)
      const replay = await repository.completeAgentTaskTransition(fixture.actorId, final.fence, completion)

      expect(first).toMatchObject({ taskRun: { status: 'completed' } })
      expect(replay).toEqual(first)
      const events = await admin.query<{ count: number }>(
        `select count(*)::int as count from app.agent_task_events
         where task_run_id=$1 and event_key='phase3:task-completed:1'`,
        [final.run.id],
      )
      expect(events.rows[0]).toEqual({ count: 1 })
    } finally {
      await admin.query('delete from auth.users where id=$1', [fixture.actorId])
    }
  })
})
