import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  clearAuthCookies,
  clearOAuthFlowCookies,
  clearRecoveryVerifierCookie,
  readAuthCookies,
  readOAuthFlowCookies,
  readRecoveryVerifierCookie,
  writeAuthCookies,
  writeOAuthFlowCookies,
  writeRecoveryVerifierCookie,
} from '../auth/cookies.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AuthService, OAuthProvider, PersonalSpaceProvisioner } from '../types.js'
import { credentialsSchema } from '../validation.js'

const oauthProviders = new Set<OAuthProvider>(['github', 'google'])
const emailSchema = z.object({ email: z.email().max(320) })
const passwordSchema = z.object({ password: z.string().min(8).max(256) })

type AuthRouteOptions = {
  appOrigin: string
  provisionPersonalSpace?: PersonalSpaceProvisioner
}

function internalReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/projects'
  try {
    const parsed = new URL(value, 'https://internal.invalid')
    if (parsed.origin !== 'https://internal.invalid') return '/projects'
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/projects'
  }
}

function statesMatch(received: string | undefined, expected: string | undefined): boolean {
  if (!received || !expected) return false
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

export function createAuthRoutes(auth: AuthService, options: AuthRouteOptions) {
  const routes = new Hono<{ Variables: AppVariables }>()
  const provisionPersonalSpace = options.provisionPersonalSpace ?? (async () => undefined)

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'private, no-store')
  })

  routes.post('/sign-up', async c => {
    const input = await readJson(c, credentialsSchema)
    try {
      const result = await auth.signUp(input.email, input.password)
      if (result.session) {
        await provisionPersonalSpace(result.user)
        writeAuthCookies(c, result.session)
      }
      return c.json({ user: result.user, authenticated: Boolean(result.session) }, 201)
    } catch (error) {
      throw new ApiError(400, 'SIGN_UP_FAILED', error instanceof Error ? error.message : 'Sign-up failed')
    }
  })

  routes.post('/sign-in', async c => {
    const input = await readJson(c, credentialsSchema)
    try {
      const session = await auth.signIn(input.email, input.password)
      await provisionPersonalSpace(session.user)
      writeAuthCookies(c, session)
      return c.json({ user: session.user })
    } catch {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
    }
  })

  routes.post('/sign-out', async c => {
    const cookies = readAuthCookies(c)
    let revocationFailed = false
    try {
      await auth.signOut(cookies.accessToken, cookies.refreshToken)
    } catch (error) {
      revocationFailed = true
      console.warn('Supabase session revocation failed during sign-out', error)
    } finally {
      clearAuthCookies(c)
    }
    if (revocationFailed) {
      return c.json(
        {
          error: {
            code: 'REMOTE_SIGN_OUT_FAILED',
            message: 'Local session was cleared, but remote session revocation failed',
          },
        },
        502,
      )
    }
    return c.body(null, 204)
  })

  routes.get('/oauth/callback', async c => {
    const flow = readOAuthFlowCookies(c)
    clearOAuthFlowCookies(c)
    if (!statesMatch(c.req.query('state'), flow.state)) {
      return c.json({ error: { code: 'INVALID_OAUTH_STATE', message: 'OAuth state is invalid or expired' } }, 400)
    }
    const code = c.req.query('code')
    if (!code || !flow.codeVerifier) {
      return c.json({ error: { code: 'INVALID_OAUTH_CALLBACK', message: 'OAuth callback is incomplete' } }, 400)
    }

    try {
      const session = await auth.exchangeCode(code, flow.codeVerifier)
      await provisionPersonalSpace(session.user)
      writeAuthCookies(c, session)
      return c.redirect(new URL(internalReturnTo(flow.returnTo), options.appOrigin).toString())
    } catch {
      return c.json({ error: { code: 'OAUTH_EXCHANGE_FAILED', message: 'OAuth sign-in could not be completed' } }, 400)
    }
  })

  routes.get('/oauth/:provider', async c => {
    const provider = c.req.param('provider')
    if (!oauthProviders.has(provider as OAuthProvider)) {
      return c.json({ error: { code: 'OAUTH_PROVIDER_NOT_ALLOWED', message: 'OAuth provider is not allowed' } }, 404)
    }

    const state = randomBytes(32).toString('base64url')
    const returnTo = internalReturnTo(c.req.query('returnTo'))
    const callback = new URL('/api/auth/oauth/callback', options.appOrigin)
    callback.searchParams.set('state', state)

    try {
      const flow = await auth.startOAuth(provider as OAuthProvider, callback.toString())
      writeOAuthFlowCookies(c, { state, codeVerifier: flow.codeVerifier, returnTo })
      return c.redirect(flow.url)
    } catch {
      return c.json({ error: { code: 'OAUTH_START_FAILED', message: 'OAuth sign-in could not be started' } }, 502)
    }
  })

  routes.post('/forgot-password', async c => {
    const { email } = await readJson(c, emailSchema)
    try {
      const callback = new URL('/api/auth/password/callback', options.appOrigin).toString()
      const { codeVerifier } = await auth.requestPasswordReset(email, callback)
      writeRecoveryVerifierCookie(c, codeVerifier)
    } catch (error) {
      // Always return the same response so the endpoint cannot enumerate accounts.
      console.warn('Supabase password recovery request failed', error)
    }
    return c.json({ accepted: true }, 202)
  })

  routes.get('/password/callback', async c => {
    const codeVerifier = readRecoveryVerifierCookie(c)
    clearRecoveryVerifierCookie(c)
    const code = c.req.query('code')
    if (!code || !codeVerifier) {
      return c.json(
        { error: { code: 'INVALID_RECOVERY_CALLBACK', message: 'Password recovery link is invalid or expired' } },
        400,
      )
    }
    try {
      const session = await auth.exchangeCode(code, codeVerifier)
      await provisionPersonalSpace(session.user)
      writeAuthCookies(c, session)
      return c.redirect(new URL('/reset-password', options.appOrigin).toString())
    } catch {
      return c.json(
        { error: { code: 'RECOVERY_EXCHANGE_FAILED', message: 'Password recovery could not be completed' } },
        400,
      )
    }
  })

  routes.post('/reset-password', async c => {
    const { password } = await readJson(c, passwordSchema)
    const { accessToken, refreshToken } = readAuthCookies(c)
    if (!accessToken || !refreshToken) {
      throw new ApiError(401, 'RECOVERY_SESSION_REQUIRED', 'Password recovery session is missing or expired')
    }
    try {
      const session = await auth.updatePassword(accessToken, refreshToken, password)
      writeAuthCookies(c, session)
      return c.body(null, 204)
    } catch {
      throw new ApiError(400, 'PASSWORD_RESET_FAILED', 'Password could not be updated')
    }
  })

  routes.get('/session', async c => {
    const { accessToken, refreshToken } = readAuthCookies(c)
    let user = accessToken ? await auth.getUser(accessToken) : null
    if (!user && refreshToken) {
      try {
        const session = await auth.refresh(refreshToken)
        writeAuthCookies(c, session)
        user = session.user
      } catch {
        clearAuthCookies(c)
      }
    }
    return c.json({ user })
  })

  return routes
}
