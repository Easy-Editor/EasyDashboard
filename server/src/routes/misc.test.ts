import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
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

function createTestApp() {
  const repository = {
    getPublicProject: async () => null,
  } as unknown as Repository
  const app = new Hono().route('/public', createPublicRoutes(repository, env))
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
})
