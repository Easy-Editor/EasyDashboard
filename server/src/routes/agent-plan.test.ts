import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import { type AppVariables, requireAuth } from '../middleware/auth.js'
import type { AuthService, Repository } from '../types.js'
import { type AgentPlanRouteOptions, createAgentPlanRoutes } from './agent-plan.js'

const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }
const projectId = '22222222-2222-4222-8222-222222222222'
const editableProject = {
  id: projectId,
  draftVersion: 7,
  draftSchema: { version: 1, pages: [] },
}
const configuredEnv = {
  EASY_EDITOR_AGENT_BASE_URL: 'https://model.example.com/v1/',
  EASY_EDITOR_AGENT_API_KEY: 'server-only-api-key',
  EASY_EDITOR_AGENT_MODEL: 'planner-model',
}

function auth(): AuthService {
  return {
    getUser: async (token: string) => (token === 'access' ? actor : null),
    refresh: async () => {
      throw new Error('not refreshable')
    },
  } as unknown as AuthService
}

function createTestApp(
  repository: Pick<Repository, 'getEditableProjectForAgentSpike'>,
  options: Partial<Omit<AgentPlanRouteOptions, 'repository'>> = {},
) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('/agent/*', requireAuth(auth()))
  app.use('/agent', requireAuth(auth()))
  app.route(
    '/agent',
    createAgentPlanRoutes({
      repository: repository as Repository,
      env: configuredEnv,
      ...options,
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

function planRequest(cookie = '__Host-ed-access-token=access') {
  return new Request('https://app.example.com/agent/plan', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      projectId,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      prompt: '为城市管理中心规划一张 1920x1080 的综合态势大屏',
      attachments: [],
      projectContext: [],
    }),
  })
}

describe('retired Agent planning route', () => {
  it('requires authentication before checking project authority', async () => {
    const getEditableProjectForAgentSpike = vi.fn<Repository['getEditableProjectForAgentSpike']>()
    const modelFetch = vi.fn<typeof fetch>()
    const app = createTestApp({ getEditableProjectForAgentSpike }, { fetch: modelFetch })

    const response = await app.request(planRequest(''))

    expect(response.status).toBe(401)
    expect(getEditableProjectForAgentSpike).not.toHaveBeenCalled()
    expect(modelFetch).not.toHaveBeenCalled()
  })

  it('does not let a project viewer trigger the legacy planning model', async () => {
    const getEditableProjectForAgentSpike = vi.fn<Repository['getEditableProjectForAgentSpike']>(async () => null)
    const modelFetch = vi.fn<typeof fetch>()
    const app = createTestApp({ getEditableProjectForAgentSpike }, { fetch: modelFetch })

    const response = await app.request(planRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'PROJECT_NOT_EDITABLE', message: 'Editable project not found' },
    })
    expect(getEditableProjectForAgentSpike).toHaveBeenCalledWith(actor.id, projectId)
    expect(modelFetch).not.toHaveBeenCalled()
  })

  it('retires the direct planning-model path instead of bypassing the persisted run cost ledger', async () => {
    const getEditableProjectForAgentSpike = vi.fn<Repository['getEditableProjectForAgentSpike']>(
      async () => editableProject,
    )
    const modelFetch = vi.fn<typeof fetch>()
    const app = createTestApp({ getEditableProjectForAgentSpike }, { fetch: modelFetch })

    const response = await app.request(planRequest())

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'AGENT_PLAN_ROUTE_RETIRED',
        message: 'Direct Agent planning is retired; start a persisted Agent run instead',
      },
    })
    expect(getEditableProjectForAgentSpike).toHaveBeenCalledWith(actor.id, projectId)
    expect(modelFetch).not.toHaveBeenCalled()
  })
})
