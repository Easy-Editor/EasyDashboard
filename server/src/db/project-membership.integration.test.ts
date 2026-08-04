import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
const runtime = runtimeDatabaseUrl ? new Pool({ connectionString: runtimeDatabaseUrl }) : null
const repository = runtimeDatabaseUrl ? createPgRepository(repositoryEnv(runtimeDatabaseUrl)) : null

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

async function asActor<T>(actorId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!runtime) throw new Error('Runtime database is unavailable')
  const client = await runtime.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('app.actor_id', $1, true)`, [actorId])
    const result = await run(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

describeWithDatabase('project membership PostgreSQL integration', () => {
  afterAll(async () => {
    await runtime?.end()
    await admin?.end()
  })

  it('does not derive project access from a space membership and protects the final owner', async () => {
    if (!admin || !repository) throw new Error('Project membership integration database is unavailable')
    const ownerId = randomUUID()
    const collaboratorId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1), ($2)', [ownerId, collaboratorId])
    try {
      const project = await repository.createProject(ownerId, {
        name: 'Membership authority',
        schema: { componentsTree: [] },
      })
      if (!repository.startAgentProject) throw new Error('Agent project start repository is unavailable')
      const agentProjectId = randomUUID()
      const started = await repository.startAgentProject(ownerId, {
        project: { id: agentProjectId, name: 'Membership Agent start', schema: { componentsTree: [] } },
        workspacePayload: {},
        dispatch: {
          conversationId: randomUUID(),
          taskId: randomUUID(),
          operationId: randomUUID(),
          waitingForUpload: false,
        },
        idempotencyKey: randomUUID(),
        inputDigest: 'a'.repeat(64),
      })
      expect(started).not.toBe('conflict')
      await expect(repository.listProjectMembers(ownerId, agentProjectId)).resolves.toMatchObject([
        { userId: ownerId, role: 'owner' },
      ])
      await admin.query(
        `insert into app.space_members (space_id, user_id, role)
         select space_id, $2, 'editor' from app.projects where id = $1`,
        [project.id, collaboratorId],
      )

      await expect(repository.getProject(collaboratorId, project.id)).resolves.toBeNull()
      await expect(repository.setProjectMemberRole(ownerId, project.id, ownerId, 'viewer')).resolves.toBe('last_owner')
      await expect(repository.removeProjectMember(ownerId, project.id, ownerId)).resolves.toBe('last_owner')
      await expect(
        admin.query(`update app.project_members set role = 'viewer' where project_id = $1 and user_id = $2`, [
          project.id,
          ownerId,
        ]),
      ).rejects.toMatchObject({ constraint: 'project_members_require_owner' })

      await expect(
        repository.setProjectMemberRole(ownerId, project.id, collaboratorId, 'editor'),
      ).resolves.toMatchObject({ userId: collaboratorId, role: 'editor' })
      await expect(repository.getProject(collaboratorId, project.id)).resolves.toMatchObject({ id: project.id })
      await expect(repository.setProjectMemberRole(collaboratorId, project.id, ownerId, 'viewer')).resolves.toBe(
        'forbidden',
      )
      await expect(
        repository.setProjectMemberRole(ownerId, project.id, collaboratorId, 'owner'),
      ).resolves.toMatchObject({ role: 'owner' })
      await expect(repository.setProjectMemberRole(ownerId, project.id, ownerId, 'viewer')).resolves.toMatchObject({
        role: 'viewer',
      })
      await expect(
        repository.setProjectMemberRole(collaboratorId, project.id, ownerId, 'owner'),
      ).resolves.toMatchObject({
        role: 'owner',
      })
      await expect(repository.removeProjectMember(ownerId, project.id, collaboratorId)).resolves.toBe(true)
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [ownerId, collaboratorId])
    }
  })

  it('makes permanent deletion Owner-only and scrubs every collaborator asset before project removal', async () => {
    if (!admin || !repository) throw new Error('Project membership integration database is unavailable')
    const ownerId = randomUUID()
    const editorId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1), ($2)', [ownerId, editorId])
    try {
      const project = await repository.createProject(ownerId, {
        name: 'Owner-only permanent deletion',
        schema: { componentsTree: [] },
      })
      await repository.setProjectMemberRole(ownerId, project.id, editorId, 'editor')
      const deletedAt = new Date('2026-08-01T00:00:00.000Z')
      const deleteToken = randomUUID()
      await admin.query('update app.projects set deleted_at = $2 where id = $1', [project.id, deletedAt])
      const assetId = randomUUID()
      const storagePath = `${editorId}/${project.id}/${assetId}/private.png`
      await admin.query(
        `insert into app.agent_assets
          (id, actor_id, idempotency_key, project_id, original_name, content_type, size, sha256, status,
           storage_path, extracted_text, model_input_status, model_input_bytes, model_input_content_type,
           model_input_sha256, model_input_size)
         values
          ($1, $2, $3, $4, 'private.png', 'image/png', 8, $5, 'ready',
           $6, 'private extracted text', 'ready', decode('89504e470d0a1a0a', 'hex'), 'image/png', $5, 8)`,
        [assetId, editorId, randomUUID(), project.id, 'a'.repeat(64), storagePath],
      )

      const editorPrepared = await asActor(editorId, client =>
        client.query<{ storage_path: string }>(
          'select storage_path from app.prepare_project_agent_asset_cleanup($1, $2, $3)',
          [project.id, deletedAt, deleteToken],
        ),
      )
      expect(editorPrepared.rowCount).toBe(0)
      const editorDelete = await asActor(editorId, client =>
        client.query('delete from app.projects where id = $1 returning id', [project.id]),
      )
      expect(editorDelete.rowCount).toBe(0)

      const ownerPrepared = await asActor(ownerId, client =>
        client.query<{ storage_path: string }>(
          'select storage_path from app.prepare_project_agent_asset_cleanup($1, $2, $3)',
          [project.id, deletedAt, deleteToken],
        ),
      )
      expect(ownerPrepared.rows).toEqual([{ storage_path: storagePath }])
      await expect(
        admin.query(
          `select status, extracted_text, model_input_bytes, storage_cleanup_status
           from app.agent_assets where id = $1`,
          [assetId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            status: 'deleted',
            extracted_text: null,
            model_input_bytes: null,
            storage_cleanup_status: 'pending',
          },
        ],
      })

      await asActor(ownerId, client =>
        client.query('select app.finish_project_agent_asset_cleanup($1, $2, $3, false, $4)', [
          project.id,
          deletedAt,
          deleteToken,
          'temporary failure',
        ]),
      )
      await expect(
        admin.query(
          `select storage_cleanup_status, storage_cleanup_attempts, storage_cleanup_last_error
           from app.agent_assets where id = $1`,
          [assetId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            storage_cleanup_status: 'pending',
            storage_cleanup_attempts: 1,
            storage_cleanup_last_error: 'temporary failure',
          },
        ],
      })
      await asActor(ownerId, client =>
        client.query('select app.finish_project_agent_asset_cleanup($1, $2, $3, true, null)', [
          project.id,
          deletedAt,
          deleteToken,
        ]),
      )
      const ownerDelete = await asActor(ownerId, client =>
        client.query(
          'delete from app.projects where id = $1 and deleted_at = $2 and permanent_delete_token = $3 returning id',
          [project.id, deletedAt, deleteToken],
        ),
      )
      expect(ownerDelete.rows).toEqual([{ id: project.id }])
      await expect(admin.query('select id from app.agent_assets where id = $1', [assetId])).resolves.toMatchObject({
        rowCount: 0,
      })
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [ownerId, editorId])
    }
  })

  it('blocks an editor restore behind prepare and preserves the claimed trash generation', async () => {
    if (!admin || !runtime || !repository) throw new Error('Project membership integration database is unavailable')
    const ownerId = randomUUID()
    const editorId = randomUUID()
    const deleteToken = randomUUID()
    const deletedAt = new Date('2026-08-01T00:10:00.000Z')
    const prepareClient = await runtime.connect()
    await admin.query('insert into auth.users (id) values ($1), ($2)', [ownerId, editorId])
    let projectId: string | undefined
    try {
      const project = await repository.createProject(ownerId, {
        name: 'Permanent delete restore race',
        schema: { componentsTree: [] },
      })
      projectId = project.id
      await repository.setProjectMemberRole(ownerId, project.id, editorId, 'editor')
      await admin.query('update app.projects set deleted_at = $2 where id = $1', [project.id, deletedAt])

      await prepareClient.query('begin')
      await prepareClient.query(`select set_config('app.actor_id', $1, true)`, [ownerId])
      await prepareClient.query('select storage_path from app.prepare_project_agent_asset_cleanup($1, $2, $3)', [
        project.id,
        deletedAt,
        deleteToken,
      ])

      const restore = repository.restoreProject(editorId, project.id)
      await expect(
        Promise.race([
          restore.then(() => 'settled'),
          new Promise(resolve => setTimeout(() => resolve('blocked'), 100)),
        ]),
      ).resolves.toBe('blocked')

      await prepareClient.query('commit')
      await expect(restore).resolves.toBe('deletion_in_progress')
      await expect(
        admin.query(
          `select deleted_at, permanent_delete_token, permanent_delete_started_at
           from app.projects where id = $1`,
          [project.id],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            deleted_at: deletedAt,
            permanent_delete_token: deleteToken,
            permanent_delete_started_at: expect.any(Date),
          },
        ],
      })

      await asActor(ownerId, client =>
        client.query('select app.finish_project_agent_asset_cleanup($1, $2, $3, true, null)', [
          project.id,
          deletedAt,
          deleteToken,
        ]),
      )
      const deleted = await asActor(ownerId, client =>
        client.query(
          'delete from app.projects where id = $1 and deleted_at = $2 and permanent_delete_token = $3 returning id',
          [project.id, deletedAt, deleteToken],
        ),
      )
      expect(deleted.rows).toEqual([{ id: project.id }])
      projectId = undefined
    } finally {
      await prepareClient.query('rollback').catch(() => undefined)
      prepareClient.release()
      if (projectId) await admin.query('delete from app.projects where id = $1', [projectId])
      await admin.query('delete from auth.users where id in ($1, $2)', [ownerId, editorId])
    }
  })
})
