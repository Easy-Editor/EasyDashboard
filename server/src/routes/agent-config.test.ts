import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import { type AppVariables, requireAuth } from '../middleware/auth.js'
import type { AuthService, ProjectRecord, Repository } from '../types.js'
import {
  type AgentConfigRouteOptions,
  createAgentConfigRoutes,
  probeOpenAiCompatibleModel,
  resolveAgentModelRuntime,
} from './agent-config.js'

const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }
const projectId = '22222222-2222-4222-8222-222222222222'
const encryptionKey = Buffer.alloc(32, 5).toString('base64')

function auth(): AuthService {
  return {
    getUser: async (token: string) => (token === 'access' ? actor : null),
    refresh: async () => {
      throw new Error('not refreshable')
    },
  } as unknown as AuthService
}

function createHarness(options: Partial<AgentConfigRouteOptions> = {}, access: { owner?: boolean } = {}) {
  let settings: Record<string, unknown> = { displayName: 'Owner' }
  let projectConfig: Record<string, unknown> | null = null
  const repository = {
    getProject: vi.fn(async (_actorId: string, requestedProjectId: string) =>
      requestedProjectId === projectId ? ({ id: projectId } as ProjectRecord) : null,
    ),
    getSettings: vi.fn(async () => structuredClone(settings)),
    updateSettings: vi.fn(async (_actorId: string, next: Record<string, unknown>) => {
      settings = { ...settings, ...structuredClone(next) }
      return structuredClone(settings)
    }),
    compareAndSetAgentUserModelConfig: vi.fn(
      async (_actorId: string, expected: Record<string, unknown>, config: Record<string, unknown>) => {
        const document = (settings.agentModelConfiguration ?? null) as {
          version: 1
          user?: Record<string, unknown>
          projects: Record<string, unknown>
        } | null
        if (!document?.user || JSON.stringify(document.user) !== JSON.stringify(expected)) return false
        document.user = structuredClone(config)
        return true
      },
    ),
    getAgentBudgetUsage: vi.fn(async () => ({ taskMicros: 850_000, projectMonthMicros: 7_500_000 })),
    isProjectOwner: vi.fn(async () => access.owner ?? true),
    getAgentProjectModelConfig: vi.fn(async () => structuredClone(projectConfig)),
    updateAgentProjectModelConfig: vi.fn(
      async (_actorId: string, _projectId: string, config: Record<string, unknown>) => {
        if (!(access.owner ?? true)) return false
        projectConfig = structuredClone(config)
        return true
      },
    ),
    compareAndSetAgentProjectModelConfig: vi.fn(
      async (
        _actorId: string,
        _projectId: string,
        expected: Record<string, unknown>,
        config: Record<string, unknown>,
      ) => {
        if (!(access.owner ?? true) || JSON.stringify(projectConfig) !== JSON.stringify(expected)) return false
        projectConfig = structuredClone(config)
        return true
      },
    ),
  } satisfies Pick<Repository, 'getProject' | 'getSettings' | 'updateSettings'> &
    Required<
      Pick<
        Repository,
        | 'compareAndSetAgentProjectModelConfig'
        | 'compareAndSetAgentUserModelConfig'
        | 'getAgentBudgetUsage'
        | 'getAgentProjectModelConfig'
        | 'isProjectOwner'
        | 'updateAgentProjectModelConfig'
      >
    >
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('/agent/*', requireAuth(auth()))
  app.route(
    '/agent',
    createAgentConfigRoutes({
      repository,
      env: {
        EASY_EDITOR_AGENT_BASE_URL: 'https://platform.example.com/v1',
        EASY_EDITOR_AGENT_API_KEY: 'platform-key',
        EASY_EDITOR_AGENT_MODEL: 'platform-model',
        AGENT_MODEL_PROFILE_ENCRYPTION_KEY: encryptionKey,
      },
      ...options,
    }),
  )
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return { app, repository, readProjectConfig: () => projectConfig, readSettings: () => settings }
}

function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://app.example.com/agent${path}`, {
    method,
    headers: {
      cookie: '__Host-ed-access-token=access',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function customConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope: 'user',
    provider: 'openai-compatible',
    endpoint: 'https://models.example.com/v1',
    model: 'vision-tool-model',
    apiKey: 'sk-user-private',
    fallbackToPlatform: false,
    budget: { taskMicros: 1_000_000, projectMonthMicros: 10_000_000, warningRatio: 0.8 },
    ...overrides,
  }
}

