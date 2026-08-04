import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import { createPgRepository } from './repository.js'

const runtimeDatabaseUrl = process.env.AGENT_SPIKE_TEST_DATABASE_URL
const adminDatabaseUrl = process.env.AGENT_SPIKE_TEST_ADMIN_DATABASE_URL
const describeWithDatabase = runtimeDatabaseUrl && adminDatabaseUrl ? describe : describe.skip
const admin = adminDatabaseUrl ? new Pool({ connectionString: adminDatabaseUrl }) : null
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

describeWithDatabase('Agent project context provenance PostgreSQL integration', () => {
  afterAll(async () => admin?.end())

  it('retains provenance through CAS edits and restores it on rollback without exposing contexts across RLS', async () => {
    if (!admin || !repository?.upsertAgentProjectContext || !repository.rollbackAgentProjectContext) {
      throw new Error('Agent project context integration database is unavailable')
    }
    const ownerId = randomUUID()
    const outsiderId = randomUUID()
    await admin.query('insert into auth.users (id) values ($1), ($2)', [ownerId, outsiderId])
    try {
      const project = await repository.createProject(ownerId, {
        name: 'Context provenance',
        schema: { componentsTree: [] },
      })
      const created = await repository.upsertAgentProjectContext(ownerId, project.id, {
        title: 'Agent memory',
        content: 'first',
        sourceTaskId: 'task-1',
        provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
      })
      expect(created).not.toBeNull()
      expect(created).not.toBe('conflict')
      if (!created || created === 'conflict') return

      const retained = await repository.upsertAgentProjectContext(ownerId, project.id, {
        id: created.id,
        expectedRevision: 1,
        title: 'Agent memory edited',
        content: 'second',
      })
      expect(retained).toMatchObject({
        revision: 2,
        sourceTaskId: 'task-1',
        provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
        history: [{ revision: 1, sourceTaskId: 'task-1' }],
      })

      const changed = await repository.upsertAgentProjectContext(ownerId, project.id, {
        id: created.id,
        expectedRevision: 2,
        title: 'Manual memory',
        content: 'third',
        sourceTaskId: 'manual-note-1',
        provenance: { origin: 'manual', sourceKinds: ['user_request'] },
      })
      expect(changed).toMatchObject({ revision: 3, provenance: { origin: 'manual' } })

      const restored = await repository.rollbackAgentProjectContext(ownerId, project.id, created.id, 3, 1)
      expect(restored).toMatchObject({
        revision: 4,
        title: 'Agent memory',
        sourceTaskId: 'task-1',
        provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
      })
      await expect(repository.listAgentProjectContexts?.(outsiderId, project.id)).resolves.toBeNull()

      const legacy = await repository.upsertAgentProjectContext(ownerId, project.id, {
        title: 'Legacy memory',
        content: 'no provenance',
      })
      expect(legacy).not.toHaveProperty('sourceTaskId')
      expect(legacy).not.toHaveProperty('provenance')
    } finally {
      await admin.query('delete from auth.users where id in ($1, $2)', [ownerId, outsiderId])
    }
  })
})
