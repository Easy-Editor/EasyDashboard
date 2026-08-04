import { Hono } from 'hono'
import { parseAgentProjectWorkspacePayload } from './agent/workspace-contract.js'
import { createApp } from './app.js'
import { createSupabaseAuthService } from './auth/supabase.js'
import { createPgRepository } from './db/repository.js'
import { parseEnv } from './env.js'
import { ApiError } from './http.js'
import { type DurableTurnRepository, createAgentRunRoutes } from './routes/agent-runs.js'
import { restoreAgentSpikeOperationExecution } from './routes/agent-spike.js'
import { createAgentExecutorRunner } from './services/agent-executor-runner.js'
import {
  type AgentRunDispatchStore,
  type AgentRunDispatcher,
  createAgentRunDispatcher,
} from './services/agent-run-dispatcher.js'
import type { AgentSpikeOperationBinding, Repository } from './types.js'

type DispatchRepository = Repository & AgentRunDispatchStore

const dispatchMethods = [
  'enqueueAgentRunDispatch',
  'getAgentRunDispatch',
  'getAgentRunDispatchByTask',
  'claimAgentRunDispatch',
  'heartbeatAgentRunDispatch',
  'controlAgentRunDispatch',
  'finishAgentRunDispatch',
] as const

function supportsAgentRunDispatch(repository: Repository): repository is DispatchRepository {
  return dispatchMethods.every(method => typeof repository[method] === 'function')
}

function operationBinding(operation: {
  projectId: string
  taskId: string
  stageId: string
  executorId: string
  operationId: string
}): AgentSpikeOperationBinding {
  return {
    projectId: operation.projectId,
    taskId: operation.taskId,
    stageId: operation.stageId,
    executorId: operation.executorId,
    operationId: operation.operationId,
  }
}

