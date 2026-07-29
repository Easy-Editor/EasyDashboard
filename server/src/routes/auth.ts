import { Hono } from 'hono'
import { z } from 'zod'
import { clearAuthCookies, readAuthCookies, writeAuthCookies } from '../auth/cookies.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AuthService } from '../types.js'
import { credentialsSchema } from '../validation.js'

export function createAuthRoutes(auth: AuthService) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'private, no-store')
  })

  routes.post('/sign-up', async c => {
    const input = await readJson(c, credentialsSchema)
    try {
      const result = await auth.signUp(input.email, input.password)
      if (result.session) writeAuthCookies(c, result.session)
      return c.json({ user: result.user, authenticated: Boolean(result.session) }, 201)
    } catch (error) {
      throw new ApiError(400, 'SIGN_UP_FAILED', error instanceof Error ? error.message : 'Sign-up failed')
    }
  })

  routes.post('/sign-in', async c => {
    const input = await readJson(c, credentialsSchema)
    try {
      const session = await auth.signIn(input.email, input.password)
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
