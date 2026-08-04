import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null

type ProjectRole = 'owner' | 'editor' | 'viewer'

interface Fixture {
  actorId: string
  ownerId: string
  spaceId: string
  projectId: string
  assetId: string
  storagePath: string
}

async function seedFixture(role: ProjectRole, reserveAsset: boolean): Promise<Fixture> {
  if (!admin) throw new Error('Agent asset storage policy integration test requires an administrator database')
  const ownerId = randomUUID()
  const actorId = role === 'owner' ? ownerId : randomUUID()
  const spaceId = randomUUID()
  const projectId = randomUUID()
  const assetId = randomUUID()
  const storagePath = `${actorId}/${projectId}/${assetId}/fixture.csv`
  const fixture = { actorId, ownerId, spaceId, projectId, assetId, storagePath }

  try {
    await admin.query('insert into auth.users (id) select unnest($1::uuid[])', [[...new Set([ownerId, actorId])]])
    await admin.query(
      `insert into app.spaces (id, kind, name, personal_owner_id, created_by)
       values ($1, 'personal', 'Asset storage policy integration', $2, $2)`,
      [spaceId, ownerId],
    )
    await admin.query(
      `insert into app.space_members (space_id, user_id, role)
       values ($1, $2, 'owner')`,
      [spaceId, ownerId],
    )
    if (actorId !== ownerId) {
      await admin.query(
        `insert into app.space_members (space_id, user_id, role)
         values ($1, $2, $3)`,
        [spaceId, actorId, role],
      )
    }
    await admin.query(
      `insert into app.projects (id, owner_id, space_id, name, draft_schema)
       values ($1, $2, $3, 'Asset storage policy integration', '{}'::jsonb)`,
      [projectId, ownerId, spaceId],
    )
    await admin.query(
      `insert into app.project_members (project_id, user_id, role, created_by) values ($1, $2, 'owner', $2)`,
      [projectId, ownerId],
    )
    if (actorId !== ownerId) {
      await admin.query(
        'insert into app.project_members (project_id, user_id, role, created_by) values ($1, $2, $3, $4)',
        [projectId, actorId, role, ownerId],
      )
    }
    if (reserveAsset) {
      await admin.query(
        `insert into app.agent_assets (
           id, actor_id, idempotency_key, project_id, original_name, content_type, size, status, storage_path
         )
         values ($1, $2, $3, $4, 'fixture.csv', 'text/csv', 1, 'uploading', $5)`,
        [assetId, actorId, randomUUID(), projectId, storagePath],
      )
    }
  } catch (error) {
    await cleanupFixture(fixture, [storagePath])
    throw error
  }

  return fixture
}

async function insertStorageObjectAsAuthenticated(actorId: string, storagePath: string) {
  if (!admin) throw new Error('Agent asset storage policy integration test requires an administrator database')
  const client = await admin.connect()
  try {
    await client.query('begin')
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actorId])
    await client.query('set local role authenticated')
    const inserted = await client.query<{ name: string }>(
      `insert into storage.objects (bucket_id, name, owner_id)
       values ('easy-dashboard-agent-assets', $1, $2)
       returning name`,
      [storagePath, actorId],
    )
    await client.query('commit')
    return inserted.rows[0]
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function canDeleteStorageObjectAsAuthenticated(actorId: string, storagePath: string) {
  if (!admin) throw new Error('Agent asset storage policy integration test requires an administrator database')
  const client = await admin.connect()
  try {
    await client.query('begin')
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actorId])
    await client.query('set local role authenticated')
    const result = await client.query<{ allowed: boolean }>('select app.can_delete_agent_asset_object($1) as allowed', [
      storagePath,
    ])
    await client.query('commit')
    return result.rows[0]?.allowed ?? false
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function cleanupFixture(fixture: Fixture, attemptedPaths: string[]) {
  if (!admin) return
  const client = await admin.connect()
  try {
    await client.query('begin')
    await client.query('set local session_replication_role = replica')
    await client.query(
      `delete from storage.objects
       where bucket_id = 'easy-dashboard-agent-assets'
         and name = any($1::text[])`,
      [attemptedPaths],
    )
    await client.query('set local session_replication_role = origin')
    await client.query('delete from app.agent_assets where id = $1', [fixture.assetId])
    await client.query('delete from app.projects where id = $1', [fixture.projectId])
    await client.query('delete from app.space_members where space_id = $1', [fixture.spaceId])
    await client.query('delete from app.spaces where id = $1', [fixture.spaceId])
    await client.query('delete from auth.users where id = any($1::uuid[])', [
      [...new Set([fixture.ownerId, fixture.actorId])],
    ])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

describeWithDatabase('agent asset storage PostgreSQL RLS integration', () => {
  afterAll(async () => {
    await admin?.end()
  })

  it('rejects a UID-prefixed upload without an exact asset reservation', async () => {
    const fixture = await seedFixture('owner', false)
    try {
      await expect(insertStorageObjectAsAuthenticated(fixture.actorId, fixture.storagePath)).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await cleanupFixture(fixture, [fixture.storagePath])
    }
  })

  it.each(['owner', 'editor'] as const)('allows an exact uploading reservation for a project %s', async role => {
    const fixture = await seedFixture(role, true)
    try {
      await expect(insertStorageObjectAsAuthenticated(fixture.actorId, fixture.storagePath)).resolves.toEqual({
        name: fixture.storagePath,
      })
    } finally {
      await cleanupFixture(fixture, [fixture.storagePath])
    }
  })

  it('rejects an exact reservation held by a viewer', async () => {
    const fixture = await seedFixture('viewer', true)
    try {
      await expect(insertStorageObjectAsAuthenticated(fixture.actorId, fixture.storagePath)).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await cleanupFixture(fixture, [fixture.storagePath])
    }
  })

  it('rejects a different path even when the actor has an uploading reservation', async () => {
    const fixture = await seedFixture('owner', true)
    const wrongPath = `${fixture.storagePath}.wrong`
    try {
      await expect(insertStorageObjectAsAuthenticated(fixture.actorId, wrongPath)).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await cleanupFixture(fixture, [fixture.storagePath, wrongPath])
    }
  })

  it('lets an Owner delete an editor object only after the shared project cleanup tombstones it', async () => {
    const fixture = await seedFixture('editor', true)
    try {
      await insertStorageObjectAsAuthenticated(fixture.actorId, fixture.storagePath)
      await expect(canDeleteStorageObjectAsAuthenticated(fixture.ownerId, fixture.storagePath)).resolves.toBe(false)
      await admin!.query(
        `update app.agent_assets
         set status = 'deleted', storage_cleanup_status = 'pending', updated_at = now()
         where id = $1`,
        [fixture.assetId],
      )
      await expect(canDeleteStorageObjectAsAuthenticated(fixture.ownerId, fixture.storagePath)).resolves.toBe(true)
    } finally {
      await cleanupFixture(fixture, [fixture.storagePath])
    }
  })
})
