import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'
import type { ProjectSchema } from '../validation.js'
import { createPgRepository } from './repository.js'

const storageSignUpload = vi.hoisted(() =>
  vi.fn(async (path: string) => ({
    data: { signedUrl: `https://upload.test/${path}`, token: 'upload-token' },
    error: null,
  })),
)

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: storageSignUpload,
      }),
    },
  }),
}))

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

async function seedProjectWithReadyAssets(assetCount: number, assetSize: number) {
  if (!admin) throw new Error('Agent asset concurrency integration test requires an administrator database')
  const actorId = randomUUID()
  const spaceId = randomUUID()
  const projectId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  await admin.query(
    `insert into app.spaces (id, kind, name, personal_owner_id, created_by)
     values ($1, 'personal', 'Asset concurrency integration', $2, $2)`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.space_members (space_id, user_id, role)
     values ($1, $2, 'owner')`,
    [spaceId, actorId],
  )
  await admin.query(
    `insert into app.projects (id, owner_id, space_id, name, draft_schema)
     values ($1, $2, $3, 'Asset concurrency integration', $4::jsonb)`,
    [projectId, actorId, spaceId, JSON.stringify(baseSchema)],
  )
  await admin.query(
    `insert into app.project_members (project_id, user_id, role, created_by) values ($1, $2, 'owner', $2)`,
    [projectId, actorId],
  )
  await admin.query(
    `insert into app.agent_assets (
       id, actor_id, idempotency_key, project_id, original_name, content_type, size, status, storage_path
     )
     select
       gen_random_uuid(),
       $1::uuid,
       $1::uuid::text || ':seed:' || ordinal::text,
       $2::uuid,
       'seed-' || ordinal::text || '.csv',
       'text/csv',
       $3,
       'ready',
       $1::uuid::text || '/' || $2::uuid::text || '/seed-' || ordinal::text || '.csv'
     from generate_series(1, $4) as ordinal`,
    [actorId, projectId, assetSize, assetCount],
  )
  return { actorId, projectId }
}

async function cleanupActor(actorId: string) {
  await admin?.query('delete from auth.users where id = $1', [actorId])
}

async function createUpload(actorId: string, projectId: string, size: number) {
  if (!repository?.createAgentAssetUpload)
    throw new Error('Agent asset concurrency integration test requires a runtime database')
  return repository.createAgentAssetUpload(actorId, 'access-token', projectId, {
    idempotencyKey: randomUUID(),
    scope: 'project',
    name: `${randomUUID()}.csv`,
    contentType: 'text/csv',
    size,
  })
}

describeWithDatabase('agent asset quota PostgreSQL integration', () => {
  beforeEach(() => {
    storageSignUpload.mockClear()
  })

  afterAll(async () => {
    await admin?.end()
  })

  it('allows only one concurrent upload to consume the final asset count slot', async () => {
    const fixture = await seedProjectWithReadyAssets(199, 1)
    try {
      const results = await Promise.all([
        createUpload(fixture.actorId, fixture.projectId, 1),
        createUpload(fixture.actorId, fixture.projectId, 1),
      ])

      expect(results.filter(result => result === 'quota')).toHaveLength(1)
      expect(results.filter(result => typeof result === 'object' && result !== null)).toHaveLength(1)
      expect(storageSignUpload).toHaveBeenCalledTimes(1)
      const persisted = await admin!.query<{ active_count: string }>(
        `select count(*)::text as active_count
         from app.agent_assets
         where actor_id = $1
           and project_id = $2
           and status in ('uploading', 'processing', 'ready')`,
        [fixture.actorId, fixture.projectId],
      )
      expect(persisted.rows[0]).toEqual({ active_count: '200' })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })

  it('allows only one concurrent upload to consume the remaining total-size quota', async () => {
    const mebibyte = 1024 * 1024
    const fixture = await seedProjectWithReadyAssets(10, 19 * mebibyte)
    try {
      const results = await Promise.all([
        createUpload(fixture.actorId, fixture.projectId, 10 * mebibyte),
        createUpload(fixture.actorId, fixture.projectId, 10 * mebibyte),
      ])

      expect(results.filter(result => result === 'quota')).toHaveLength(1)
      expect(results.filter(result => typeof result === 'object' && result !== null)).toHaveLength(1)
      expect(storageSignUpload).toHaveBeenCalledTimes(1)
      const persisted = await admin!.query<{ active_count: string; active_size: string }>(
        `select count(*)::text as active_count, coalesce(sum(size), 0)::text as active_size
         from app.agent_assets
         where actor_id = $1
           and project_id = $2
           and status in ('uploading', 'processing', 'ready')`,
        [fixture.actorId, fixture.projectId],
      )
      expect(persisted.rows[0]).toEqual({
        active_count: '11',
        active_size: String(200 * mebibyte),
      })
    } finally {
      await cleanupActor(fixture.actorId)
    }
  })
})
