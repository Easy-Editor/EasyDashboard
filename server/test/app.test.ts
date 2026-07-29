import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { AppEnv } from '../src/env.js'
import type { AuthService, ProjectRecord, Repository } from '../src/types.js'

const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }
const projectId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-07-29T00:00:00.000Z')
const project: ProjectRecord = {
  id: projectId,
  name: 'Dashboard',
  description: null,
  draftSchema: { componentsTree: [] },
  draftVersion: 2,
  createdAt: now,
  updatedAt: now,
}

const env: AppEnv = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'https://app.example.com',
  PUBLIC_VIEWER_ORIGIN: 'https://view.example.com',
  PORT: 8787,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890',
  DATABASE_URL: 'postgresql://test',
}

function auth(overrides: Partial<AuthService> = {}): AuthService {
  return {
    signUp: async () => ({ user: actor, session: null }),
    signIn: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: actor,
    }),
    refresh: async () => {
      throw new Error('not refreshable')
    },
    getUser: async token => (token === 'access' ? actor : null),
    signOut: async () => undefined,
    ...overrides,
  }
}

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    ping: async () => undefined,
    listProjects: async () => [project],
    createProject: async () => project,
    getProject: async () => project,
    updateProject: async () => project,
    saveDraft: async () => project,
    listRevisions: async () => [],
    publish: async () => null,
    rollback: async () => null,
    unpublish: async () => false,
    getPublicProject: async () => null,
    listTemplates: async () => [],
    getSettings: async () => ({}),
    updateSettings: async (_actorId, settings) => settings,
    ...overrides,
  }
}

function mutation(path: string, body: unknown, cookie?: string) {
  return new Request(`https://app.example.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: env.APP_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': '1',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('EasyDashboard API', () => {
  it('reports liveness without external dependencies', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/health/live')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('fails readiness when the database cannot be reached', async () => {
    const app = createApp({
      env,
      auth: auth(),
      repository: repository({ ping: async () => Promise.reject(new Error('offline')) }),
    })
    const response = await app.request('/api/health/ready')
    expect(response.status).toBe(503)
  })

  it('rejects mutations from a different origin', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/auth/sign-in', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        'x-csrf-token': '1',
      },
      body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'INVALID_ORIGIN' } })
  })

  it('rejects requests above the API transfer budget before parsing JSON', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/auth/sign-in', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(4 * 1024 * 1024),
        origin: env.APP_ORIGIN,
        'x-csrf-token': '1',
      },
      body: '{}',
    })
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'BODY_TOO_LARGE' } })
  })

  it('keeps Supabase tokens in secure host-only cookies', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request(
      mutation('/api/auth/sign-in', { email: 'owner@example.com', password: 'password123' }),
    )
    expect(response.status).toBe(200)
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('__Host-ed-access-token=access')
    expect(cookies).toContain('__Host-ed-refresh-token=refresh')
    expect(cookies).toContain('HttpOnly')
    expect(cookies).toContain('Secure')
    expect(await response.text()).not.toContain('access')
  })

  it('requires authentication for project reads', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/projects')
    expect(response.status).toBe(401)
  })

  it('returns the publication slug when reading a published project', async () => {
    const publicationSlug = 'published-dashboard'
    const app = createApp({
      env,
      auth: auth(),
      repository: repository({
        getProject: async () => ({ ...project, publicationSlug }),
      }),
    })

    const response = await app.request(`/api/projects/${projectId}`, {
      headers: { cookie: '__Host-ed-access-token=access' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      project: { id: projectId, publicationSlug },
    })
  })

  it('returns a deterministic draft conflict', async () => {
    const app = createApp({
      env,
      auth: auth(),
      repository: repository({ saveDraft: async () => 'conflict' }),
    })
    const request = mutation(
      `/api/projects/${projectId}/draft`,
      { expectedVersion: 1, schema: { componentsTree: [] } },
      '__Host-ed-access-token=access',
    )
    const response = await app.request(
      new Request(request, {
        method: 'PUT',
      }),
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'DRAFT_CONFLICT' } })
  })

  it('rejects a schema that exceeds the nesting budget', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const schema: Record<string, unknown> = {}
    let cursor = schema
    for (let index = 0; index < 66; index += 1) {
      cursor.child = {}
      cursor = cursor.child as Record<string, unknown>
    }
    const response = await app.request(
      mutation('/api/projects', { name: 'Too deep', schema }, '__Host-ed-access-token=access'),
    )
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SCHEMA_TOO_DEEP' } })
  })
})
