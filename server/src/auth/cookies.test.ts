import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import {
  ACCESS_COOKIE,
  readAuthCookies,
  writeAuthCookies,
  writeOAuthFlowCookies,
  writeRecoveryCodeCookie,
} from './cookies.js'

const session = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: null,
  user: { id: 'user-1', email: 'user@example.com' },
}

describe('auth cookie transport policy', () => {
  it('keeps __Host cookies secure by default', async () => {
    const app = new Hono()
    app.get('/', c => {
      writeAuthCookies(c, session)
      return c.text('ok')
    })

    const response = await app.request('https://app.example.com/')
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain(`${ACCESS_COOKIE}=access-token`)
    expect(cookies).toContain('Secure')
    expect(cookies).toContain('HttpOnly')
  })

  it('uses non-prefixed non-Secure cookies for an explicitly local HTTP app', async () => {
    const app = new Hono<{ Variables: { authCookieSecure: boolean } }>()
    app.use('*', async (c, next) => {
      c.set('authCookieSecure', false)
      await next()
    })
    app.get('/write', c => {
      writeAuthCookies(c, session)
      writeOAuthFlowCookies(c, { state: 'state', codeVerifier: 'verifier', returnTo: '/projects' })
      writeRecoveryCodeCookie(c, 'recovery-code')
      return c.text('ok')
    })
    app.get('/read', c => c.json(readAuthCookies(c)))

    const response = await app.request('http://127.0.0.1/write')
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('ed-access-token=access-token')
    expect(cookies).toContain('ed-refresh-token=refresh-token')
    expect(cookies).toContain('ed-oauth-state=state')
    expect(cookies).toContain('ed-recovery-code=recovery-code')
    expect(cookies).not.toContain('__Host-')
    expect(cookies).not.toContain('Secure')
    expect(cookies).toContain('HttpOnly')

    const read = await app.request('http://127.0.0.1/read', {
      headers: { Cookie: 'ed-access-token=local-access; ed-refresh-token=local-refresh' },
    })
    await expect(read.json()).resolves.toEqual({ accessToken: 'local-access', refreshToken: 'local-refresh' })
  })
})
