import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import type { AgentSpikeOperationBinding } from '../types.js'
import type { ProjectSchema } from '../validation.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip

const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const repository = runtimeDatabaseUrl ? createPgRepository(repositoryEnv(runtimeDatabaseUrl)) : null

const baseSchema: ProjectSchema = {
  formatVersion: 1,
  editorSchema: {
    version: '1.0.0',
    componentsTree: [
      {
        id: 'page-home-root',
        docId: 'page-home',
        fileName: 'home',
        componentName: 'Root',
        isRoot: true,
        meta: { easyDashboard: { pageId: 'page-home' } },
        $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
        children: [],
      },
    ],
  },
  presentation: {
    startPageId: 'page-home',
    theme: { mode: 'dark', tokens: {} },
  },
}

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
  if (!admin) throw new Error('Agent dispatch integration test requires an administrator database')
  const actorId = randomUUID()
  const spaceId = randomUUID()
  const projectId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  await admin.query(
    `insert into app.spaces (id, kind, name, personal_owner_id, created_by)
     values ($1, 'personal', 'Dispatch integration', $2, $2)`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.space_members (space_id, user_id, role)
     values ($1, $2, 'owner')`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.projects (id, owner_id, space_id, name, draft_schema)
     values ($1, $2, $3, 'Dispatch integration', $4::jsonb)`,
    [projectId, actorId, spaceId, JSON.stringify(baseSchema)],
  )
  await admin.query(
    `insert into app.project_members (project_id, user_id, role, created_by) values ($1, $2, 'owner', $2)`,
    [projectId, actorId],
  )
  return { actorId, projectId }
}

async function cleanupActor(actorId: string) {
  await admin?.query('delete from auth.users where id = $1', [actorId])
}

async function issueOperation(actorId: string, projectId: string): Promise<AgentSpikeOperationBinding> {
  if (!repository) throw new Error('Agent dispatch integration test requires a runtime database')
  const operationId = randomUUID()
  const binding = {
    projectId,
    taskId: `task-${operationId}`,
    stageId: `stage-${operationId}`,
    executorId: 'dispatch-integration-executor',
    operationId,
  }
  const issued = await repository.issueAgentSpikeOperation(actorId, {
    ...binding,
    grantJti: randomUUID(),
    baseDraftVersion: 1,
    inputDigest: 'a'.repeat(64),
    executorInput: {
      contractVersion: 'easy-dashboard.executor.v1',
      operationId,
      projectId,
    },
    compatibility: {
      runtimeSha256: 'b'.repeat(64),
      coreSha256: 'c'.repeat(64),
      rendererSha256: 'd'.repeat(64),
      dashboardAgentHostSha256: 'e'.repeat(64),
      materialManifestSha256: 'f'.repeat(64),
    },
    expiresAt: new Date(Date.now() + 60_000),
  })
  if (!issued || typeof issued === 'string' || issued.status !== 'issued') {
    throw new Error(`Agent dispatch operation fixture could not be issued: ${String(issued)}`)
  }
  return binding
}

async function enqueueDispatch(actorId: string, binding: AgentSpikeOperationBinding, now: Date) {
  if (!repository?.enqueueAgentRunDispatch) throw new Error('Agent run dispatch repository is unavailable')
  const dispatch = await repository.enqueueAgentRunDispatch(actorId, {
    projectId: binding.projectId,
    conversationId: `conversation-${binding.operationId}`,
    taskId: binding.taskId,
    operationId: binding.operationId,
    now,
  })
  if (!dispatch) throw new Error('Agent run dispatch fixture could not be enqueued')
  return dispatch
}

async function claim(workerId: string, now: Date, leaseUntil: Date) {
  if (!repository?.claimAgentRunDispatch) throw new Error('Agent run dispatch claim repository is unavailable')
  return repository.claimAgentRunDispatch(workerId, now, leaseUntil)
}

