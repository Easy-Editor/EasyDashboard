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
    await client.query('rollback')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

describeWithDatabase('project publish snapshot PostgreSQL gate', () => {
  afterAll(async () => {
    await runtime?.end()
    await admin?.end()
  })

  it('enforces immutable snapshot publication, Owner authority, one-time consumption, and cascade cleanup', async () => {
    if (!admin || !repository) throw new Error('Publish gate integration database is unavailable')
    const ownerId = randomUUID()
    const editorId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1), ($2)', [ownerId, editorId])
    let projectId: string | null = null
    try {
      const originalDocument = { componentsTree: [{ id: 'snapshot-page' }] }
      const project = await repository.createProject(ownerId, { name: 'Snapshot gate', schema: originalDocument })
      projectId = project.id
      await expect(repository.setProjectMemberRole(ownerId, project.id, editorId, 'editor')).resolves.toMatchObject({
        role: 'editor',
      })

      const initial = await repository.createPublishSnapshot(editorId, project.id, project.draftVersion)
      expect(initial).not.toBeNull()
      expect(initial).not.toBe('conflict')
      if (!initial || initial === 'conflict') throw new Error('Snapshot was not created')
      expect(initial.previewRun).toBeNull()
      expect(initial.snapshot.document).toEqual(originalDocument)

      await expect(
        asActor(ownerId, client =>
          client.query(
            `insert into app.project_preview_runs
            (project_id, publish_snapshot_id, source, status, document_sha256, renderer_version,
             renderer_sha256, evidence, created_by)
           values ($1, $2, 'owner_live_render_attestation', 'verified', $3, 'manual', $4, '{}'::jsonb, $5)`,
            [project.id, initial.snapshot.id, initial.snapshot.documentSha256, 'd'.repeat(64), ownerId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)

      const operationId = randomUUID()
      const rendererVersion = 'trusted-renderer-1'
      const rendererSha256 = 'a'.repeat(64)
      const evidence = {
        consoleErrors: [],
        requestFailures: [],
        render: { status: 'rendered', screenshotSha256: 'b'.repeat(64), resourceErrors: [] },
        materials: { missing: [] },
      }
      await admin.query(
        `insert into app.agent_spike_operations
          (id, actor_id, project_id, task_id, stage_id, executor_id, operation_id, grant_jti,
           base_draft_version, input_digest, executor_input, issue_digest, compatibility, expires_at,
           status, candidate_digest, prepared_digest, candidate_schema, host_receipt, evidence,
           prepared_at, committed_draft_version, outcome, completed_at)
         values
          ($1, $2, $3, 'publish-task', 'publish-stage', 'trusted-executor', $4, $5,
           $6, $7, '{}'::jsonb, $8, $9::jsonb, now() + interval '1 day',
           'committed', $10, $11, $12::jsonb, '{}'::jsonb, $13::jsonb,
           now(), $6, '{}'::jsonb, now())`,
        [
          operationId,
          editorId,
          project.id,
          `operation-${operationId}`,
          `grant-${operationId}`,
          project.draftVersion,
          '1'.repeat(64),
          '2'.repeat(64),
          JSON.stringify({ rendererVersion, rendererSha256 }),
          initial.snapshot.documentSha256,
          '3'.repeat(64),
          JSON.stringify(originalDocument),
          JSON.stringify(evidence),
        ],
      )
      await expect(
        asActor(editorId, client =>
          client.query(
            `insert into app.project_preview_runs
              (project_id, publish_snapshot_id, source, status, document_sha256, renderer_version,
               renderer_sha256, evidence, agent_operation_id, created_by)
             values ($1, $2, 'agent_executor', 'verified', $3, $4, $5, '{}'::jsonb, $6, $7)`,
            [
              project.id,
              initial.snapshot.id,
              initial.snapshot.documentSha256,
              rendererVersion,
              rendererSha256,
              operationId,
              editorId,
            ],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)

      const created = await repository.createPublishSnapshot(editorId, project.id, project.draftVersion)
      expect(created).not.toBeNull()
      expect(created).not.toBe('conflict')
      if (!created || created === 'conflict') throw new Error('Snapshot was not created')
      expect(created.snapshot.document).toEqual(originalDocument)
      expect(created.previewRun).toMatchObject({
        source: 'agent_executor',
        agentOperationId: operationId,
        rendererVersion,
        rendererSha256,
        evidence,
      })
      await expect(
        admin.query('update app.project_publish_snapshots set document = $2::jsonb where id = $1', [
          created.snapshot.id,
          JSON.stringify({ componentsTree: [{ id: 'tampered' }] }),
        ]),
      ).rejects.toThrow(/immutable/i)

      await expect(
        admin.query('update app.project_preview_runs set renderer_version = $2 where publish_snapshot_id = $1', [
          created.snapshot.id,
          'tampered',
        ]),
      ).rejects.toThrow(/immutable/i)
      await expect(repository.approvePublishSnapshot(editorId, project.id, created.snapshot.id)).resolves.toBe(
        'forbidden',
      )
      await expect(repository.publish(editorId, project.id, { snapshotId: created.snapshot.id })).resolves.toBe(
        'forbidden',
      )

      const approval = await repository.approvePublishSnapshot(ownerId, project.id, created.snapshot.id)
      expect(approval).toMatchObject({ publishSnapshotId: created.snapshot.id, consumedAt: null })
      await repository.saveDraft(editorId, project.id, project.draftVersion, {
        componentsTree: [{ id: 'newer-mutable-draft' }],
      })

      const published = await repository.publish(ownerId, project.id, { snapshotId: created.snapshot.id })
      expect(published).toMatchObject({
        schema: originalDocument,
        releaseNumber: 1,
        isCurrent: true,
        isPublished: true,
      })
      const retried = await repository.publish(ownerId, project.id, { snapshotId: created.snapshot.id })
      expect(retried).toMatchObject({
        revisionId: published && typeof published === 'object' ? published.revisionId : '',
        isCurrent: true,
        isPublished: true,
      })
      await expect(repository.unpublish(editorId, project.id)).resolves.toBe('forbidden')
      await expect(repository.unpublish(ownerId, project.id)).resolves.toBe(true)
      await expect(repository.publish(ownerId, project.id, { snapshotId: created.snapshot.id })).resolves.toMatchObject(
        {
          isCurrent: true,
          isPublished: false,
        },
      )

      const approvalRow = await admin.query(
        'select id, consumed_at, consumed_release_id from app.project_publish_approvals where publish_snapshot_id = $1',
        [created.snapshot.id],
      )
      expect(approvalRow.rows[0]).toMatchObject({ id: expect.any(String), consumed_at: expect.any(Date) })
      await expect(
        admin.query(
          'update app.project_publish_approvals set consumed_at = null, consumed_release_id = null where id = $1',
          [approvalRow.rows[0].id],
        ),
      ).rejects.toThrow(/only be consumed once/i)

      await expect(
        asActor(editorId, client =>
          client.query(
            `insert into app.project_revisions
              (project_id, revision_number, kind, source_draft_version, schema, created_by)
             values ($1, 999999, 'publish', 1, '{}'::jsonb, $2)`,
            [project.id, editorId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i)

      await admin.query('delete from app.projects where id = $1', [project.id])
      projectId = null
      const remaining = await admin.query(
        'select count(*)::integer as count from app.project_publish_snapshots where project_id = $1',
        [project.id],
      )
      expect(remaining.rows[0]?.count).toBe(0)
    } finally {
      if (projectId) await admin.query('delete from app.projects where id = $1', [projectId])
      await admin.query('delete from auth.users where id in ($1, $2)', [ownerId, editorId])
    }
  })

  it('accepts the current editor renderer artifact as verified publish evidence', async () => {
    if (!admin || !repository) throw new Error('Publish gate integration database is unavailable')
    const ownerId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1)', [ownerId])
    let projectId: string | null = null
    try {
      const project = await repository.createProject(ownerId, {
        name: 'Editor renderer publish gate',
        schema: { componentsTree: [{ id: 'renderer-page' }] },
      })
      projectId = project.id
      const artifactId = randomUUID()
      const artifactPath = `${ownerId}/${project.id}/${project.draftVersion}/${artifactId}.webp`
      await admin.query(
        `insert into app.project_thumbnail_artifacts
          (id, project_id, path, status, draft_version, mode, source, content_type,
           expected_size, expires_at, created_by)
         values ($1, $2, $3, 'current', $4, 'auto', 'renderer', 'image/webp', 2048,
           now() + interval '1 day', $5)`,
        [artifactId, project.id, artifactPath, project.draftVersion, ownerId],
      )

      const created = await repository.createPublishSnapshot(ownerId, project.id, project.draftVersion)
      expect(created).not.toBeNull()
      expect(created).not.toBe('conflict')
      if (!created || created === 'conflict') throw new Error('Snapshot was not created')
      expect(created.previewRun).toMatchObject({
        source: 'editor_renderer_artifact',
        thumbnailArtifactId: artifactId,
        artifactPath,
        artifactSize: 2048,
        artifactDraftVersion: project.draftVersion,
      })
      await expect(repository.approvePublishSnapshot(ownerId, project.id, created.snapshot.id)).resolves.toMatchObject({
        previewRunId: created.previewRun?.id,
      })
      await expect(repository.publish(ownerId, project.id, { snapshotId: created.snapshot.id })).resolves.toMatchObject(
        {
          releaseNumber: 1,
          isCurrent: true,
          isPublished: true,
        },
      )
    } finally {
      if (projectId) await admin.query('delete from app.projects where id = $1', [projectId])
      await admin.query('delete from auth.users where id = $1', [ownerId])
    }
  })

  it('publishes with the current editor blueprint artifact when canvas encoding is unavailable', async () => {
    if (!admin || !repository) throw new Error('Publish gate integration database is unavailable')
    const ownerId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1)', [ownerId])
    let projectId: string | null = null
    try {
      const project = await repository.createProject(ownerId, {
        name: 'Editor blueprint publish fallback',
        schema: { componentsTree: [{ id: 'blueprint-page' }] },
      })
      projectId = project.id
      const artifactId = randomUUID()
      const artifactPath = `${ownerId}/${project.id}/${project.draftVersion}/${artifactId}.svg`
      await admin.query(
        `insert into app.project_thumbnail_artifacts
          (id, project_id, path, status, draft_version, mode, source, content_type,
           expected_size, expires_at, created_by)
         values ($1, $2, $3, 'current', $4, 'auto', 'blueprint', 'image/svg+xml', 2048,
           now() + interval '1 day', $5)`,
        [artifactId, project.id, artifactPath, project.draftVersion, ownerId],
      )

      const created = await repository.createPublishSnapshot(ownerId, project.id, project.draftVersion)
      expect(created).not.toBeNull()
      expect(created).not.toBe('conflict')
      if (!created || created === 'conflict') throw new Error('Snapshot was not created')
      expect(created.previewRun).toMatchObject({
        source: 'editor_blueprint_artifact',
        thumbnailArtifactId: artifactId,
        artifactPath,
        artifactSize: 2048,
        artifactDraftVersion: project.draftVersion,
      })
      await expect(repository.approvePublishSnapshot(ownerId, project.id, created.snapshot.id)).resolves.toMatchObject({
        previewRunId: created.previewRun?.id,
      })
      await expect(repository.publish(ownerId, project.id, { snapshotId: created.snapshot.id })).resolves.toMatchObject(
        {
          releaseNumber: 1,
          isCurrent: true,
          isPublished: true,
        },
      )
    } finally {
      if (projectId) await admin.query('delete from app.projects where id = $1', [projectId])
      await admin.query('delete from auth.users where id = $1', [ownerId])
    }
  })
})
