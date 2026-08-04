import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentUserPreferenceMemory } from '../agent/agent-user-preferences.js'
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

async function seedActor() {
  if (!admin) throw new Error('User settings concurrency integration test requires an administrator database')
  const actorId = randomUUID()
  await admin.query('insert into auth.users (id) values ($1)', [actorId])
  return actorId
}

async function cleanupActor(actorId: string) {
  await admin?.query('delete from auth.users where id = $1', [actorId])
}

function preferenceMemory(revision: number, content: string): AgentUserPreferenceMemory {
  const updatedAt = new Date(Date.UTC(2026, 7, 1, 9, revision)).toISOString()
  return {
    version: 1,
    revision,
    enabled: true,
    preferences: [
      {
        id: randomUUID(),
        category: 'visual',
        content,
        source: 'explicit',
        createdAt: updatedAt,
        updatedAt,
      },
    ],
    updatedAt,
  }
}

describeWithDatabase('user settings PostgreSQL concurrency integration', () => {
  afterAll(async () => {
    await admin?.end()
  })

  it('preserves the successful preference CAS while applying a concurrent generic settings patch', async () => {
    if (!repository?.compareAndSetAgentUserPreferenceMemory) {
      throw new Error('User preference CAS repository is unavailable')
    }
    const actorId = await seedActor()
    const revisionOne = preferenceMemory(1, 'Keep chart labels compact')
    const revisionTwo = preferenceMemory(2, 'Use compact labels and a muted visual hierarchy')
    const maliciousRevisionZero = preferenceMemory(0, 'Replace the latest preference with stale content')
    try {
      await repository.updateSettings(actorId, { autosave: true })
      await expect(repository.compareAndSetAgentUserPreferenceMemory(actorId, 0, revisionOne)).resolves.toBe(true)

      const [casSucceeded, patched] = await Promise.all([
        repository.compareAndSetAgentUserPreferenceMemory(actorId, 1, revisionTwo),
        repository.updateSettings(actorId, {
          autosave: false,
          agentPreferenceMemory: maliciousRevisionZero,
        }),
      ])

      expect(casSucceeded).toBe(true)
      expect(patched.autosave).toBe(false)
      await expect(repository.getSettings(actorId)).resolves.toMatchObject({
        autosave: false,
        agentPreferenceMemory: revisionTwo,
      })
    } finally {
      await cleanupActor(actorId)
    }
  })

  it('preserves agent model configuration when applying a generic settings patch', async () => {
    if (!repository) throw new Error('User settings integration test requires a runtime database')
    const actorId = await seedActor()
    const agentModelConfiguration = {
      user: {
        provider: 'openai-compatible',
        model: 'private-model',
        encryptedSecret: { ciphertext: 'server-only' },
      },
    }
    try {
      await repository.updateSettings(actorId, { agentModelConfiguration, autosave: true })

      await expect(repository.updateSettings(actorId, { autosave: false })).resolves.toMatchObject({
        autosave: false,
        agentModelConfiguration,
      })
    } finally {
      await cleanupActor(actorId)
    }
  })
})
