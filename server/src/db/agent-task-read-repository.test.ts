import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import type { AgentTaskRunBounds } from '../types.js'
import type { ProjectSchema } from '../validation.js'
import { createAgentTaskRunFixture, ensureAgentTaskWorkspace } from './agent-task-test-fixture.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const pgRepository = runtimeDatabaseUrl ? createPgRepository({ DATABASE_URL: runtimeDatabaseUrl } as AppEnv) : null
const now = new Date('2026-08-04T00:00:00.000Z')
const repositorySource = readFileSync(new URL('./repository.ts', import.meta.url), 'utf8')
const repositoryTypes = readFileSync(new URL('../types.ts', import.meta.url), 'utf8')
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

async function seedProject() {
  if (!admin || !pgRepository) throw new Error('Agent task repository integration database is unavailable')
  const actorId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  const project = await pgRepository.createProject(actorId, { name: 'Task read integration', schema: baseSchema })
  return { actorId, projectId: project.id }
}

function taskInput(projectId: string) {
  return {
    projectId,
    conversationId: randomUUID(),
    taskId: randomUUID(),
    idempotencyKey: randomUUID(),
    binding: {
      provider: 'openai-compatible',
      model: 'kernel-model',
      profileId: 'profile-1',
      configDigest: 'a'.repeat(64),
    },
    bounds,
    taskStartDocumentRevision: 1,
    planningInput: {
      purpose: 'planning',
      prompt: 'Create a dashboard',
      attachmentIds: [],
      providerInputSnapshot: {
        systemPrompt: 'Plan the dashboard',
        userText: 'Create a dashboard',
        trace: {
          promptBundleId: 'agent-task-planner',
          promptBundleVersion: '1',
          promptBundleHash: 'b'.repeat(64),
          skills: [],
        },
        images: [],
      },
    },
    now,
  }
}

describe('Agent task read and continuation repository contract', () => {
  it.each(['getAgentTaskRunDetail', 'listAgentTaskEvents', 'continueAgentTaskRun'])(
    'exposes %s through the repository interface and implementation',
    method => {
      expect(repositoryTypes).toContain(`${method}?`)
      expect(repositorySource).toContain(`${method}(`)
    },
  )

  it('binds frozen planning input to both task and initial transition digests', () => {
    const start = repositorySource.indexOf('createAgentTaskRun(')
    const source = repositorySource.slice(start, repositorySource.indexOf('getAgentTaskRun(', start))

    expect(source).toMatch(/requestDigest[\s\S]*planningInput/)
    expect(source).toMatch(/payload:\s*planningInput/)
  })

  it('reads event pages strictly after the cursor in ascending sequence order', () => {
    const start = repositorySource.indexOf('listAgentTaskEvents(')
    const source = repositorySource.slice(start, repositorySource.indexOf('continueAgentTaskRun(', start))

    expect(source).toMatch(/gt\(agentTaskEvents\.seq,\s*afterSeq\)/)
    expect(source).toMatch(/orderBy\(asc\(agentTaskEvents\.seq\)\)/)
    expect(source).toMatch(/\.limit\(limit\)/)
  })

  it('appends continuation input to the latest frozen clarification history and persisted waiting question', () => {
    const start = repositorySource.indexOf('continueAgentTaskRun(')
    const source = repositorySource.slice(start, repositorySource.indexOf('enqueueAgentTaskTransition(', start))

    expect(source).toMatch(/latestPlanning/)
    expect(source).toMatch(/waitingEvent/)
    expect(source).toMatch(/question\.id\s*!==\s*input\.questionId/)
    expect(source).toMatch(/clarificationHistory/)
    expect(source).toMatch(/attachmentIds/)
    expect(source).toMatch(/imageInputs/)
    expect(source).toMatch(/payload:\s*transitionInput/)
  })
})

