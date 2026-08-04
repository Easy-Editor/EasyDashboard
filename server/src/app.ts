import { Hono } from 'hono'
import type { AppEnv } from './env.js'
import { ApiError } from './http.js'
import { type AppVariables, requireAuth } from './middleware/auth.js'
import { requestSecurity } from './middleware/security.js'
import { createAgentAssetRoutes } from './routes/agent-assets.js'
import { type AgentConfigRouteOptions, createAgentConfigRoutes } from './routes/agent-config.js'
import { createAgentPlanRoutes } from './routes/agent-plan.js'
import { createAgentPreferenceRoutes } from './routes/agent-preferences.js'
import { createAgentProjectContextRoutes } from './routes/agent-project-context.js'
import { createAgentRunRoutes } from './routes/agent-runs.js'
import { type AgentSpikeRouteOptions, createAgentSpikeExecutorRoutes } from './routes/agent-spike.js'
import { createAgentStartRoutes } from './routes/agent-starts.js'
import { createAgentWorkspaceRoutes } from './routes/agent-workspace.js'
import { createAuthRoutes } from './routes/auth.js'
import { createPrivateMiscRoutes, createPublicRoutes } from './routes/misc.js'
import { createProjectMemberRoutes } from './routes/project-members.js'
import { createProjectRoutes } from './routes/projects.js'
import type { AgentExecutorRunner } from './services/agent-executor-runner.js'
import type { AgentRunDispatcher } from './services/agent-run-dispatcher.js'
import type { AuthService, PersonalSpaceProvisioner, Repository } from './types.js'

export interface AppDependencies {
  env: AppEnv
  auth: AuthService
  repository: Repository
  provisionPersonalSpace?: PersonalSpaceProvisioner
  agentSpike?: Pick<AgentSpikeRouteOptions, 'now' | 'createGrantId'>
  agentConfig?: Pick<AgentConfigRouteOptions, 'probe' | 'resolveHost' | 'now'>
  runner?: AgentExecutorRunner | null
  dispatcher?: AgentRunDispatcher | null
  agentTaskWake?: () => void
  agentTaskLogger?: Pick<Console, 'warn'>
}

export function createApp({
  env,
  auth,
  repository,
  provisionPersonalSpace,
  agentSpike,
  agentConfig,
  dispatcher,
  agentTaskWake,
  agentTaskLogger,
}: AppDependencies) {
  const app = new Hono<{ Variables: AppVariables }>().basePath('/api')
  const agentSpikeRoutes = {
    repository,
    grantSecret: env.AGENT_EXECUTOR_GRANT_SECRET,
    expectedCompatibility: env.AGENT_EXECUTOR_COMPATIBILITY_JSON,
    ...agentSpike,
  }
  const authCookieSecure = new URL(env.APP_ORIGIN).protocol === 'https:'
  app.use('*', async (c, next) => {
    c.set('authCookieSecure', authCookieSecure)
    await next()
  })
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
  app.route('/agent-spike', createAgentSpikeExecutorRoutes(agentSpikeRoutes))

  app.use('/agent/*', requireAuth(auth))
  app.use('/agent', requireAuth(auth))
  app.route('/agent', createAgentPlanRoutes({ repository, env }))
  app.route('/agent', createAgentPreferenceRoutes(repository))
  app.route('/agent', createAgentConfigRoutes({ repository, env, ...agentConfig }))
  app.route('/agent', createAgentWorkspaceRoutes(repository))
  app.route('/agent', createAgentStartRoutes(repository, undefined, dispatcher, env.AGENT_TASK_LOOP_V1 ?? false))

  app.use('/projects/*', requireAuth(auth))
  app.use('/projects', requireAuth(auth))
  app.route(
    '/projects',
    createAgentRunRoutes({
      repository,
      env,
      dispatcher,
      spike: agentSpikeRoutes,
      modelConfig: agentConfig,
      wakeTaskOrchestrator: agentTaskWake,
      taskOrchestratorLogger: agentTaskLogger,
    }),
  )
  app.route('/projects', createProjectMemberRoutes(repository))
  app.route('/projects', createProjectRoutes(repository))
  app.route('/projects', createAgentAssetRoutes(repository))
  app.route('/projects', createAgentProjectContextRoutes(repository))

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
