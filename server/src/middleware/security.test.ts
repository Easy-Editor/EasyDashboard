import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from '../env.js'
import { requestSecurity } from './security.js'

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
  const app = new Hono()
  app.use('*', requestSecurity(env))
  app.get('/api/auth/session', c => c.json({ user: null }))
  app.get('/api/public/projects/demo', c => c.json({ project: {} }))
  app.get('/api/health/live', c => c.json({ status: 'ok' }))
  return app
}

describe('requestSecurity', () => {
  it('rejects private API traffic served through the viewer host', async () => {
    const response = await createTestApp().request('/api/auth/session', {
      headers: { Host: 'view.example.com' },
    })

    expect(response.status).toBe(421)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_HOST' },
    })
  })

  it('allows public reads through a host other than the app host', async () => {
    const response = await createTestApp().request('/api/public/projects/demo', {
      headers: { Host: 'api.example.com' },
    })

    expect(response.status).toBe(200)
  })

  it('allows health checks through a host other than the app host', async () => {
    const response = await createTestApp().request('/api/health/live', {
      headers: { Host: 'api.example.com' },
    })

    expect(response.status).toBe(200)
  })
})
