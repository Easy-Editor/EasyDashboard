import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AuthService, PersonalSpaceProvisioner } from '../types.js'
import { createAuthRoutes } from './auth.js'

const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }
const appOrigin = 'https://app.example.com'

function auth(overrides: Partial<AuthService> = {}): AuthService {
  return {
    signUp: async () => ({ user: actor, session: null }),
    signIn: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: actor,
    }),
    startOAuth: async provider => ({
      url: `https://example.supabase.co/auth/v1/authorize?provider=${provider}`,
      codeVerifier: 'oauth-verifier',
    }),
    exchangeCode: async () => ({
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: actor,
    }),
    requestPasswordReset: async () => ({ codeVerifier: 'recovery-verifier' }),
    updatePassword: async () => ({
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh',
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

function routes(
  service: AuthService = auth(),
  provisionPersonalSpace: PersonalSpaceProvisioner = async () => undefined,
) {
  return new Hono().route(
    '/auth',
    createAuthRoutes(service, {
      appOrigin,
      provisionPersonalSpace,
    }),
  )
}

describe('auth routes', () => {
  it('starts an allowed OAuth provider with PKCE cookies and a safe callback', async () => {
    const startOAuth = vi.fn(auth().startOAuth)
    const response = await routes(auth({ startOAuth })).request('/auth/oauth/github?returnTo=%2Fsettings')

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain('provider=github')
    expect(startOAuth).toHaveBeenCalledOnce()
    const [provider, redirectTo] = startOAuth.mock.calls[0] ?? []
    expect(provider).toBe('github')
    const callback = new URL(String(redirectTo))
    expect(callback.origin).toBe(appOrigin)
    expect(callback.pathname).toBe('/api/auth/oauth/callback')
    expect(callback.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32,}$/)

    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('__Host-ed-oauth-state=')
    expect(cookies).toContain('__Host-ed-oauth-verifier=oauth-verifier')
    expect(cookies).toContain('__Host-ed-oauth-return-to=%2Fsettings')
    expect(cookies).toContain('HttpOnly')
    expect(cookies).toContain('Secure')
    expect(cookies).toContain('SameSite=Lax')
  })

  it('rejects OAuth providers outside the allowlist', async () => {
    const startOAuth = vi.fn(auth().startOAuth)
    const response = await routes(auth({ startOAuth })).request('/auth/oauth/gitlab')

    expect(response.status).toBe(404)
    expect(startOAuth).not.toHaveBeenCalled()
  })

  it('replaces an external returnTo with the internal default', async () => {
    const response = await routes().request('/auth/oauth/google?returnTo=https%3A%2F%2Fevil.example%2Fsteal')
    const cookies = response.headers.getSetCookie().join('\n')

    expect(response.status).toBe(302)
    expect(cookies).toContain('__Host-ed-oauth-return-to=%2Fprojects')
    expect(cookies).not.toContain('evil.example')
  })

  it('rejects a tampered OAuth state without exchanging the code', async () => {
    const exchangeCode = vi.fn(auth().exchangeCode)
    const response = await routes(auth({ exchangeCode })).request(
      '/auth/oauth/callback?code=auth-code&state=tampered',
      {
        headers: {
          cookie:
            '__Host-ed-oauth-state=expected-state; __Host-ed-oauth-verifier=oauth-verifier; __Host-ed-oauth-return-to=%2Fsettings',
        },
      },
    )

    expect(response.status).toBe(400)
    expect(exchangeCode).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie().join('\n')).toContain('__Host-ed-oauth-state=')
  })

  it('exchanges a valid OAuth callback, provisions personal space, and redirects internally', async () => {
    const exchangeCode = vi.fn(auth().exchangeCode)
    const provisionPersonalSpace = vi.fn(async () => undefined)
    const response = await routes(auth({ exchangeCode }), provisionPersonalSpace).request(
      '/auth/oauth/callback?code=auth-code&state=expected-state',
      {
        headers: {
          cookie:
            '__Host-ed-oauth-state=expected-state; __Host-ed-oauth-verifier=oauth-verifier; __Host-ed-oauth-return-to=%2Fsettings',
        },
      },
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(`${appOrigin}/settings`)
    expect(exchangeCode).toHaveBeenCalledWith('auth-code', 'oauth-verifier')
    expect(provisionPersonalSpace).toHaveBeenCalledWith(actor)
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('__Host-ed-access-token=oauth-access')
    expect(cookies).toContain('__Host-ed-refresh-token=oauth-refresh')
    expect(cookies).not.toContain('oauth-access; Path=/; SameSite=Lax; Secure\n')
  })

  it('keeps password sign-in server-mediated and provisions personal space', async () => {
    const provisionPersonalSpace = vi.fn(async () => undefined)
    const response = await routes(auth(), provisionPersonalSpace).request('/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: actor.email, password: 'password123' }),
    })

    expect(response.status).toBe(200)
    expect(provisionPersonalSpace).toHaveBeenCalledWith(actor)
    expect(await response.json()).toEqual({ user: actor })
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('__Host-ed-access-token=access')
    expect(cookies).toContain('HttpOnly')
  })

  it('starts and completes a PKCE password recovery without exposing tokens', async () => {
    const service = auth()
    const request = await routes(service).request('/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: actor.email }),
    })
    expect(request.status).toBe(202)
    expect(request.headers.getSetCookie().join('\n')).toContain('__Host-ed-recovery-verifier=recovery-verifier')

    const callback = await routes(service).request('/auth/password/callback?code=recovery-code', {
      headers: { cookie: '__Host-ed-recovery-verifier=recovery-verifier' },
    })
    expect(callback.status).toBe(302)
    expect(callback.headers.get('Location')).toBe(`${appOrigin}/reset-password`)
    expect(await callback.text()).not.toContain('oauth-access')

    const reset = await routes(service).request('/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: '__Host-ed-access-token=oauth-access; __Host-ed-refresh-token=oauth-refresh',
      },
      body: JSON.stringify({ password: 'new-password-123' }),
    })
    expect(reset.status).toBe(204)
  })

  it('clears local cookies and reports when Supabase revocation fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const app = routes(auth({ signOut: async () => Promise.reject(new Error('offline')) }))

    const response = await app.request('/auth/sign-out', {
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