describe('Agent model configuration routes', () => {
  it('gives the platform profile enough default budget for one material-rich dashboard turn', async () => {
    const { repository } = createHarness()
    const runtime = await resolveAgentModelRuntime(
      {
        repository,
        env: {
          EASY_EDITOR_AGENT_BASE_URL: 'https://platform.example.com/v1',
          EASY_EDITOR_AGENT_API_KEY: 'platform-key',
          EASY_EDITOR_AGENT_MODEL: 'platform-model',
          AGENT_MODEL_PROFILE_ENCRYPTION_KEY: encryptionKey,
        },
      },
      actor.id,
      projectId,
    )

    expect(runtime.budget).toEqual({
      taskMicros: 2_000_000,
      projectMonthMicros: 20_000_000,
      warningRatio: 0.8,
    })
  })

  it('encrypts custom API keys and never returns key material from PUT or GET', async () => {
    const { app, readSettings } = createHarness()
    const saved = await app.request(request('/config', 'PUT', customConfig()))
    const savedText = await saved.text()

    expect(saved.status).toBe(200)
    expect(savedText).toContain('"configured":true')
    expect(savedText).not.toContain('sk-user-private')
    expect(savedText).not.toContain('ciphertext')
    const persisted = JSON.stringify(readSettings())
    expect(persisted).not.toContain('sk-user-private')
    expect(persisted).toContain('aes-256-gcm')
    expect(readSettings()).toMatchObject({ displayName: 'Owner' })

    const loaded = await app.request(request('/config?scope=user'))
    expect(loaded.status).toBe(200)
    const loadedText = await loaded.text()
    expect(loadedText).toContain('"configured":true')
    expect(loadedText).not.toContain('apiKey')
    expect(loadedText).not.toContain('encryptedSecret')
  })

  it('activates the operator-managed platform profile without asking the user to probe platform credentials', async () => {
    const probe = vi.fn<NonNullable<AgentConfigRouteOptions['probe']>>()
    const { app } = createHarness({ probe })
    const platformInput = {
      scope: 'user',
      provider: 'platform',
      fallbackToPlatform: false,
      budget: { taskMicros: 2_000_000, projectMonthMicros: 20_000_000, warningRatio: 0.8 },
    }

    const saved = await app.request(request('/config', 'PUT', platformInput))
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toMatchObject({
      config: {
        provider: 'platform',
        status: 'active',
        capabilities: { vision: true, toolCalling: true, structuredOutput: true },
      },
    })

    const verified = await app.request(request('/config/probe', 'POST', { scope: 'user' }))
    expect(verified.status).toBe(200)
    await expect(verified.json()).resolves.toMatchObject({ config: { status: 'active' }, platformConfigured: true })
    expect(probe).not.toHaveBeenCalled()
  })

  it('requires explicit fallback and fixes the warning threshold at 80 percent', async () => {
    const { app } = createHarness()
    const missingFallback = customConfig()
    missingFallback.fallbackToPlatform = undefined
    expect((await app.request(request('/config', 'PUT', missingFallback))).status).toBe(422)
    expect(
      (
        await app.request(
          request(
            '/config',
            'PUT',
            customConfig({ budget: { taskMicros: 1, projectMonthMicros: 2, warningRatio: 0.75 } }),
          ),
        )
      ).status,
    ).toBe(422)
  })

  it('preserves an existing encrypted key when updating non-secret configuration', async () => {
    const { app } = createHarness()
    expect((await app.request(request('/config', 'PUT', customConfig()))).status).toBe(200)
    const update = customConfig({ fallbackToPlatform: true })
    update.apiKey = undefined

    const response = await app.request(request('/config', 'PUT', update))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      config: { configured: true, fallbackToPlatform: true },
    })
  })

  it('resolves every endpoint address before probing and activates only all three capabilities', async () => {
    const probe = vi.fn<NonNullable<AgentConfigRouteOptions['probe']>>(async input => {
      expect(input.apiKey).toBe('sk-user-private')
      return { vision: true, toolCalling: true, structuredOutput: true }
    })
    const resolveHost = vi.fn<NonNullable<AgentConfigRouteOptions['resolveHost']>>(async () => ['93.184.216.34'])
    const { app } = createHarness({ probe, resolveHost, now: () => new Date('2026-07-31T12:00:00.000Z') })
    await app.request(request('/config', 'PUT', customConfig()))

    const response = await app.request(request('/config/probe', 'POST', { scope: 'user' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      config: {
        status: 'active',
        capabilities: { vision: true, toolCalling: true, structuredOutput: true },
      },
    })
    expect(resolveHost).toHaveBeenCalledWith('models.example.com')
    expect(probe).toHaveBeenCalledOnce()
  })

  it('blocks mixed public/private DNS answers before any probe request', async () => {
    const probe = vi.fn<NonNullable<AgentConfigRouteOptions['probe']>>()
    const { app } = createHarness({
      probe,
      resolveHost: async () => ['93.184.216.34', '127.0.0.1'],
    })
    await app.request(request('/config', 'PUT', customConfig()))

    const response = await app.request(request('/config/probe', 'POST', { scope: 'user' }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PRIVATE_ENDPOINT' } })
    expect(probe).not.toHaveBeenCalled()
    const loaded = await app.request(request('/config?scope=user'))
    await expect(loaded.json()).resolves.toMatchObject({ config: { status: 'failed', capabilities: null } })
  })

  it('does not activate when any required model capability is missing', async () => {
    const { app } = createHarness({
      resolveHost: async () => ['93.184.216.34'],
      probe: async () => ({ vision: true, toolCalling: false, structuredOutput: true }),
    })
    await app.request(request('/config', 'PUT', customConfig()))

    const response = await app.request(request('/config/probe', 'POST', { scope: 'user' }))

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'MODEL_CAPABILITY_PROBE_FAILED' } })
    const loaded = await app.request(request('/config?scope=user'))
    await expect(loaded.json()).resolves.toMatchObject({ config: { status: 'failed', capabilities: null } })
  })

  it('requires project access for project-scoped configuration', async () => {
    const { app } = createHarness()
    const response = await app.request(
      request('/config', 'PUT', customConfig({ scope: 'project', projectId: '33333333-3333-4333-8333-333333333333' })),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } })
  })

  it('requires project ownership to read, update, or probe project configuration', async () => {
    const { app, repository } = createHarness({}, { owner: false })
    const input = customConfig({ scope: 'project', projectId })

    for (const response of [
      await app.request(request(`/config?scope=project&projectId=${projectId}`)),
      await app.request(request('/config', 'PUT', input)),
      await app.request(request('/config/probe', 'POST', { scope: 'project', projectId })),
    ]) {
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'PROJECT_OWNER_REQUIRED' } })
    }
    expect((await app.request(request(`/config/usage?projectId=${projectId}&taskId=task-1`))).status).toBe(200)
    expect(repository.updateAgentProjectModelConfig).not.toHaveBeenCalled()
  })

  it('stores project configuration on the project authority instead of owner user settings', async () => {
    const { app, repository, readProjectConfig, readSettings } = createHarness()

    const saved = await app.request(request('/config', 'PUT', customConfig({ scope: 'project', projectId })))

    expect(saved.status).toBe(200)
    expect(repository.updateAgentProjectModelConfig).toHaveBeenCalledWith(
      actor.id,
      projectId,
      expect.objectContaining({ version: 1, config: expect.any(Object) }),
    )
    expect(readProjectConfig()).toMatchObject({
      config: { profile: { id: `project:${projectId}`, billingScope: 'project' } },
    })
    expect(readSettings()).toEqual({ displayName: 'Owner' })
  })

  it('resolves the same project-owned platform budget for another project actor', async () => {
    const { app, repository } = createHarness()
    await app.request(request('/config', 'PUT', customConfig({ scope: 'project', projectId, provider: 'platform' })))

    const runtime = await resolveAgentModelRuntime(
      {
        repository,
        env: {
          EASY_EDITOR_AGENT_BASE_URL: 'https://platform.example.com/v1',
          EASY_EDITOR_AGENT_API_KEY: 'platform-key',
          EASY_EDITOR_AGENT_MODEL: 'platform-model',
          AGENT_MODEL_PROFILE_ENCRYPTION_KEY: encryptionKey,
        },
      },
      '33333333-3333-4333-8333-333333333333',
      projectId,
    )

    expect(runtime).toMatchObject({ source: 'project', billingScope: 'project', payerId: projectId })
  })

  it('returns current ledger usage against the same effective limits and 80 percent warning', async () => {
    const { app, repository } = createHarness()
    await app.request(request('/config', 'PUT', customConfig()))

    const response = await app.request(request(`/config/usage?projectId=${projectId}&taskId=task-1`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      warningRatio: 0.8,
      task: { usedMicros: 850_000, limitMicros: 1_000_000, ratio: 0.85, state: 'warning' },
      projectMonth: { usedMicros: 7_500_000, limitMicros: 10_000_000, ratio: 0.75, state: 'ok' },
    })
    expect(repository.getAgentBudgetUsage).toHaveBeenCalledWith(actor.id, {
      projectId,
      taskId: 'task-1',
      billingScope: 'user',
      payerId: actor.id,
    })
  })

  it('uses project-wide payer scope when a project-authoritative budget exists', async () => {
    const { app, repository } = createHarness()
    await app.request(request('/config', 'PUT', customConfig({ scope: 'project', projectId })))

    await app.request(request(`/config/usage?projectId=${projectId}&taskId=task-1`))

    expect(repository.getAgentBudgetUsage).toHaveBeenCalledWith(actor.id, {
      projectId,
      taskId: 'task-1',
      billingScope: 'project',
      payerId: projectId,
    })
  })

  it('uses the enforcement floor when calculating the 80 percent warning threshold', async () => {
    const { app, repository } = createHarness()
    repository.getAgentBudgetUsage.mockResolvedValueOnce({ taskMicros: 2, projectMonthMicros: 0 })
    await app.request(
      request('/config', 'PUT', customConfig({ budget: { taskMicros: 3, projectMonthMicros: 10, warningRatio: 0.8 } })),
    )

    const response = await app.request(request(`/config/usage?projectId=${projectId}&taskId=task-1`))

    await expect(response.json()).resolves.toMatchObject({ task: { ratio: 2 / 3, state: 'warning' } })
  })

  it.each(['user', 'project'] as const)(
    'never overwrites a concurrent %s configuration update when a probe finalizes',
    async scope => {
      let releaseProbe!: () => void
      let markProbeStarted!: () => void
      const probeStarted = new Promise<void>(resolve => {
        markProbeStarted = resolve
      })
      const probeReleased = new Promise<void>(resolve => {
        releaseProbe = resolve
      })
      const probe = vi.fn<NonNullable<AgentConfigRouteOptions['probe']>>(async () => {
        markProbeStarted()
        await probeReleased
        return { vision: true, toolCalling: true, structuredOutput: true }
      })
      const { app } = createHarness({ probe, resolveHost: async () => ['93.184.216.34'] })
      const scoped = scope === 'project' ? { scope, projectId } : { scope }
      expect((await app.request(request('/config', 'PUT', customConfig(scoped)))).status).toBe(200)

      const inFlightProbe = app.request(request('/config/probe', 'POST', scoped))
      await probeStarted
      const replacement = customConfig({
        ...scoped,
        model: 'concurrently-updated-model',
        apiKey: 'sk-concurrent',
        budget: { taskMicros: 2_000_000, projectMonthMicros: 30_000_000, warningRatio: 0.8 },
      })
      expect((await app.request(request('/config', 'PUT', replacement))).status).toBe(200)
      releaseProbe()

      const probeResponse = await inFlightProbe
      expect(probeResponse.status).toBe(409)
      await expect(probeResponse.json()).resolves.toMatchObject({ error: { code: 'MODEL_PROFILE_CHANGED' } })
      const query = scope === 'project' ? `?scope=project&projectId=${projectId}` : '?scope=user'
      await expect((await app.request(request(`/config${query}`))).json()).resolves.toMatchObject({
        config: {
          model: 'concurrently-updated-model',
          status: 'unverified',
          budget: { taskMicros: 2_000_000, projectMonthMicros: 30_000_000 },
        },
      })
    },
  )

  it('does not overwrite an update that wins immediately before the initial probing transition', async () => {
    const { app, repository } = createHarness({
      probe: async () => ({ vision: true, toolCalling: true, structuredOutput: true }),
    })
    expect((await app.request(request('/config', 'PUT', customConfig()))).status).toBe(200)
    repository.compareAndSetAgentUserModelConfig.mockImplementationOnce(async () => {
      const concurrent = customConfig({ model: 'winner-before-probing', apiKey: 'sk-winner' })
      expect((await app.request(request('/config', 'PUT', concurrent))).status).toBe(200)
      return false
    })

    const response = await app.request(request('/config/probe', 'POST', { scope: 'user' }))

    expect(response.status).toBe(409)
    await expect((await app.request(request('/config?scope=user'))).json()).resolves.toMatchObject({
      config: { model: 'winner-before-probing', status: 'unverified' },
    })
  })
})

describe('OpenAI-compatible capability probe', () => {
  it('performs separate vision, tool-calling, and structured-output requests with redirects disabled', async () => {
    const modelFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'white' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'call-1' }] } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    await expect(
      probeOpenAiCompatibleModel({
        endpoint: new URL('https://models.example.com/v1/'),
        apiKey: 'server-only',
        model: 'test-model',
        fetch: modelFetch,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({ vision: true, toolCalling: true, structuredOutput: true })
    expect(modelFetch).toHaveBeenCalledTimes(3)
    for (const [url, init] of modelFetch.mock.calls) {
      expect(String(url)).toBe('https://models.example.com/v1/chat/completions')
      expect(init?.redirect).toBe('manual')
    }
  })
})