export function createRuntime() {
  const env = parseEnv()
  const repository = createPgRepository(env)
  const runner = createAgentExecutorRunner({
    cliPath: env.AGENT_EXECUTOR_CLI_PATH,
    dashboardUrl: env.AGENT_EXECUTOR_DASHBOARD_URL,
    apiOrigin: env.AGENT_EXECUTOR_API_ORIGIN ?? env.APP_ORIGIN,
    timeoutMs: env.AGENT_EXECUTOR_TIMEOUT_MS ?? 120_000,
  })
  const agentSpike = {
    repository,
    grantSecret: env.AGENT_EXECUTOR_GRANT_SECRET,
    expectedCompatibility: env.AGENT_EXECUTOR_COMPATIBILITY_JSON,
  }
  let dispatcher: AgentRunDispatcher | null = null
  dispatcher =
    runner && supportsAgentRunDispatch(repository)
      ? createAgentRunDispatcher({
          store: repository,
          runner,
          async restoreExecution(actorId, operationId, attempt) {
            const restored = await restoreAgentSpikeOperationExecution(agentSpike, actorId, operationId, attempt)
            return {
              operation: restored.operation,
              input: {
                operationId: restored.operation.operationId,
                grantToken: restored.grant,
                recoveryGrantToken: restored.recoveryGrant,
              },
            }
          },
          readOperation: (actorId, operationId) => repository.getAgentSpikeOperationOutcome(actorId, operationId),
          async planRun(job, attempt) {
            if (!repository.getAgentWorkspace) throw new Error('Agent workspace persistence is unavailable')
            const durable = repository as Repository & Partial<DurableTurnRepository>
            let turn = await durable.getAgentTurnByDispatch?.(job.actorId, job.id)
            let requestBody: {
              conversationId: string
              taskId: string
              turnId: string
              prompt: string
              attachmentIds: string[]
              projectContext: Array<{ title: string; content: string; status: 'confirmed' }>
            }
            if (turn) {
              requestBody = {
                conversationId: turn.conversationId,
                taskId: turn.taskId,
                turnId: turn.turnId,
                prompt: turn.prompt,
                attachmentIds: turn.attachmentIds,
                projectContext: turn.projectContext.filter(
                  (item): item is { title: string; content: string; status: 'confirmed' } =>
                    item.status === 'confirmed',
                ),
              }
            } else {
              if (job.kind !== 'initial') throw new Error('Durable Agent turn is unavailable')
              const workspace = await repository.getAgentWorkspace(job.actorId, job.projectId)
              if (!workspace) throw new Error('Initial Agent workspace is unavailable')
              const payload = parseAgentProjectWorkspacePayload(workspace.payload, job.actorId, job.projectId)
              const conversation = payload.conversations.find(candidate => candidate.id === job.conversationId)
              const message = conversation?.messages.find(
                candidate => candidate.taskId === job.taskId && candidate.role === 'user',
              )
              if (!conversation || !message?.content) throw new Error('Initial Agent prompt is unavailable')
              requestBody = {
                conversationId: job.conversationId,
                taskId: job.taskId,
                turnId: job.taskId,
                prompt: message.content,
                attachmentIds: message.attachments.map(attachment => attachment.id),
                projectContext: [],
              }
            }

            const mountRoutes = (planningAttempt?: typeof attempt) => {
              const router = new Hono<{ Variables: { actorId: string; accessToken: string } }>()
              router.use('*', async (context, next) => {
                context.set('actorId', job.actorId)
                context.set('accessToken', '')
                await next()
              })
              router.route(
                '/projects',
                createAgentRunRoutes({ repository, env, dispatcher, spike: agentSpike, planningAttempt }),
              )
              router.onError((error, context) => {
                if (!(error instanceof ApiError)) console.error('Internal Agent planning route failed', error)
                return error instanceof ApiError
                  ? context.json({ error: { code: error.code, message: error.message } }, error.status)
                  : context.json({ error: { code: 'INTERNAL', message: 'Internal error' } }, 500)
              })
              return router
            }
            if (!turn) {
              const enqueueResponse = await mountRoutes().request(
                new Request(`http://internal/projects/${job.projectId}/agent/runs`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(requestBody),
                }),
              )
              if (!enqueueResponse.ok) {
                const enqueueBody = (await enqueueResponse.json()) as {
                  error?: { code?: string; message?: string }
                }
                const status =
                  enqueueResponse.status === 400 ||
                  enqueueResponse.status === 401 ||
                  enqueueResponse.status === 403 ||
                  enqueueResponse.status === 404 ||
                  enqueueResponse.status === 409 ||
                  enqueueResponse.status === 413 ||
                  enqueueResponse.status === 415 ||
                  enqueueResponse.status === 422 ||
                  enqueueResponse.status === 429 ||
                  enqueueResponse.status === 503
                    ? enqueueResponse.status
                    : 500
                throw new ApiError(
                  status,
                  enqueueBody.error?.code ?? 'AGENT_INITIAL_TURN_PERSISTENCE_FAILED',
                  enqueueBody.error?.message ?? `Initial Agent turn persistence failed (${enqueueResponse.status})`,
                )
              }
              turn = await durable.getAgentTurnByDispatch?.(job.actorId, job.id)
              if (!turn) throw new Error('Initial Agent turn persistence did not bind the dispatch')
            }
            const response = await mountRoutes(attempt).request(
              new Request(`http://internal/projects/${job.projectId}/agent/runs`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(requestBody),
              }),
            )
            const body = (await response.json()) as { kind?: string; error?: { code?: string; message?: string } }
            if (body.error?.code === 'AGENT_PROVIDER_BILLING_INDETERMINATE') return 'billing_indeterminate'
            if (body.error?.code === 'AGENT_PROVIDER_FAILED_DEFINITE') {
              if (job.attemptCount < 3) return 'retry'
              throw new Error('Provider failed before accepting the bounded final attempt')
            }
            if (body.error?.code === 'AGENT_PROVIDER_RETRYABLE') {
              return job.attemptCount < 3 ? 'retry' : 'billing_indeterminate'
            }
            if (!response.ok) {
              throw new ApiError(
                500,
                body.error?.code ?? 'AGENT_PLANNING_FAILED',
                body.error?.message ?? `Agent planning failed (${response.status})`,
              )
            }
            return body.kind === 'waiting_user' ? 'waiting_user' : 'ready'
          },
          failOperation: repository.failAgentSpikeOperation
            ? (actorId, operation, outcome) =>
                repository.failAgentSpikeOperation!(actorId, operationBinding(operation), outcome)
            : undefined,
        })
      : null
  const app = createApp({
    env,
    auth: createSupabaseAuthService(env),
    repository,
    runner,
    dispatcher,
    provisionPersonalSpace: async user => {
      await repository.ensurePersonalSpace(user.id)
    },
  })

  return { app, dispatcher }
}

export function createRuntimeApp() {
  return createRuntime().app
}
