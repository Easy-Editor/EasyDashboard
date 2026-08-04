import type { MiddlewareHandler } from 'hono'
import { clearAuthCookies, readAuthCookies, writeAuthCookies } from '../auth/cookies.js'
import type { AuthService } from '../types.js'

export interface AppVariables {
  actorId: string
  actorEmail: string | null
  accessToken: string
  authCookieSecure: boolean
}

export function requireAuth(auth: AuthService): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    const { accessToken, refreshToken } = readAuthCookies(c)
    let verifiedAccessToken = accessToken
    let user = accessToken ? await auth.getUser(accessToken) : null

    if (!user && refreshToken) {
      try {
        const refreshed = await auth.refresh(refreshToken)
        writeAuthCookies(c, refreshed)
        user = refreshed.user
        verifiedAccessToken = refreshed.accessToken
      } catch {
        clearAuthCookies(c)
        user = null
      }
    }

    if (!user || !verifiedAccessToken) {
      return c.json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    }

    c.set('actorId', user.id)
    c.set('actorEmail', user.email)
    c.set('accessToken', verifiedAccessToken)
    await next()
  }
}
