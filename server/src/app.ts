import { Hono } from 'hono'
import type { AppEnv } from './env.js'
import { ApiError } from './http.js'
import { type AppVariables, requireAuth } from './middleware/auth.js'
import { requestSecurity } from './middleware/security.js'
import { createAuthRoutes } from './routes/auth.js'
import { createPrivateMiscRoutes, createPublicRoutes } from './routes/misc.js'
import { createProjectRoutes } from './routes/projects.js'
import type { AuthService, PersonalSpaceProvisioner, Repository } from './types.js'

export interface AppDependencies {
  env: AppEnv
  auth: AuthService
  repository: Repository
  provisionPersonalSpace?: PersonalSpaceProvisioner
}

export function createApp({ env, auth, repository, provisionPersonalSpace }: AppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>().basePath('/api')

  app.use('*', requestSecurity(env))
  app.get('/health/live', c => c.json({ status: 'ok' }))
  app.get('/health/ready', async c => {
    try {
      await repository.ping()
      return c.json({ status: 'ready' })
    } catch {
      return c.json({ status: 'unavailable' }, 503)
    }
  })

  app.route('/auth', createAuthRoutes(auth, { appOrigin: env.APP_ORIGIN, provisionPersonalSpace }))
  app.route('/public', createPublicRoutes(repository, env))

  app.use('/projects/*', requireAuth(auth))
  app.use('/projects', requireAuth(auth))
  app.route('/projects', createProjectRoutes(repository))

  app.use('/templates', requireAuth(auth))
  app.use('/settings', requireAuth(auth))
  app.route('/', createPrivateMiscRoutes(repository))

  app.notFound(c => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    console.error(error)
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }, 500)
  })

  return app
}
