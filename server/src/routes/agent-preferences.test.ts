import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { createAgentPreferenceRoutes } from './agent-preferences.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const preferenceId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-08-01T10:00:00.000Z')

function createHarness() {
  let settings: Record<string, unknown> = { displayName: 'Owner' }
  const repository = {
    getSettings: vi.fn(async () => structuredClone(settings)),
    updateSettings: vi.fn(),
    getAgentUserPreferenceMemory: vi.fn(async () => {
      const memory = settings.agentPreferenceMemory
      return (memory ?? { version: 1, revision: 0, enabled: false, preferences: [], updatedAt: null }) as never
    }),
    compareAndSetAgentUserPreferenceMemory: vi.fn(async (_actorId, expectedRevision, memory) => {
      const current = (settings.agentPreferenceMemory as { revision?: number } | undefined)?.revision ?? 0
      if (current !== expectedRevision) return false
      settings = { ...settings, agentPreferenceMemory: structuredClone(memory) }
      return true
    }),
  } satisfies Pick<Repository, 'getSettings' | 'updateSettings'> &
    Required<Pick<Repository, 'getAgentUserPreferenceMemory' | 'compareAndSetAgentUserPreferenceMemory'>>
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (c, next) => {
    c.set('actorId', actorId)
    await next()
  })
  app.route(
    '/agent',
    createAgentPreferenceRoutes(repository as unknown as Repository, () => now),
  )
  app.onError((error, c) => {
    if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message } }, error.status)
    throw error
  })
  return { app, repository, readSettings: () => settings }
}

function request(method: string, body?: unknown, query = '') {
  return new Request(`https://app.example.com/agent/preferences${query}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('Agent preference routes', () => {
  it('creates stable entries with server timestamps and preserves unrelated settings', async () => {
    const { app, readSettings } = createHarness()
    const response = await app.request(
      request('PUT', {
        expectedRevision: 0,
        enabled: true,
        preferences: [{ category: 'visual', content: '偏好深色高对比', source: 'explicit' }],
      }),
    )
    const payload = (await response.json()) as { memory: { revision: number; preferences: Array<{ id: string }> } }

    expect(response.status).toBe(200)
    expect(payload.memory).toMatchObject({ revision: 1, enabled: true, updatedAt: now.toISOString() })
    expect(payload.memory.preferences[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(readSettings()).toMatchObject({ displayName: 'Owner', agentPreferenceMemory: payload.memory })
  })

  it('rejects stale CAS writes without overwriting current memory', async () => {
    const { app, repository } = createHarness()
    await app.request(request('PUT', { expectedRevision: 0, enabled: true, preferences: [] }))
    const stale = await app.request(request('PUT', { expectedRevision: 0, enabled: false, preferences: [] }))

    expect(stale.status).toBe(409)
    expect(repository.compareAndSetAgentUserPreferenceMemory).toHaveBeenCalledTimes(1)
  })

  it('clears all entries and disables memory', async () => {
    const { app } = createHarness()
    await app.request(
      request('PUT', {
        expectedRevision: 0,
        enabled: true,
        preferences: [{ id: preferenceId, category: 'canvas', content: '使用 1920x1080', source: 'explicit' }],
      }),
    )
    const response = await app.request(request('DELETE', undefined, '?expectedRevision=1'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      memory: { revision: 2, enabled: false, preferences: [] },
    })
  })

  it('rejects arbitrary fields and more than 32 preferences', async () => {
    const { app } = createHarness()
    const arbitrary = await app.request(
      request('PUT', { expectedRevision: 0, enabled: true, preferences: [], apiKey: 'must-not-persist' }),
    )
    const tooMany = await app.request(
      request('PUT', {
        expectedRevision: 0,
        enabled: true,
        preferences: Array.from({ length: 33 }, () => ({
          category: 'other',
          content: '偏好',
          source: 'explicit',
        })),
      }),
    )

    expect(arbitrary.status).toBe(422)
    expect(tooMany.status).toBe(422)
  })

  it('rejects credential-like preference content before persistence', async () => {
    const { app, repository } = createHarness()

    const response = await app.request(
      request('PUT', {
        expectedRevision: 0,
        enabled: true,
        preferences: [{ category: 'other', content: 'use token sk-proj-fakeSecret123456', source: 'explicit' }],
      }),
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'AGENT_PREFERENCES_SENSITIVE' } })
    expect(repository.compareAndSetAgentUserPreferenceMemory).not.toHaveBeenCalled()
  })
})
