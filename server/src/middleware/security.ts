import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppEnv } from '../env.js'
import { MAX_SCHEMA_BYTES } from '../validation.js'

const BODY_LIMIT_BYTES = MAX_SCHEMA_BYTES + 64 * 1024
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const HOST_INDEPENDENT_PATHS = ['/api/health/', '/api/public/']

export function requestSecurity(env: AppEnv): MiddlewareHandler {
  const appHost = new URL(env.APP_ORIGIN).host.toLowerCase()
  const limit = bodyLimit({
    maxSize: BODY_LIMIT_BYTES,
    onError: c => c.json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds the API limit' } }, 413),
  })

  return async (c, next) => {
    const limitResult = await limit(c, async () => undefined)
    if (limitResult instanceof Response) return limitResult

    const host = c.req.header('Host')?.toLowerCase()
    const hostIndependent = HOST_INDEPENDENT_PATHS.some(prefix => c.req.path.startsWith(prefix))
    if (!hostIndependent && host && host !== appHost) {
      return c.json(
        {
          error: {
            code: 'INVALID_HOST',
            message: 'Private API requests must use the authenticated application host',
          },
        },
        421,
      )
    }

    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('Origin')
      if (origin !== env.APP_ORIGIN) {
        return c.json({ error: { code: 'INVALID_ORIGIN', message: 'Origin is not allowed' } }, 403)
      }
      const fetchSite = c.req.header('Sec-Fetch-Site')
      if (fetchSite && fetchSite !== 'same-origin') {
        return c.json({ error: { code: 'INVALID_FETCH_SITE', message: 'Cross-site mutations are not allowed' } }, 403)
      }
      const contentType = c.req.header('Content-Type')?.toLowerCase() ?? ''
      if (!contentType.startsWith('application/json')) {
        return c.json({ error: { code: 'JSON_REQUIRED', message: 'Mutations require application/json' } }, 415)
      }
      if (c.req.header('X-CSRF-Token') !== '1') {
        return c.json({ error: { code: 'CSRF_REQUIRED', message: 'Missing CSRF header' } }, 403)
      }
    }
    await next()
  }
}