async function requestControl(
  actorId: string,
  binding: AgentSpikeOperationBinding,
  action: 'pause' | 'cancel',
  now: Date,
) {
  if (!repository?.controlAgentRunDispatch) throw new Error('Agent run dispatch control repository is unavailable')
  const controlled = await repository.controlAgentRunDispatch(
    actorId,
    binding.projectId,
    binding.operationId,
    action,
    now,
  )
  if (!controlled || controlled === 'invalid_state') {
    throw new Error(`Agent run dispatch fixture could not request ${action}`)
  }
  return controlled
}

async function commitOperation(actorId: string, binding: AgentSpikeOperationBinding) {
  if (!repository) throw new Error('Agent dispatch integration test requires a runtime database')
  const prepared = await repository.prepareAgentSpikeOperation(actorId, binding, {
    candidateSchema: structuredClone(baseSchema),
    hostReceipt: { schemaVersion: 1, callId: binding.operationId, status: 'applied' },
    evidence: { rendererReady: true },
  })
  if (!prepared || typeof prepared === 'string' || prepared.status !== 'prepared') {
    throw new Error(`Agent dispatch operation fixture could not be prepared: ${String(prepared)}`)
  }
  const committed = await repository.commitAgentSpikeStage(actorId, binding)
  if (!committed || typeof committed === 'string' || committed.status !== 'committed') {
    throw new Error(`Agent dispatch operation fixture could not be committed: ${String(committed)}`)
  }
}

