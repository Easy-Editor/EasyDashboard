import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  clearAuthCookies,
  clearOAuthFlowCookies,
  clearRecoveryCodeCookie,
  clearRecoveryVerifierCookie,
  readAuthCookies,
  readOAuthFlowCookies,
  readRecoveryCodeCookie,
  readRecoveryVerifierCookie,
  writeAuthCookies,
  writeOAuthFlowCookies,
  writeRecoveryCodeCookie,
  writeRecoveryVerifierCookie,
} from '../auth/cookies.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AuthService, AuthSession, OAuthProvider, PersonalSpaceProvisioner } from '../types.js'
import { credentialsSchema } from '../validation.js'

const oauthProviders = new Set<OAuthProvider>(['github', 'google'])
const emailSchema = z.object({ email: z.email().max(320) })
const passwordSchema = z.object({ password: z.string().min(8).max(256) })
const recoveryCodeSchema = z.string().min(1).max(2048)

type AuthRouteOptions = {
  appOrigin: string
  provisionPersonalSpace?: PersonalSpaceProvisioner
}

type OAuthFailure =
  | 'oauth_callback_invalid'
  | 'oauth_exchange_failed'
  | 'oauth_provider_unsupported'
  | 'oauth_start_failed'
  | 'oauth_state_invalid'

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

function authFailureRedirect(appOrigin: string, authError: OAuthFailure, returnTo?: string): string {
  const location = new URL('/login', appOrigin)
  location.searchParams.set('authError', authError)
  location.searchParams.set('returnTo', internalReturnTo(returnTo))
  return location.toString()
}

function recoveryFailureRedirect(appOrigin: string): string {
  const location = new URL('/reset-password', appOrigin)
  location.searchParams.set('status', 'invalid')
  return location.toString()
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
      return c.redirect(authFailureRedirect(options.appOrigin, 'oauth_state_invalid', flow.returnTo))
    }
    const code = c.req.query('code')
    if (!code || !flow.codeVerifier) {
      return c.redirect(authFailureRedirect(options.appOrigin, 'oauth_callback_invalid', flow.returnTo))
    }

    try {
      const session = await auth.exchangeCode(code, flow.codeVerifier)
      await provisionPersonalSpace(session.user)
      writeAuthCookies(c, session)
      return c.redirect(new URL(internalReturnTo(flow.returnTo), options.appOrigin).toString())
    } catch {
      return c.redirect(authFailureRedirect(options.appOrigin, 'oauth_exchange_failed', flow.returnTo))
    }
  })

  routes.get('/oauth/:provider', async c => {
    const provider = c.req.param('provider')
    const returnTo = internalReturnTo(c.req.query('returnTo'))
    if (!oauthProviders.has(provider as OAuthProvider)) {
      clearOAuthFlowCookies(c)
      return c.redirect(authFailureRedirect(options.appOrigin, 'oauth_provider_unsupported', returnTo))
    }

    const state = randomBytes(32).toString('base64url')
    const callback = new URL('/api/auth/oauth/callback', options.appOrigin)
    callback.searchParams.set('state', state)

    try {
      const flow = await auth.startOAuth(provider as OAuthProvider, callback.toString())
      writeOAuthFlowCookies(c, { state, codeVerifier: flow.codeVerifier, returnTo })
      return c.redirect(flow.url)
    } catch {
      clearOAuthFlowCookies(c)
      return c.redirect(authFailureRedirect(options.appOrigin, 'oauth_start_failed', returnTo))
    }
  })

  routes.post('/forgot-password', async c => {
    const { email } = await readJson(c, emailSchema)
    clearRecoveryCodeCookie(c)
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
    const code = recoveryCodeSchema.safeParse(c.req.query('code'))
    if (!code.success || !codeVerifier) {
      clearRecoveryCodeCookie(c)
      clearRecoveryVerifierCookie(c)
      return c.redirect(recoveryFailureRedirect(options.appOrigin))
    }
    // Keep the short-lived, single-use PKCE code unexchanged until the password
    // mutation request. This remains correct across serverless instances and
    // never stores a user session in process-global memory.
    writeRecoveryCodeCookie(c, code.data)
    writeRecoveryVerifierCookie(c, codeVerifier)
    const location = new URL('/reset-password', options.appOrigin)
    location.searchParams.set('status', 'ready')
    return c.redirect(location.toString())
  })

  routes.post('/reset-password', async c => {
    const { password } = await readJson(c, passwordSchema)
    const recoveryCode = readRecoveryCodeCookie(c)
    const recoveryVerifier = readRecoveryVerifierCookie(c)
    clearRecoveryCodeCookie(c)
    clearRecoveryVerifierCookie(c)
    if (!recoveryCode || !recoveryVerifier) {
      throw new ApiError(401, 'RECOVERY_SESSION_REQUIRED', 'Password recovery session is missing or expired')
    }
    let recoverySession: AuthSession
    try {
      recoverySession = await auth.exchangeCode(recoveryCode, recoveryVerifier)
    } catch {
      throw new ApiError(401, 'RECOVERY_SESSION_REQUIRED', 'Password recovery session is missing or expired')
    }
    try {
      const session = await auth.updatePassword(recoverySession.accessToken, recoverySession.refreshToken, password)
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
