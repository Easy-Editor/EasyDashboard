import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AuthService } from '../types.js'
import { type AppVariables, requireAuth } from './auth.js'

const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }

describe('requireAuth', () => {
  function service(overrides: Partial<AuthService> = {}): AuthService {
    return {
      signUp: async () => ({ user: actor, session: null }),
      signIn: async () => {
        throw new Error('unused')
      },
      startOAuth: async () => {
        throw new Error('unused')
      },
      exchangeCode: async () => {
        throw new Error('unused')
      },
      requestPasswordReset: async () => {
        throw new Error('unused')
      },
      updatePassword: async () => {
        throw new Error('unused')
      },
      refresh: async () => {
        throw new Error('unused')
      },
      getUser: async () => null,
      signOut: async () => undefined,
      ...overrides,
    }
  }

  it('marks a protected response private and non-cacheable when it refreshes cookies', async () => {
    const auth = service({
      refresh: async () => ({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: actor,
      }),
    })
    const app = new Hono<{ Variables: AppVariables }>()
    app.use('/projects', requireAuth(auth))
    app.get('/projects', c => c.json({ actorId: c.get('actorId'), accessToken: c.get('accessToken') }))

    const response = await app.request('/projects', {
      headers: {
        cookie: '__Host-ed-access-token=expired; __Host-ed-refresh-token=refresh',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.getSetCookie().join('\n')).toContain('__Host-ed-access-token=new-access')
    await expect(response.json()).resolves.toMatchObject({ accessToken: 'new-access' })
  })

  it('marks an authenticated response private even when no refresh is needed', async () => {
    const app = new Hono<{ Variables: AppVariables }>()
    app.use('/projects', requireAuth(service({ getUser: async () => actor })))
    app.get('/projects', c => c.json({ actorId: c.get('actorId') }))

    const response = await app.request('/projects', {
      headers: { cookie: '__Host-ed-access-token=valid' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('clears stale cookies when refresh fails', async () => {
    const app = new Hono<{ Variables: AppVariables }>()
    app.use('/projects', requireAuth(service({ refresh: async () => Promise.reject(new Error('expired')) })))
    app.get('/projects', c => c.json({ ok: true }))

    const response = await app.request('/projects', {
      headers: {
        cookie: '__Host-ed-access-token=expired; __Host-ed-refresh-token=invalid',
      },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('__Host-ed-access-token=')
    expect(cookies).toContain('__Host-ed-refresh-token=')
    expect(cookies).toContain('Max-Age=0')
  })
})