describeWithDatabase('agent run dispatch PostgreSQL integration', () => {
  afterAll(async () => {
    await admin?.end()
  })

  it('allows only one worker to claim the same dispatch concurrently', async () => {
    const fixture = await seedProject()
    const now = new Date()
    const leaseUntil = new Date(now.getTime() + 30_000)
    try {
      const binding = await issueOperation(fixture.actorId, fixture.projectId)
      const dispatch = await enqueueDispatch(fixture.actorId, binding, now)

      const claims = await Promise.all([
        claim(`worker-${randomUUID()}`, now, leaseUntil),
        claim(`worker-${randomUUID()}`, now, leaseUntil),
      ])

      expect(claims.filter(Boolean).map(result => result?.id)).toEqual([dispatch.id])
      expect(claims.find(Boolean)).toMatchObject({ kind: 'run', waitingReason: null })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('atomically creates and replays the project workspace and initial planning outbox', async () => {
    const fixture = await seedProject()
    const projectId = randomUUID()
    const idempotencyKey = randomUUID()
    const input = {
      project: { id: projectId, name: 'Initial outbox integration', schema: baseSchema },
      workspacePayload: { version: 1, projectId, conversations: [] },
      dispatch: {
        conversationId: 'conversation-initial',
        taskId: 'task-initial',
        operationId: 'operation-initial',
        waitingForUpload: false,
      },
      idempotencyKey,
      inputDigest: '1'.repeat(64),
    }
    try {
      if (!repository?.startAgentProject) throw new Error('Agent start repository is unavailable')
      const created = await repository.startAgentProject(fixture.actorId, input)
      const replay = await repository.startAgentProject(fixture.actorId, input)
      const conflict = await repository.startAgentProject(fixture.actorId, {
        ...input,
        inputDigest: '2'.repeat(64),
      })

      expect(created).not.toBe('conflict')
      expect(replay).toEqual(created)
      expect(conflict).toBe('conflict')
      if (created === 'conflict') throw new Error('Initial Agent start unexpectedly conflicted')
      expect(created.dispatch).toMatchObject({
        kind: 'initial',
        state: 'queued',
        desiredState: 'running',
        waitingReason: null,
        operationId: input.dispatch.operationId,
      })
      const persisted = await admin!.query<{ projects: string; workspaces: string; dispatches: string }>(
        `select
           (select count(*)::text from app.projects where owner_id = $1 and agent_start_idempotency_key = $2) as projects,
           (select count(*)::text from app.agent_workspaces where owner_id = $1 and project_id = $3) as workspaces,
           (select count(*)::text from app.agent_run_dispatches where actor_id = $1 and project_id = $3 and kind = 'initial') as dispatches`,
        [fixture.actorId, idempotencyKey, projectId],
      )
      expect(persisted.rows[0]).toEqual({ projects: '1', workspaces: '1', dispatches: '1' })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('atomically creates and replays a semantic project start without a legacy dispatch', async () => {
    const fixture = await seedProject()
    const projectId = randomUUID()
    const idempotencyKey = randomUUID()
    const input = {
      project: { id: projectId, name: 'Semantic start integration', schema: baseSchema },
      workspacePayload: { version: 2, projectId, conversations: [] },
      createLegacyDispatch: false,
      idempotencyKey,
      inputDigest: '4'.repeat(64),
    }
    try {
      if (!repository?.startAgentProject) throw new Error('Agent start repository is unavailable')
      const created = await repository.startAgentProject(fixture.actorId, input)
      const replay = await repository.startAgentProject(fixture.actorId, input)

      expect(created).not.toBe('conflict')
      expect(replay).toEqual(created)
      if (created === 'conflict') throw new Error('Semantic Agent start unexpectedly conflicted')
      expect(created.dispatch).toBeUndefined()
      const persisted = await admin!.query<{ projects: string; workspaces: string; dispatches: string }>(
        `select
           (select count(*)::text from app.projects where owner_id = $1 and agent_start_idempotency_key = $2) as projects,
           (select count(*)::text from app.agent_workspaces where owner_id = $1 and project_id = $3) as workspaces,
           (select count(*)::text from app.agent_run_dispatches where actor_id = $1 and project_id = $3 and kind = 'initial') as dispatches`,
        [fixture.actorId, idempotencyKey, projectId],
      )
      expect(persisted.rows[0]).toEqual({ projects: '1', workspaces: '1', dispatches: '0' })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('releases only an initial upload wait and leaves later pauses untouched', async () => {
    const fixture = await seedProject()
    const projectId = randomUUID()
    const operationId = randomUUID()
    const input = {
      project: { id: projectId, name: 'Upload finalize integration', schema: baseSchema },
      workspacePayload: { version: 1, projectId, conversations: [] },
      dispatch: {
        conversationId: 'conversation-upload-finalize',
        taskId: 'task-upload-finalize',
        operationId,
        waitingForUpload: true,
      },
      idempotencyKey: randomUUID(),
      inputDigest: '3'.repeat(64),
    }
    try {
      if (!repository?.startAgentProject || !repository.finalizeAgentRunAttachments) {
        throw new Error('Agent upload finalization repository is unavailable')
      }
      const created = await repository.startAgentProject(fixture.actorId, input)
      if (created === 'conflict') throw new Error('Initial Agent start unexpectedly conflicted')
      expect(created.dispatch).toMatchObject({
        kind: 'initial',
        state: 'paused',
        desiredState: 'paused',
        waitingReason: 'upload',
      })

      const finalizedAt = new Date()
      const [first, replay] = await Promise.all([
        repository.finalizeAgentRunAttachments(fixture.actorId, projectId, operationId, finalizedAt),
        repository.finalizeAgentRunAttachments(fixture.actorId, projectId, operationId, finalizedAt),
      ])
      expect([first?.transitioned, replay?.transitioned].sort()).toEqual([false, true])
      expect(first?.dispatch).toMatchObject({ state: 'queued', desiredState: 'running', waitingReason: null })
      expect(replay?.dispatch).toMatchObject({ state: 'queued', desiredState: 'running', waitingReason: null })

      await admin!.query(
        `update app.agent_run_dispatches
         set state = 'paused', desired_state = 'paused', waiting_reason = 'user', error_code = 'waiting_user'
         where actor_id = $1 and project_id = $2 and operation_id = $3`,
        [fixture.actorId, projectId, operationId],
      )
      const userPause = await repository.finalizeAgentRunAttachments(
        fixture.actorId,
        projectId,
        operationId,
        new Date(finalizedAt.getTime() + 1_000),
      )
      expect(userPause).toMatchObject({
        transitioned: false,
        dispatch: { state: 'paused', desiredState: 'paused', waitingReason: 'user' },
      })

      await admin!.query(
        `update app.agent_run_dispatches
         set waiting_reason = null, error_code = null
         where actor_id = $1 and project_id = $2 and operation_id = $3`,
        [fixture.actorId, projectId, operationId],
      )
      const manualPause = await repository.finalizeAgentRunAttachments(
        fixture.actorId,
        projectId,
        operationId,
        new Date(finalizedAt.getTime() + 2_000),
      )
      expect(manualPause).toMatchObject({
        transitioned: false,
        dispatch: { state: 'paused', desiredState: 'paused', waitingReason: null },
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('allows only one active writer for a project', async () => {
    const fixture = await seedProject()
    const now = new Date()
    const leaseUntil = new Date(now.getTime() + 30_000)
    try {
      const first = await issueOperation(fixture.actorId, fixture.projectId)
      const second = await issueOperation(fixture.actorId, fixture.projectId)
      await enqueueDispatch(fixture.actorId, first, now)
      await enqueueDispatch(fixture.actorId, second, now)

      await Promise.all([
        claim(`worker-${randomUUID()}`, now, leaseUntil),
        claim(`worker-${randomUUID()}`, now, leaseUntil),
      ])

      const persisted = await admin!.query<{ state: string; count: string }>(
        `select state, count(*)::text as count
         from app.agent_run_dispatches
         where actor_id = $1 and project_id = $2
         group by state
         order by state`,
        [fixture.actorId, fixture.projectId],
      )
      expect(persisted.rows).toEqual([
        { state: 'queued', count: '1' },
        { state: 'running', count: '1' },
      ])
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('reconciles an expired running pause to paused and clears its lease', async () => {
    const fixture = await seedProject()
    const claimedAt = new Date()
    const leaseUntil = new Date(claimedAt.getTime() + 1_000)
    const reconcileAt = new Date(leaseUntil.getTime() + 1)
    try {
      const binding = await issueOperation(fixture.actorId, fixture.projectId)
      const dispatch = await enqueueDispatch(fixture.actorId, binding, claimedAt)
      const claimed = await claim(`worker-${randomUUID()}`, claimedAt, leaseUntil)
      if (!claimed) throw new Error('Agent run dispatch fixture could not be claimed')
      await requestControl(fixture.actorId, binding, 'pause', new Date(claimedAt.getTime() + 100))

      await claim(`reconciler-${randomUUID()}`, reconcileAt, new Date(reconcileAt.getTime() + 30_000))

      const persisted = await admin!.query<{
        state: string
        desired_state: string
        lease_owner: string | null
        lease_until: Date | null
      }>(
        `select state, desired_state, lease_owner, lease_until
         from app.agent_run_dispatches
         where id = $1`,
        [dispatch.id],
      )
      expect(persisted.rows[0]).toEqual({
        state: 'paused',
        desired_state: 'paused',
        lease_owner: null,
        lease_until: null,
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('reconciles an expired running pause with a committed operation to succeeded', async () => {
    const fixture = await seedProject()
    const claimedAt = new Date()
    const leaseUntil = new Date(claimedAt.getTime() + 1_000)
    const reconcileAt = new Date(leaseUntil.getTime() + 1)
    try {
      const binding = await issueOperation(fixture.actorId, fixture.projectId)
      await commitOperation(fixture.actorId, binding)
      const dispatch = await enqueueDispatch(fixture.actorId, binding, claimedAt)
      const claimed = await claim(`worker-${randomUUID()}`, claimedAt, leaseUntil)
      if (!claimed) throw new Error('Agent run dispatch fixture could not be claimed')
      await requestControl(fixture.actorId, binding, 'pause', new Date(claimedAt.getTime() + 100))

      await claim(`reconciler-${randomUUID()}`, reconcileAt, new Date(reconcileAt.getTime() + 30_000))

      const persisted = await admin!.query<{
        dispatch_state: string
        operation_status: string
        lease_owner: string | null
        lease_until: Date | null
      }>(
        `select
           dispatch.state as dispatch_state,
           operation.status as operation_status,
           dispatch.lease_owner,
           dispatch.lease_until
         from app.agent_run_dispatches dispatch
         join app.agent_spike_operations operation
           on operation.actor_id = dispatch.actor_id
          and operation.project_id = dispatch.project_id
          and operation.operation_id = dispatch.operation_id
         where dispatch.id = $1`,
        [dispatch.id],
      )
      expect(persisted.rows[0]).toEqual({
        dispatch_state: 'succeeded',
        operation_status: 'committed',
        lease_owner: null,
        lease_until: null,
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('atomically cancels an expired running dispatch and fails its issued operation as user canceled', async () => {
    const fixture = await seedProject()
    const claimedAt = new Date()
    const leaseUntil = new Date(claimedAt.getTime() + 1_000)
    const reconcileAt = new Date(leaseUntil.getTime() + 1)
    try {
      const binding = await issueOperation(fixture.actorId, fixture.projectId)
      const dispatch = await enqueueDispatch(fixture.actorId, binding, claimedAt)
      const claimed = await claim(`worker-${randomUUID()}`, claimedAt, leaseUntil)
      if (!claimed) throw new Error('Agent run dispatch fixture could not be claimed')
      await requestControl(fixture.actorId, binding, 'cancel', new Date(claimedAt.getTime() + 100))

      await claim(`reconciler-${randomUUID()}`, reconcileAt, new Date(reconcileAt.getTime() + 30_000))

      const persisted = await admin!.query<{
        dispatch_state: string
        lease_owner: string | null
        lease_until: Date | null
        operation_status: string
        outcome: Record<string, unknown>
      }>(
        `select
           dispatch.state as dispatch_state,
           dispatch.lease_owner,
           dispatch.lease_until,
           operation.status as operation_status,
           operation.outcome
         from app.agent_run_dispatches dispatch
         join app.agent_spike_operations operation
           on operation.actor_id = dispatch.actor_id
          and operation.project_id = dispatch.project_id
          and operation.operation_id = dispatch.operation_id
         where dispatch.id = $1`,
        [dispatch.id],
      )
      expect(persisted.rows[0]).toEqual({
        dispatch_state: 'canceled',
        lease_owner: null,
        lease_until: null,
        operation_status: 'failed_not_applied',
        outcome: { status: 'failed_not_applied', reason: 'user_canceled' },
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('reconciles cancellation of a committed operation to succeeded and never canceled', async () => {
    const fixture = await seedProject()
    const claimedAt = new Date()
    const leaseUntil = new Date(claimedAt.getTime() + 1_000)
    const reconcileAt = new Date(leaseUntil.getTime() + 1)
    try {
      const binding = await issueOperation(fixture.actorId, fixture.projectId)
      await commitOperation(fixture.actorId, binding)
      const dispatch = await enqueueDispatch(fixture.actorId, binding, claimedAt)
      const claimed = await claim(`worker-${randomUUID()}`, claimedAt, leaseUntil)
      if (!claimed) throw new Error('Agent run dispatch fixture could not be claimed')
      await requestControl(fixture.actorId, binding, 'cancel', new Date(claimedAt.getTime() + 100))

      await claim(`reconciler-${randomUUID()}`, reconcileAt, new Date(reconcileAt.getTime() + 30_000))

      const persisted = await admin!.query<{
        dispatch_state: string
        operation_status: string
        operation_outcome_status: string
      }>(
        `select
           dispatch.state as dispatch_state,
           operation.status as operation_status,
           operation.outcome ->> 'status' as operation_outcome_status
         from app.agent_run_dispatches dispatch
         join app.agent_spike_operations operation
           on operation.actor_id = dispatch.actor_id
          and operation.project_id = dispatch.project_id
          and operation.operation_id = dispatch.operation_id
         where dispatch.id = $1`,
        [dispatch.id],
      )
      expect(persisted.rows[0]).toEqual({
        dispatch_state: 'succeeded',
        operation_status: 'committed',
        operation_outcome_status: 'committed',
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })
})
