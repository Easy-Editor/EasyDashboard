import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
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
  const app = new Hono().route(
    '/auth',
    createAuthRoutes(service, {
      appOrigin,
      provisionPersonalSpace,
    }),
  )
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return app
}

function setCookieHeader(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))
}

function setCookieValue(response: Response, name: string): string | undefined {
  const header = setCookieHeader(response, name)
  if (!header) return undefined
  return decodeURIComponent(header.slice(name.length + 1).split(';')[0] ?? '')
}

function recoveryCookies(response: Response): string {
  const code = setCookieValue(response, '__Host-ed-recovery-code')
  const verifier = setCookieValue(response, '__Host-ed-recovery-verifier')
  expect(code).toBeTruthy()
  expect(verifier).toBeTruthy()
  return `__Host-ed-recovery-code=${encodeURIComponent(code!)}; __Host-ed-recovery-verifier=${encodeURIComponent(verifier!)}`
}

function expectClearedRecoveryCookies(response: Response): void {
  for (const name of ['__Host-ed-recovery-code', '__Host-ed-recovery-verifier']) {
    expect(setCookieHeader(response, name)).toContain('Max-Age=0')
  }
}

describe('auth routes', () => {
  it('keeps the local Supabase allow-list compatible with state-bearing OAuth callbacks', () => {
    const config = readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8')

    expect(config).toContain('"http://127.0.0.1:5173/api/auth/oauth/callback**"')
  })

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

  it('returns unsupported OAuth providers to a safe login state', async () => {
    const startOAuth = vi.fn(auth().startOAuth)
    const response = await routes(auth({ startOAuth })).request('/auth/oauth/gitlab?returnTo=%2Fsettings')

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      `${appOrigin}/login?authError=oauth_provider_unsupported&returnTo=%2Fsettings`,
    )
    expect(await response.text()).not.toContain('OAUTH_PROVIDER_NOT_ALLOWED')
    expect(startOAuth).not.toHaveBeenCalled()
  })

  it('replaces an external returnTo with the internal default', async () => {
    const response = await routes().request('/auth/oauth/google?returnTo=https%3A%2F%2Fevil.example%2Fsteal')
    const cookies = response.headers.getSetCookie().join('\n')

    expect(response.status).toBe(302)
    expect(cookies).toContain('__Host-ed-oauth-return-to=%2Fprojects')
    expect(cookies).not.toContain('evil.example')
  })

  it('returns OAuth start failures to login without leaking provider details', async () => {
    const response = await routes(
      auth({
        startOAuth: async () => {
          throw new Error('provider secret leaked here')
        },
      }),
    ).request('/auth/oauth/google?returnTo=https%3A%2F%2Fevil.example%2Fsteal')

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      `${appOrigin}/login?authError=oauth_start_failed&returnTo=%2Fprojects`,
    )
    expect(await response.text()).not.toContain('provider secret')
  })

  it('returns a tampered OAuth state to login without exchanging the code', async () => {
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

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      `${appOrigin}/login?authError=oauth_state_invalid&returnTo=%2Fsettings`,
    )
    expect(exchangeCode).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie().join('\n')).toContain('__Host-ed-oauth-state=')
    expect(await response.text()).not.toContain('INVALID_OAUTH_STATE')
  })

  it('returns incomplete and failed OAuth callbacks to stable login states', async () => {
    const incomplete = await routes().request('/auth/oauth/callback?state=expected-state', {
      headers: {
        cookie:
          '__Host-ed-oauth-state=expected-state; __Host-ed-oauth-verifier=oauth-verifier; __Host-ed-oauth-return-to=%2Fsettings',
      },
    })
    expect(incomplete.status).toBe(302)
    expect(incomplete.headers.get('Location')).toBe(
      `${appOrigin}/login?authError=oauth_callback_invalid&returnTo=%2Fsettings`,
    )

    const failed = await routes(
      auth({
        exchangeCode: async () => {
          throw new Error('upstream exchange detail')
        },
      }),
    ).request('/auth/oauth/callback?code=auth-code&state=expected-state', {
      headers: {
        cookie:
          '__Host-ed-oauth-state=expected-state; __Host-ed-oauth-verifier=oauth-verifier; __Host-ed-oauth-return-to=%2Fsettings',
      },
    })
    expect(failed.status).toBe(302)
    expect(failed.headers.get('Location')).toBe(
      `${appOrigin}/login?authError=oauth_exchange_failed&returnTo=%2Fsettings`,
    )
    expect(await failed.text()).not.toContain('upstream exchange detail')
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

  it('defers PKCE exchange until reset and protects the recovery cookies for ten minutes', async () => {
    const exchangeCode = vi.fn(auth().exchangeCode)
    const updatePassword = vi.fn(auth().updatePassword)
    const app = routes(auth({ exchangeCode, updatePassword }))
    const request = await app.request('/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: actor.email }),
    })
    expect(request.status).toBe(202)
    expect(request.headers.getSetCookie().join('\n')).toContain('__Host-ed-recovery-verifier=recovery-verifier')

    const callback = await app.request('/auth/password/callback?code=recovery-code', {
      headers: { cookie: '__Host-ed-recovery-verifier=recovery-verifier' },
    })
    expect(callback.status).toBe(302)
    expect(callback.headers.get('Location')).toBe(`${appOrigin}/reset-password?status=ready`)
    expect(await callback.text()).not.toContain('oauth-access')
    expect(exchangeCode).not.toHaveBeenCalled()
    expect(updatePassword).not.toHaveBeenCalled()
    expect(setCookieValue(callback, '__Host-ed-recovery-code')).toBe('recovery-code')
    expect(setCookieValue(callback, '__Host-ed-recovery-verifier')).toBe('recovery-verifier')
    for (const name of ['__Host-ed-recovery-code', '__Host-ed-recovery-verifier']) {
      const cookie = setCookieHeader(callback, name)
      expect(cookie).toContain('Max-Age=600')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('SameSite=Lax')
    }
    const callbackCookies = callback.headers.getSetCookie().join('\n')
    expect(callbackCookies).not.toContain('__Host-ed-access-token=')
    expect(callbackCookies).not.toContain('__Host-ed-refresh-token=')

    const reset = await app.request('/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: recoveryCookies(callback),
      },
      body: JSON.stringify({ password: 'new-password-123' }),
    })
    expect(reset.status).toBe(204)
    expect(exchangeCode).toHaveBeenCalledWith('recovery-code', 'recovery-verifier')
    expect(updatePassword).toHaveBeenCalledWith('oauth-access', 'oauth-refresh', 'new-password-123')
    expectClearedRecoveryCookies(reset)
  })

  it('completes recovery when callback and mutation reach different serverless instances', async () => {
    const exchangeCode = vi.fn(auth().exchangeCode)
    const updatePassword = vi.fn(auth().updatePassword)
    const service = auth({ exchangeCode, updatePassword })
    const callbackInstance = routes(service)
    const mutationInstance = routes(service)

    const callback = await callbackInstance.request('/auth/password/callback?code=cross-instance-code', {
      headers: { cookie: '__Host-ed-recovery-verifier=cross-instance-verifier' },
    })
    expect(callback.status).toBe(302)
    expect(exchangeCode).not.toHaveBeenCalled()

    const reset = await mutationInstance.request('/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: recoveryCookies(callback),
      },
      body: JSON.stringify({ password: 'new-password-123' }),
    })

    expect(reset.status).toBe(204)
    expect(exchangeCode).toHaveBeenCalledWith('cross-instance-code', 'cross-instance-verifier')
    expect(updatePassword).toHaveBeenCalledOnce()
  })

  it('does not treat an ordinary authenticated session as password recovery authority', async () => {
    const exchangeCode = vi.fn(auth().exchangeCode)
    const updatePassword = vi.fn(auth().updatePassword)
    const app = routes(auth({ exchangeCode, updatePassword }))
    const ordinarySession = await app.request('/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: '__Host-ed-access-token=access; __Host-ed-refresh-token=refresh',
      },
      body: JSON.stringify({ password: 'new-password-123' }),
    })

    expect(ordinarySession.status).toBe(401)
    await expect(ordinarySession.json()).resolves.toEqual({
      error: {
        code: 'RECOVERY_SESSION_REQUIRED',
        message: 'Password recovery session is missing or expired',
      },
    })
    expect(exchangeCode).not.toHaveBeenCalled()
    expect(updatePassword).not.toHaveBeenCalled()
    expectClearedRecoveryCookies(ordinarySession)
  })

  it('relies on the provider to reject a replayed single-use recovery code', async () => {
    const consumedCodes = new Set<string>()
    const exchangeCode = vi.fn(async (code: string, codeVerifier: string) => {
      if (consumedCodes.has(code)) throw new Error('provider rejected replayed code')
      consumedCodes.add(code)
      return auth().exchangeCode(code, codeVerifier)
    })
    const updatePassword = vi.fn(auth().updatePassword)
    const app = routes(auth({ exchangeCode, updatePassword }))
    const callback = await app.request('/auth/password/callback?code=recovery-code', {
      headers: { cookie: '__Host-ed-recovery-verifier=recovery-verifier' },
    })
    const cookie = recoveryCookies(callback)
    expect(exchangeCode).not.toHaveBeenCalled()

    const resetRequest = () =>
      app.request('/auth/reset-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
        },
        body: JSON.stringify({ password: 'new-password-123' }),
      })

    expect((await resetRequest()).status).toBe(204)
    const replay = await resetRequest()
    expect(replay.status).toBe(401)
    await expect(replay.json()).resolves.toMatchObject({
      error: { code: 'RECOVERY_SESSION_REQUIRED' },
    })
    expect(exchangeCode).toHaveBeenCalledTimes(2)
    expect(updatePassword).toHaveBeenCalledOnce()
  })

  it('returns 401 and clears recovery cookies when the provider rejects an expired code', async () => {
    const exchangeCode = vi.fn(async () => {
      throw new Error('provider rejected expired code')
    })
    const updatePassword = vi.fn(auth().updatePassword)
    const app = routes(auth({ exchangeCode, updatePassword }))
    const callback = await app.request('/auth/password/callback?code=recovery-code', {
      headers: { cookie: '__Host-ed-recovery-verifier=recovery-verifier' },
    })
    const cookie = recoveryCookies(callback)
    expect(exchangeCode).not.toHaveBeenCalled()

    const reset = await app.request('/auth/reset-password', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ password: 'new-password-123' }),
    })

    expect(reset.status).toBe(401)
    await expect(reset.json()).resolves.toMatchObject({
      error: { code: 'RECOVERY_SESSION_REQUIRED' },
    })
    expect(exchangeCode).toHaveBeenCalledWith('recovery-code', 'recovery-verifier')
    expect(updatePassword).not.toHaveBeenCalled()
    expectClearedRecoveryCookies(reset)
  })

  it('lets the provider reject replay after a consumed code reaches a failed password update', async () => {
    const consumedCodes = new Set<string>()
    const exchangeCode = vi.fn(async (code: string, codeVerifier: string) => {
      if (consumedCodes.has(code)) throw new Error('provider rejected replayed code')
      consumedCodes.add(code)
      return auth().exchangeCode(code, codeVerifier)
    })
    const updatePassword = vi.fn(async () => {
      throw new Error('upstream password update failed')
    })
    const app = routes(auth({ exchangeCode, updatePassword }))
    const callback = await app.request('/auth/password/callback?code=recovery-code', {
      headers: { cookie: '__Host-ed-recovery-verifier=recovery-verifier' },
    })
    const cookie = recoveryCookies(callback)
    const resetRequest = () =>
      app.request('/auth/reset-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
        },
        body: JSON.stringify({ password: 'new-password-123' }),
      })

    const failedUpdate = await resetRequest()
    expect(failedUpdate.status).toBe(400)
    await expect(failedUpdate.json()).resolves.toMatchObject({
      error: { code: 'PASSWORD_RESET_FAILED' },
    })
    expectClearedRecoveryCookies(failedUpdate)

    const replay = await resetRequest()
    expect(replay.status).toBe(401)
    await expect(replay.json()).resolves.toMatchObject({
      error: { code: 'RECOVERY_SESSION_REQUIRED' },
    })
    expect(exchangeCode).toHaveBeenCalledTimes(2)
    expect(updatePassword).toHaveBeenCalledOnce()
  })

  it('rejects malformed password callbacks without exchanging a provider code', async () => {
    const exchangeCode = vi.fn(auth().exchangeCode)
    const app = routes(auth({ exchangeCode }))
    const responses = await Promise.all([
      app.request('/auth/password/callback?code=recovery-code'),
      app.request('/auth/password/callback', {
        headers: { cookie: '__Host-ed-recovery-verifier=recovery-verifier' },
      }),
      app.request(`/auth/password/callback?code=${'x'.repeat(2049)}`, {
        headers: { cookie: '__Host-ed-recovery-verifier=recovery-verifier' },
      }),
    ])

    for (const response of responses) {
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe(`${appOrigin}/reset-password?status=invalid`)
      expect(await response.text()).not.toContain('INVALID_RECOVERY_CALLBACK')
      expectClearedRecoveryCookies(response)
    }
    expect(exchangeCode).not.toHaveBeenCalled()
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
