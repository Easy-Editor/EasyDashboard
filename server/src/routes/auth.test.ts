import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AuthService } from '../types.js'
import { createAuthRoutes } from './auth.js'

const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }

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
    getUser: async () => null,
    signOut: async () => undefined,
    ...overrides,
  }
}

describe('auth routes', () => {
  it('clears local cookies and reports when Supabase revocation fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const routes = new Hono().route(
      '/auth',
      createAuthRoutes(auth({ signOut: async () => Promise.reject(new Error('offline')) })),
    )

    const response = await routes.request('/auth/sign-out', {
      method: 'POST',
      headers: {
        cookie: '__Host-ed-access-token=access; __Host-ed-refresh-token=refresh',
      },
    })

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'REMOTE_SIGN_OUT_FAILED',
        message: 'Local session was cleared, but remote session revocation failed',
      },
    })
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('__Host-ed-access-token=')
    expect(cookies).toContain('__Host-ed-refresh-token=')
    expect(cookies).toContain('Max-Age=0')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