describeWithDatabase('Agent task aggregate and continuation repository', () => {
  afterAll(async () => {
    await admin?.end()
  })

  it('freezes planner input in the first transition and binds it to task idempotency', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun) throw new Error('Agent task repository is unavailable')
    const fixture = await seedProject()
    try {
      const idempotencyKey = randomUUID()
      const input = {
        ...taskInput(fixture.projectId),
        idempotencyKey,
        planningInput: {
          prompt: 'Create a sales dashboard',
          attachmentIds: ['asset-1'],
          selection: { nodeIds: ['selected-panel'] },
          projectContextRevision: 3,
        },
      }
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, input)
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')

      const persisted = await admin.query<{ input_json: Record<string, unknown> }>(
        `select input_json from app.agent_task_transitions where task_run_id=$1 and transition_key='planning:1'`,
        [run.id],
      )
      expect(persisted.rows[0]?.input_json).toEqual(input.planningInput)
      await expect(
        createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, {
          ...input,
          planningInput: { ...input.planningInput, prompt: 'Create a different dashboard' },
        }),
      ).resolves.toBe('conflict')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('atomically binds the V2 workspace task projection and inserts no run on a conflicting binding', async () => {
    if (!admin || !pgRepository?.createAgentTaskRun) throw new Error('Agent task repository is unavailable')
    const fixture = await seedProject()
    const input = taskInput(fixture.projectId)
    try {
      await ensureAgentTaskWorkspace(admin, fixture.actorId, input)
      const created = await pgRepository.createAgentTaskRun(fixture.actorId, input)
      if (!created || typeof created === 'string') throw new Error('Agent task run fixture could not be created')
      const bound = await admin.query<{ task_run_id: string; revision: number }>(
        `select task->>'taskRunId' as task_run_id, workspace.revision
         from app.agent_workspaces workspace,
         jsonb_array_elements(workspace.payload->'conversations') conversation,
         jsonb_array_elements(conversation->'tasks') task
         where workspace.owner_id=$1 and workspace.project_id=$2
           and conversation->>'id'=$3 and task->>'id'=$4`,
        [fixture.actorId, fixture.projectId, input.conversationId, input.taskId],
      )
      expect(bound.rows[0]).toEqual({ task_run_id: created.id, revision: 2 })

      const conflicting = taskInput(fixture.projectId)
      const otherRunId = randomUUID()
      await ensureAgentTaskWorkspace(admin, fixture.actorId, conflicting, otherRunId)
      await expect(pgRepository.createAgentTaskRun(fixture.actorId, conflicting)).resolves.toBe('conflict')
      const orphanCount = await admin.query<{ count: number }>(
        'select count(*)::int as count from app.agent_task_runs where project_id=$1 and task_id=$2',
        [fixture.projectId, conflicting.taskId],
      )
      expect(orphanCount.rows[0]?.count).toBe(0)

      const crashInput = { ...taskInput(fixture.projectId), planningInput: { forceRollback: true } }
      await ensureAgentTaskWorkspace(admin, fixture.actorId, crashInput)
      await admin.query(`
        create function app.test_fail_agent_planning_insert() returns trigger language plpgsql as $$
        begin
          if new.input_json->>'forceRollback' = 'true' then raise exception 'forced planning insert rollback'; end if;
          return new;
        end; $$;
        create trigger test_fail_agent_planning_insert before insert on app.agent_task_transitions
        for each row execute function app.test_fail_agent_planning_insert();
      `)
      try {
        await expect(pgRepository.createAgentTaskRun(fixture.actorId, crashInput)).rejects.toThrow()
      } finally {
        await admin.query(`
          drop trigger if exists test_fail_agent_planning_insert on app.agent_task_transitions;
          drop function if exists app.test_fail_agent_planning_insert();
        `)
      }
      const rolledBack = await admin.query<{ run_count: number; task_run_id: string | null }>(
        `select
          (select count(*)::int from app.agent_task_runs where project_id=$1 and task_id=$2) as run_count,
          task->>'taskRunId' as task_run_id
         from app.agent_workspaces workspace,
         jsonb_array_elements(workspace.payload->'conversations') conversation,
         jsonb_array_elements(conversation->'tasks') task
         where workspace.owner_id=$3 and workspace.project_id=$1
           and conversation->>'id'=$4 and task->>'id'=$2`,
        [fixture.projectId, crashInput.taskId, fixture.actorId, crashInput.conversationId],
      )
      expect(rolledBack.rows[0]).toEqual({ run_count: 0, task_run_id: null })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('returns an event page and tail watermark from one repeatable-read snapshot during concurrent append', async () => {
    if (!admin || !pgRepository?.listAgentTaskEventPage || !pgRepository.appendAgentTaskEvent) {
      throw new Error('Agent task event page repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, taskInput(fixture.projectId))
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      await pgRepository.appendAgentTaskEvent(fixture.actorId, run.id, {
        eventKey: 'snapshot:initial',
        type: 'step_started',
        summary: 'Initial event',
        now,
      })
      const [page] = await Promise.all([
        pgRepository.listAgentTaskEventPage(fixture.actorId, fixture.projectId, run.id, {
          afterSeq: 0,
          limit: 100,
        }),
        ...Array.from({ length: 8 }, (_, index) =>
          pgRepository.appendAgentTaskEvent!(fixture.actorId, run.id, {
            eventKey: `snapshot:concurrent:${index}`,
            type: 'step_started',
            summary: `Concurrent event ${index}`,
            now: new Date(now.getTime() + index + 1),
          }),
        ),
      ])
      expect(page).not.toBeNull()
      expect(page!.latestEventSequence).toBeGreaterThanOrEqual(page!.events.at(-1)?.seq ?? 0)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('reads run, active plan, and event tail from one snapshot during atomic planning completion', async () => {
    if (
      !admin ||
      !pgRepository?.getAgentTaskRunDetail ||
      !pgRepository.claimAgentTaskTransition ||
      !pgRepository.completeAgentTaskTransition
    ) {
      throw new Error('Agent task detail repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, taskInput(fixture.projectId))
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const claimed = await pgRepository.claimAgentTaskTransition(
        `detail-snapshot-${randomUUID()}`,
        now,
        new Date(now.getTime() + 30_000),
        ['planning'],
      )
      if (!claimed?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
      const fence = {
        kind: 'transition' as const,
        transitionId: claimed.id,
        workerId: claimed.leaseOwner!,
        leaseGeneration: claimed.leaseGeneration,
        leaseToken: claimed.leaseToken,
      }
      const [detail] = await Promise.all([
        pgRepository.getAgentTaskRunDetail(fixture.actorId, fixture.projectId, run.id),
        pgRepository.completeAgentTaskTransition(fixture.actorId, fence, {
          status: 'completed',
          taskRunPatch: { status: 'running' },
          plan: {
            summary: 'Atomic plan',
            assumptions: [],
            verification: {},
            steps: [{ id: 'atomic-step', ordinal: 1, title: 'Atomic step', intent: {} }],
          },
          events: [
            {
              eventKey: 'atomic-plan-created',
              type: 'plan_created',
              summary: 'Atomic plan created',
            },
          ],
          nextTransition: {
            stepOrdinal: 1,
            kind: 'step_action',
            transitionKey: 'atomic-step-action',
          },
          now,
        }),
      ])
      expect(detail).not.toBeNull()
      if (detail!.activePlan) {
        expect(detail).toMatchObject({ run: { activePlanVersion: 1 }, latestEventSequence: 1 })
      } else {
        expect(detail).toMatchObject({ run: { activePlanVersion: 0 }, latestEventSequence: 0 })
      }
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('reads only the active plan and its steps with the latest durable event sequence', async () => {
    if (
      !admin ||
      !pgRepository?.createAgentTaskRun ||
      !pgRepository.createAgentTaskPlan ||
      !pgRepository.appendAgentTaskEvent ||
      !pgRepository.getAgentTaskRunDetail
    ) {
      throw new Error('Agent task aggregate repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, taskInput(fixture.projectId))
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      await pgRepository.createAgentTaskPlan(fixture.actorId, run.id, {
        summary: 'Persisted plan',
        assumptions: ['Existing canvas'],
        verification: { preview: true },
        steps: [
          { id: 'layout', ordinal: 1, title: 'Plan layout', intent: { purpose: 'layout' } },
          { id: 'bind', ordinal: 2, title: 'Bind data', intent: { purpose: 'data' } },
        ],
        now,
      })
      await pgRepository.appendAgentTaskEvent(fixture.actorId, run.id, {
        eventKey: 'plan:created',
        type: 'plan_created',
        summary: 'Created a two-step plan',
        publicPayload: { stepCount: 2 },
        now,
      })

      const detail = await pgRepository.getAgentTaskRunDetail(fixture.actorId, fixture.projectId, run.id)

      expect(detail?.run.id).toBe(run.id)
      expect(detail?.activePlan?.plan).toMatchObject({ version: 1, summary: 'Persisted plan' })
      expect(detail?.activePlan?.steps.map(step => [step.ordinal, step.semanticStepKey])).toEqual([
        [1, 'layout'],
        [2, 'bind'],
      ])
      expect(detail?.latestEventSequence).toBe(1)
      expect(detail?.waitingReason).toBeNull()
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('reads events strictly after the cursor, in sequence order, and respects the requested limit', async () => {
    if (
      !admin ||
      !pgRepository?.createAgentTaskRun ||
      !pgRepository.appendAgentTaskEvent ||
      !pgRepository.listAgentTaskEvents
    ) {
      throw new Error('Agent task event repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, taskInput(fixture.projectId))
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      for (const sequence of [1, 2, 3]) {
        await pgRepository.appendAgentTaskEvent(fixture.actorId, run.id, {
          eventKey: `event:${sequence}`,
          type: 'step_started',
          summary: `Activity ${sequence}`,
          publicPayload: { sequence },
          technicalPayload: { receipt: `receipt-${sequence}` },
          now: new Date(now.getTime() + sequence),
        })
      }

      const page = await pgRepository.listAgentTaskEvents(fixture.actorId, fixture.projectId, run.id, {
        afterSeq: 1,
        limit: 1,
      })

      expect(page?.map(event => event.seq)).toEqual([2])
      expect(page?.[0]?.technicalPayload).toEqual({ receipt: 'receipt-2' })
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('continues a waiting planner question on the same run exactly once', async () => {
    if (
      !admin ||
      !pgRepository?.createAgentTaskRun ||
      !pgRepository.claimAgentTaskTransition ||
      !pgRepository.completeAgentTaskTransition ||
      !pgRepository.continueAgentTaskRun ||
      !pgRepository.getAgentTaskRunDetail
    ) {
      throw new Error('Agent task continuation repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, taskInput(fixture.projectId))
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const workerId = 'planner-waiting-test'
      const transition = await pgRepository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 30_000))
      if (!transition?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
      const waiting = await pgRepository.completeAgentTaskTransition(
        fixture.actorId,
        {
          transitionId: transition.id,
          workerId,
          leaseGeneration: transition.leaseGeneration,
          leaseToken: transition.leaseToken,
        },
        {
          status: 'completed',
          output: { decision: 'ask_user' },
          taskRunPatch: { status: 'waiting_user', currentTransitionKey: null },
          events: [
            {
              eventKey: 'planner:question:1',
              type: 'waiting_user',
              summary: '请选择数据来源。',
              publicPayload: { question: { id: 'question-1', text: '请选择数据来源。' } },
            },
          ],
          now,
        },
      )
      if (typeof waiting === 'string') throw new Error('Waiting transition fixture could not be completed')

      const idempotencyKey = randomUUID()
      const first = await pgRepository.continueAgentTaskRun(fixture.actorId, {
        projectId: fixture.projectId,
        taskRunId: run.id,
        idempotencyKey,
        questionId: 'question-1',
        response: '使用示例数据。',
        attachmentIds: [],
        imageInputs: [],
        now: new Date(now.getTime() + 1_000),
      })
      const replay = await pgRepository.continueAgentTaskRun(fixture.actorId, {
        projectId: fixture.projectId,
        taskRunId: run.id,
        idempotencyKey,
        questionId: 'question-1',
        response: '使用示例数据。',
        attachmentIds: [],
        imageInputs: [],
        now: new Date(now.getTime() + 2_000),
      })

      expect(first).not.toBeNull()
      expect(typeof first).not.toBe('string')
      expect(replay).not.toBeNull()
      expect(typeof replay).not.toBe('string')
      if (!first || typeof first === 'string' || !replay || typeof replay === 'string') return
      expect(replay.transition.id).toBe(first.transition.id)
      expect(first.taskRun).toMatchObject({ id: run.id, status: 'planning' })
      expect(first.transition).toMatchObject({
        taskRunId: run.id,
        kind: 'planning',
        input: {
          purpose: 'planning',
          prompt: 'Create a dashboard',
          attachmentIds: [],
          providerInputSnapshot: {
            systemPrompt: 'Plan the dashboard',
            userText: 'Create a dashboard',
          },
          clarificationHistory: [
            {
              question: { id: 'question-1', text: '请选择数据来源。' },
              response: '使用示例数据。',
              attachmentIds: [],
              images: [],
            },
          ],
        },
      })

      const secondWorkerId = 'planner-second-question-test'
      const secondClaim = await pgRepository.claimAgentTaskTransition(
        secondWorkerId,
        new Date(now.getTime() + 3_000),
        new Date(now.getTime() + 33_000),
        ['planning'],
      )
      if (!secondClaim?.leaseToken) throw new Error('Second planning transition could not be claimed')
      const secondWaiting = await pgRepository.completeAgentTaskTransition(
        fixture.actorId,
        {
          transitionId: secondClaim.id,
          workerId: secondWorkerId,
          leaseGeneration: secondClaim.leaseGeneration,
          leaseToken: secondClaim.leaseToken,
        },
        {
          status: 'completed',
          output: { decision: 'ask_user' },
          taskRunPatch: { status: 'waiting_user', currentTransitionKey: null },
          events: [
            {
              eventKey: 'planner:question:2',
              type: 'waiting_user',
              summary: '请补充参考图。',
              publicPayload: { question: { id: 'question-2', text: '请补充参考图。' } },
            },
          ],
          now: new Date(now.getTime() + 3_500),
        },
      )
      if (typeof secondWaiting === 'string') throw new Error('Second waiting transition could not be completed')
      const answerImageId = randomUUID()
      const secondIdempotencyKey = randomUUID()
      const secondInput = {
        projectId: fixture.projectId,
        taskRunId: run.id,
        idempotencyKey: secondIdempotencyKey,
        questionId: 'question-2',
        response: '使用补充截图。',
        attachmentIds: [answerImageId],
        imageInputs: [{ assetId: answerImageId, sha256: '9'.repeat(64) }],
        now: new Date(now.getTime() + 4_000),
      }
      const second = await pgRepository.continueAgentTaskRun(fixture.actorId, secondInput)
      const secondReplay = await pgRepository.continueAgentTaskRun(fixture.actorId, {
        ...secondInput,
        now: new Date(now.getTime() + 5_000),
      })
      if (!second || typeof second === 'string' || !secondReplay || typeof secondReplay === 'string') {
        throw new Error('Second clarification continuation could not be persisted')
      }
      expect(secondReplay.transition.id).toBe(second.transition.id)
      expect(second.transition.input).toMatchObject({
        clarificationHistory: [
          {
            question: { id: 'question-1' },
            response: '使用示例数据。',
            attachmentIds: [],
          },
          {
            question: { id: 'question-2' },
            response: '使用补充截图。',
            attachmentIds: [answerImageId],
            images: [{ assetId: answerImageId, sha256: '9'.repeat(64) }],
          },
        ],
      })
      const planningTransitions = await admin.query<{ count: number }>(
        `select count(*)::int as count from app.agent_task_transitions
         where task_run_id=$1 and kind='planning'`,
        [run.id],
      )
      expect(planningTransitions.rows[0]?.count).toBe(3)

      const detail = await pgRepository.getAgentTaskRunDetail(fixture.actorId, fixture.projectId, run.id)
      expect(detail?.run.status).toBe('planning')
      expect(detail?.activePlan).toBeNull()
      expect(detail?.waitingReason).toBeNull()
      expect(detail?.latestEventSequence).toBe(2)
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('rejects a changed answer replay without advancing transition generation', async () => {
    if (
      !admin ||
      !pgRepository?.createAgentTaskRun ||
      !pgRepository.appendAgentTaskEvent ||
      !pgRepository.continueAgentTaskRun
    ) {
      throw new Error('Agent task continuation repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, taskInput(fixture.projectId))
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      await pgRepository.appendAgentTaskEvent(fixture.actorId, run.id, {
        eventKey: 'planner:question:changed-answer',
        type: 'waiting_user',
        summary: 'Choose an answer.',
        publicPayload: { question: { id: 'question-1', text: 'Choose an answer.' } },
        now,
      })
      await admin.query(
        `update app.agent_task_runs set status='waiting_user', current_transition_key=null where id=$1`,
        [run.id],
      )
      await admin.query(
        `update app.agent_task_transitions set status='completed', completed_at=$2 where task_run_id=$1`,
        [run.id, now],
      )
      const idempotencyKey = randomUUID()
      const input = {
        projectId: fixture.projectId,
        taskRunId: run.id,
        idempotencyKey,
        questionId: 'question-1',
        response: 'Answer A',
        attachmentIds: [],
        imageInputs: [],
        now,
      }
      await expect(
        pgRepository.continueAgentTaskRun(fixture.actorId, { ...input, questionId: 'forged-question' }),
      ).resolves.toBe('invalid_state')
      await pgRepository.continueAgentTaskRun(fixture.actorId, input)
      const before = await admin.query<{ next_transition_generation: number }>(
        'select next_transition_generation from app.agent_task_runs where id=$1',
        [run.id],
      )

      await expect(
        pgRepository.continueAgentTaskRun(fixture.actorId, { ...input, response: 'Answer B' }),
      ).resolves.toBe('conflict')
      const after = await admin.query<{ next_transition_generation: number }>(
        'select next_transition_generation from app.agent_task_runs where id=$1',
        [run.id],
      )
      expect(after.rows[0]).toEqual(before.rows[0])
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })

  it('continues an execution-step question on the same active plan and step exactly once', async () => {
    if (
      !admin ||
      !pgRepository?.claimAgentTaskTransition ||
      !pgRepository.completeAgentTaskTransition ||
      !pgRepository.continueAgentTaskRun ||
      !pgRepository.appendAgentTaskEvent
    ) {
      throw new Error('Agent execution continuation repository is unavailable')
    }
    const fixture = await seedProject()
    try {
      const run = await createAgentTaskRunFixture(admin, pgRepository, fixture.actorId, taskInput(fixture.projectId))
      if (!run || typeof run === 'string') throw new Error('Agent task run fixture could not be created')
      const workerId = `execution-question-${randomUUID()}`
      const claim = await pgRepository.claimAgentTaskTransition(workerId, now, new Date(now.getTime() + 30_000), [
        'planning',
      ])
      if (!claim?.leaseToken) throw new Error('Planning transition fixture could not be claimed')
      const planned = await pgRepository.completeAgentTaskTransition(
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
            summary: 'Execution question plan',
            assumptions: [],
            verification: {},
            steps: [{ id: 'execution-question-step', ordinal: 1, title: 'Resolve exact nodes', intent: {} }],
          },
          nextTransition: {
            kind: 'step_action',
            stepOrdinal: 1,
            transitionKey: 'execution-question:initial-action',
          },
          now,
        },
      )
      if (!planned || typeof planned === 'string' || !planned.nextTransition?.stepId) {
        throw new Error('Execution question plan fixture could not be created')
      }
      const stepId = planned.nextTransition.stepId
      await pgRepository.appendAgentTaskEvent(fixture.actorId, run.id, {
        eventKey: 'execution-question:waiting',
        stepId,
        type: 'waiting_user',
        summary: '请确认需要删除的节点。',
        publicPayload: { question: { id: 'execution-question-1', text: '请确认需要删除的节点。' } },
        now: new Date(now.getTime() + 1_000),
      })
      await admin.query(
        `update app.agent_task_transitions
         set status='completed', completed_at=$2, updated_at=$2
         where id=$1`,
        [planned.nextTransition.id, new Date(now.getTime() + 1_000)],
      )
      await admin.query(`update app.agent_task_steps set status='verifying' where id=$1`, [stepId])
      await admin.query(
        `update app.agent_task_runs
         set status='waiting_user', current_transition_key=null, updated_at=$2
         where id=$1`,
        [run.id, new Date(now.getTime() + 1_000)],
      )

      const idempotencyKey = randomUUID()
      const input = {
        projectId: fixture.projectId,
        taskRunId: run.id,
        idempotencyKey,
        questionId: 'execution-question-1',
        response: '删除三个占位节点。',
        attachmentIds: [],
        imageInputs: [],
        now: new Date(now.getTime() + 2_000),
      }
      const first = await pgRepository.continueAgentTaskRun(fixture.actorId, input)
      const replay = await pgRepository.continueAgentTaskRun(fixture.actorId, {
        ...input,
        now: new Date(now.getTime() + 3_000),
      })
      if (!first || typeof first === 'string' || !replay || typeof replay === 'string') {
        throw new Error('Execution question continuation could not be persisted')
      }

      expect(replay.transition.id).toBe(first.transition.id)
      expect(first.taskRun).toMatchObject({ status: 'running', activePlanVersion: 1 })
      expect(first.transition).toMatchObject({
        kind: 'step_action',
        stepId,
        input: {
          recoveryClass: 'user_action_resolved',
          userClarification: {
            question: { id: 'execution-question-1', text: '请确认需要删除的节点。' },
            response: '删除三个占位节点。',
            attachmentIds: [],
            images: [],
          },
        },
      })
      const resumedStep = await admin.query<{ status: string }>('select status from app.agent_task_steps where id=$1', [
        stepId,
      ])
      expect(resumedStep.rows[0]?.status).toBe('revising')
    } finally {
      await admin.query('delete from auth.users where id = $1', [fixture.actorId])
    }
  })
})
