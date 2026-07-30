import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../env.js'
import { ApiError } from '../http.js'
import type { Repository } from '../types.js'
import { createPublicRoutes } from './misc.js'

const env = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'https://app.example.com',
  PUBLIC_VIEWER_ORIGIN: 'https://view.example.com',
  PORT: 8787,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890',
  DATABASE_URL: 'postgresql://example',
} satisfies AppEnv

function createTestApp(overrides: Partial<Repository> = {}, routeEnv: AppEnv = env) {
  const repository = {
    isPublicProjectAvailable: async () => false,
    getPublicProject: async () => null,
    getPublicProjectVersion: async () => null,
    ...overrides,
  } as unknown as Repository
  const app = new Hono().route('/public', createPublicRoutes(repository, routeEnv))
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return app
}

describe('public project routes', () => {
  it('adds viewer CORS headers to not-found responses', async () => {
    const response = await createTestApp().request('/public/projects/missing', {
      headers: { Origin: env.PUBLIC_VIEWER_ORIGIN },
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.PUBLIC_VIEWER_ORIGIN)
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('does not reflect an untrusted origin', async () => {
    const response = await createTestApp().request('/public/projects/missing', {
      headers: { Origin: 'https://attacker.example' },
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it.each(['http://localhost:5174', 'http://view.localhost:5174'])(
    'allows the default local Viewer origin in development: %s',
    async origin => {
      const developmentEnv: AppEnv = { ...env, NODE_ENV: 'development', PUBLIC_VIEWER_ORIGIN: undefined }
      const response = await createTestApp({}, developmentEnv).request('/public/projects/missing', {
        headers: { Origin: origin },
      })

      expect(response.status).toBe(404)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(response.headers.get('Vary')).toBe('Origin')
    },
  )

  it('does not enable local Viewer fallback outside development', async () => {
    const productionEnv: AppEnv = { ...env, NODE_ENV: 'production', PUBLIC_VIEWER_ORIGIN: undefined }
    const response = await createTestApp({}, productionEnv).request('/public/projects/missing', {
      headers: { Origin: 'http://view.localhost:5174' },
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('adds the development Viewer CORS header to successful responses', async () => {
    const developmentEnv: AppEnv = { ...env, NODE_ENV: 'development', PUBLIC_VIEWER_ORIGIN: undefined }
    const response = await createTestApp(
      {
        getPublicProject: async () => ({
          slug: 'dashboard',
          projectId: '22222222-2222-4222-8222-222222222222',
          name: 'Dashboard',
          description: null,
          revisionId: '33333333-3333-4333-8333-333333333333',
          revisionNumber: 1,
          releaseNumber: 1,
          schema: { componentsTree: [] },
          publishedAt: new Date('2026-07-30T00:00:00.000Z'),
        }),
      },
      developmentEnv,
    ).request('/public/projects/dashboard', { headers: { Origin: 'http://localhost:5174' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5174')
  })

  it('serves immutable published versions through a versioned public URL', async () => {
    const isPublicProjectAvailable = vi.fn()
    const getPublicProjectVersion = vi.fn(async () => ({
      slug: 'dashboard',
      projectId: '22222222-2222-4222-8222-222222222222',
      name: 'Dashboard',
      description: null,
      revisionId: '33333333-3333-4333-8333-333333333333',
      revisionNumber: 7,
      releaseNumber: 2,
      schema: { componentsTree: [] },
      publishedAt: new Date('2026-07-30T00:00:00.000Z'),
    }))
    const response = await createTestApp({ isPublicProjectAvailable, getPublicProjectVersion }).request(
      '/public/projects/dashboard/versions/2',
    )

    expect(response.status).toBe(200)
    expect(getPublicProjectVersion).toHaveBeenCalledWith('dashboard', 2)
    expect(isPublicProjectAvailable).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate')
    await expect(response.json()).resolves.toEqual({
      project: {
        projectId: '22222222-2222-4222-8222-222222222222',
        slug: 'dashboard',
        name: 'Dashboard',
        description: null,
        releaseNumber: 2,
        document: { componentsTree: [] },
        publishedAt: '2026-07-30T00:00:00.000Z',
      },
    })
  })

  it('keeps normal stable URL reads on the full public-project payload path', async () => {
    const isPublicProjectAvailable = vi.fn()
    const getPublicProject = vi.fn(async () => ({
      slug: 'dashboard',
      projectId: '22222222-2222-4222-8222-222222222222',
      name: 'Dashboard',
      description: 'Published dashboard',
      revisionId: '33333333-3333-4333-8333-333333333333',
      revisionNumber: 7,
      releaseNumber: 2,
      schema: { componentsTree: [] },
      publishedAt: new Date('2026-07-30T00:00:00.000Z'),
    }))
    const response = await createTestApp({ isPublicProjectAvailable, getPublicProject }).request(
      '/public/projects/dashboard',
    )

    expect(response.status).toBe(200)
    expect(getPublicProject).toHaveBeenCalledWith('dashboard')
    expect(isPublicProjectAvailable).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      project: {
        slug: 'dashboard',
        releaseNumber: 2,
        document: { componentsTree: [] },
      },
    })
  })

  it('supports a no-store publication probe for the Viewer routing middleware', async () => {
    const isPublicProjectAvailable = vi.fn(async () => true)
    const getPublicProject = vi.fn()
    const response = await createTestApp({ isPublicProjectAvailable, getPublicProject }).request(
      '/public/projects/dashboard?probe=1',
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await response.text()).toBe('')
    expect(isPublicProjectAvailable).toHaveBeenCalledWith('dashboard')
    expect(getPublicProject).not.toHaveBeenCalled()
  })

  it('uses the lightweight publication probe for immutable version URLs', async () => {
    const isPublicProjectAvailable = vi.fn(async () => true)
    const getPublicProjectVersion = vi.fn()
    const response = await createTestApp({ isPublicProjectAvailable, getPublicProjectVersion }).request(
      '/public/projects/dashboard/versions/2?probe=1',
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(isPublicProjectAvailable).toHaveBeenCalledWith('dashboard', 2)
    expect(getPublicProjectVersion).not.toHaveBeenCalled()
  })

  it.each([
    ['/public/projects/dashboard?probe=1', undefined],
    ['/public/projects/dashboard/versions/2?probe=1', 2],
  ])('returns 404 when the probed publication is unavailable: %s', async (path, releaseNumber) => {
    const isPublicProjectAvailable = vi.fn(async () => false)
    const response = await createTestApp({ isPublicProjectAvailable }).request(path)

    expect(response.status).toBe(404)
    expect(isPublicProjectAvailable).toHaveBeenCalledWith('dashboard', ...(releaseNumber ? [releaseNumber] : []))
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PUBLICATION_NOT_FOUND' } })
  })

  it('returns 404 for unavailable immutable versions', async () => {
    const response = await createTestApp().request('/public/projects/dashboard/versions/2')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PUBLICATION_NOT_FOUND' } })
  })
})
