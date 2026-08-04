import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import type { ProjectSchema } from '../validation.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip

const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null

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

function withTitle(title: string): ProjectSchema {
  const schema = structuredClone(baseSchema)
  const editorSchema = schema.editorSchema as Record<string, unknown>
  const pages = editorSchema.componentsTree as Array<Record<string, unknown>>
  pages[0] = {
    ...pages[0],
    children: [
      {
        id: 'title',
        componentName: 'Text',
        props: { text: title },
        $dashboard: { rect: { x: 100, y: 120, width: 240, height: 60 } },
        children: [],
      },
    ],
  }
  return schema
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
  if (!admin) throw new Error('Agent spike integration test requires an administrator database')
  const actorId = randomUUID()
  const spaceId = randomUUID()
  const projectId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  await admin.query(
    `insert into app.spaces (id, kind, name, personal_owner_id, created_by)
     values ($1, 'personal', 'M0 integration', $2, $2)`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.space_members (space_id, user_id, role)
     values ($1, $2, 'owner')`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.projects (id, owner_id, space_id, name, draft_schema)
     values ($1, $2, $3, 'M0 integration', $4::jsonb)`,
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

function operationInput(projectId: string, operationId: string, grantJti: string) {
  return {
    projectId,
    taskId: `task-${operationId}`,
    stageId: `stage-${operationId}`,
    executorId: 'm0-document-executor',
    operationId,
    grantJti,
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
  }
}

describeWithDatabase('agent spike PostgreSQL integration', () => {
  afterAll(async () => {
    await admin?.end()
  })

  it('commits the candidate and durable outcome once across an idempotent retry', async () => {
    const fixture = await seedProject()
    const repository = createPgRepository(repositoryEnv(runtimeDatabaseUrl!))
    const operationId = randomUUID()
    const input = operationInput(fixture.projectId, operationId, randomUUID())
    const binding = {
      projectId: fixture.projectId,
      taskId: input.taskId,
      stageId: input.stageId,
      executorId: input.executorId,
      operationId,
    }

    try {
      const issued = await repository.issueAgentSpikeOperation(fixture.actorId, input)
      expect(issued).toMatchObject({ status: 'issued', operationId })

      const prepareInput = {
        candidateSchema: withTitle('Agent candidate'),
        hostReceipt: { schemaVersion: 1, callId: operationId, status: 'applied' },
        evidence: { rendererReady: true },
      }
      const prepared = await repository.prepareAgentSpikeOperation(fixture.actorId, binding, prepareInput)
      expect(prepared).toMatchObject({ status: 'prepared', operationId })
      await expect(repository.prepareAgentSpikeOperation(fixture.actorId, binding, prepareInput)).resolves.toEqual(
        prepared,
      )
      await expect(
        repository.prepareAgentSpikeOperation(fixture.actorId, binding, {
          ...prepareInput,
          hostReceipt: {
            ...prepareInput.hostReceipt,
            appliedAt: '2026-07-31T10:00:01.000Z',
          },
        }),
      ).resolves.toBe('integrity_conflict')

      const [first, retry] = await Promise.all([
        repository.commitAgentSpikeStage(fixture.actorId, binding),
        repository.commitAgentSpikeStage(fixture.actorId, binding),
      ])
      expect(first).toMatchObject({ status: 'committed', committedDraftVersion: 2 })
      expect(retry).toEqual(first)

      const persisted = await admin!.query<{
        draft_version: number
        title: string
        operation_status: string
        operation_count: string
      }>(
        `select
           project.draft_version,
           project.draft_schema #>> '{editorSchema,componentsTree,0,children,0,props,text}' as title,
           operation.status as operation_status,
           (
             select count(*)::text
             from app.agent_spike_operations counted
             where counted.actor_id = operation.actor_id
               and counted.operation_id = operation.operation_id
           ) as operation_count
         from app.projects project
         join app.agent_spike_operations operation on operation.project_id = project.id
         where project.id = $1 and operation.operation_id = $2`,
        [fixture.projectId, operationId],
      )
      expect(persisted.rows[0]).toEqual({
        draft_version: 2,
        title: 'Agent candidate',
        operation_status: 'committed',
        operation_count: '1',
      })
      await expect(
        admin!.query(
          `update app.agent_spike_operations
           set evidence = '{"rendererReady":false}'::jsonb, updated_at = clock_timestamp()
           where actor_id = $1 and operation_id = $2`,
          [fixture.actorId, operationId],
        ),
      ).rejects.toThrow(/terminal agent spike operations are immutable/)
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('rejects a stale prepared candidate without overwriting a manual save', async () => {
    const fixture = await seedProject()
    const repository = createPgRepository(repositoryEnv(runtimeDatabaseUrl!))
    const operationId = randomUUID()
    const input = operationInput(fixture.projectId, operationId, randomUUID())
    const binding = {
      projectId: fixture.projectId,
      taskId: input.taskId,
      stageId: input.stageId,
      executorId: input.executorId,
      operationId,
    }

    try {
      await repository.issueAgentSpikeOperation(fixture.actorId, input)
      await repository.prepareAgentSpikeOperation(fixture.actorId, binding, {
        candidateSchema: withTitle('Stale Agent candidate'),
        hostReceipt: { schemaVersion: 1, callId: operationId, status: 'applied' },
        evidence: { rendererReady: true },
      })

      const manual = await repository.saveDraft(fixture.actorId, fixture.projectId, 1, withTitle('Manual edit wins'))
      expect(manual).toMatchObject({ draftVersion: 2 })
      await expect(repository.commitAgentSpikeStage(fixture.actorId, binding)).resolves.toBe('conflict')

      const persisted = await admin!.query<{
        draft_version: number
        title: string
        operation_status: string
      }>(
        `select
           project.draft_version,
           project.draft_schema #>> '{editorSchema,componentsTree,0,children,0,props,text}' as title,
           operation.status as operation_status
         from app.projects project
         join app.agent_spike_operations operation on operation.project_id = project.id
         where project.id = $1 and operation.operation_id = $2`,
        [fixture.projectId, operationId],
      )
      expect(persisted.rows[0]).toEqual({
        draft_version: 2,
        title: 'Manual edit wins',
        operation_status: 'rejected_stale',
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('rolls back the project CAS when the durable outcome write fails', async () => {
    const fixture = await seedProject()
    const repository = createPgRepository(repositoryEnv(runtimeDatabaseUrl!))
    const operationId = randomUUID()
    const input = operationInput(fixture.projectId, operationId, randomUUID())
    const binding = {
      projectId: fixture.projectId,
      taskId: input.taskId,
      stageId: input.stageId,
      executorId: input.executorId,
      operationId,
    }

    await admin!.query(`
      create function app.m0_test_fail_committed_outcome()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.status = 'committed' then
          raise exception 'm0 injected durable outcome failure';
        end if;
        return new;
      end
      $$;
      create trigger m0_test_fail_committed_outcome
      before update on app.agent_spike_operations
      for each row
      when (new.operation_id = '${operationId}')
      execute function app.m0_test_fail_committed_outcome();
    `)

    try {
      await repository.issueAgentSpikeOperation(fixture.actorId, input)
      await repository.prepareAgentSpikeOperation(fixture.actorId, binding, {
        candidateSchema: withTitle('Must roll back'),
        hostReceipt: { schemaVersion: 1, callId: operationId, status: 'applied' },
        evidence: { rendererReady: true },
      })

      await expect(repository.commitAgentSpikeStage(fixture.actorId, binding)).rejects.toThrow()

      const persisted = await admin!.query<{
        draft_version: number
        operation_status: string
      }>(
        `select project.draft_version, operation.status as operation_status
         from app.projects project
         join app.agent_spike_operations operation on operation.project_id = project.id
         where project.id = $1 and operation.operation_id = $2`,
        [fixture.projectId, operationId],
      )
      expect(persisted.rows[0]).toEqual({
        draft_version: 1,
        operation_status: 'prepared',
      })
    } finally {
      await admin!.query('drop trigger if exists m0_test_fail_committed_outcome on app.agent_spike_operations')
      await admin!.query('drop function if exists app.m0_test_fail_committed_outcome()')
      await cleanupActor(fixture.actorId)
    }
  })
})
