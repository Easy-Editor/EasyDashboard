import { Hono } from 'hono'
import { z } from 'zod'
import type { BudgetLimit } from '../agent/cost-ledger.js'
import {
  type EncryptedModelProfileSecret,
  decryptModelProfileApiKey,
  encryptModelProfileApiKey,
} from '../agent/model-profile-crypto.js'
import {
  type ModelCapabilities,
  type ModelProfile,
  ModelProfileError,
  activateModelProfile,
  normalizeCustomModelEndpoint,
  toModelProfileManifest,
} from '../agent/model-profile.js'
import {
  type OutboundHttpsResolver,
  createPinnedHttpsFetch,
  resolvePinnedHttpsTarget,
} from '../agent/outbound-https.js'
import type { AppEnv } from '../env.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'

const SETTINGS_KEY = 'agentModelConfiguration'
const SETTINGS_VERSION = 1 as const
const MAX_PROBE_RESPONSE_BYTES = 1_000_000
const DEFAULT_PROBE_TIMEOUT_MS = 15_000

type AgentConfigScope = 'user' | 'project'

interface StoredAgentModelConfig {
  profile: Omit<ModelProfile, 'secret'> & { secret: null }
  encryptedSecret?: EncryptedModelProfileSecret
  budget: BudgetLimit
}

interface StoredAgentConfigDocument {
  version: typeof SETTINGS_VERSION
  user?: StoredAgentModelConfig
  projects: Record<string, StoredAgentModelConfig>
}

interface StoredAgentProjectConfigDocument {
  version: typeof SETTINGS_VERSION
  config: StoredAgentModelConfig
}

export interface ResolvedAgentModelRuntime {
  profileId: string
  provider: 'platform' | 'openai-compatible'
  endpoint: URL
  apiKey: string
  model: string
  budget: BudgetLimit
  capabilities: ModelCapabilities
  billingScope: 'project' | 'user'
  payerId: string
  source: 'project' | 'user' | 'platform-default' | 'platform-fallback'
}

const DEFAULT_AGENT_BUDGET: BudgetLimit = {
  taskMicros: 2_000_000,
  projectMonthMicros: 20_000_000,
  warningRatio: 0.8,
}

export interface AgentModelProbeInput {
  endpoint: URL
  apiKey: string
  model: string
  fetch: typeof fetch
  timeoutMs: number
}

export type AgentModelProbe = (input: AgentModelProbeInput) => Promise<ModelCapabilities>
export type AgentEndpointResolver = OutboundHttpsResolver

export interface AgentConfigRouteOptions {
  repository: Pick<
    Repository,
    | 'getAgentBudgetUsage'
    | 'getAgentProjectModelConfig'
    | 'getProject'
    | 'getSettings'
    | 'isProjectOwner'
    | 'compareAndSetAgentProjectModelConfig'
    | 'compareAndSetAgentUserModelConfig'
    | 'updateAgentProjectModelConfig'
    | 'updateSettings'
  >
  env: Pick<
    AppEnv,
    | 'EASY_EDITOR_AGENT_BASE_URL'
    | 'EASY_EDITOR_AGENT_API_KEY'
    | 'EASY_EDITOR_AGENT_MODEL'
    | 'AGENT_MODEL_PROFILE_ENCRYPTION_KEY'
  >
  probe?: AgentModelProbe
  resolveHost?: AgentEndpointResolver
  now?: () => Date
}

const budgetSchema = z
  .object({
    taskMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    projectMonthMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    warningRatio: z.literal(0.8).default(0.8),
  })
  .strict()

const scopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('user') }).strict(),
  z.object({ scope: z.literal('project'), projectId: z.uuid() }).strict(),
])

const usageQuerySchema = z.object({ projectId: z.uuid(), taskId: z.string().trim().min(1).max(160) }).strict()

const putSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('user'),
      provider: z.enum(['platform', 'openai-compatible']),
      endpoint: z.string().trim().min(1).max(2_048).optional(),
      model: z.string().trim().min(1).max(200).optional(),
      apiKey: z.string().min(1).max(16_384).optional(),
      fallbackToPlatform: z.boolean(),
      budget: budgetSchema,
    })
    .strict(),
  z
    .object({
      scope: z.literal('project'),
      projectId: z.uuid(),
      provider: z.enum(['platform', 'openai-compatible']),
      endpoint: z.string().trim().min(1).max(2_048).optional(),
      model: z.string().trim().min(1).max(200).optional(),
      apiKey: z.string().min(1).max(16_384).optional(),
      fallbackToPlatform: z.boolean(),
      budget: budgetSchema,
    })
    .strict(),
])

function emptyDocument(): StoredAgentConfigDocument {
  return { version: SETTINGS_VERSION, projects: {} }
}

function readStoredDocument(settings: Record<string, unknown>): StoredAgentConfigDocument {
  const value = settings[SETTINGS_KEY]
  if (!value || typeof value !== 'object') return emptyDocument()
  const candidate = value as Partial<StoredAgentConfigDocument>
  if (candidate.version !== SETTINGS_VERSION || !candidate.projects || typeof candidate.projects !== 'object') {
    return emptyDocument()
  }
  return structuredClone(candidate as StoredAgentConfigDocument)
}

function readStoredProjectConfig(value: Record<string, unknown> | null): StoredAgentModelConfig | undefined {
  if (!value || value.version !== SETTINGS_VERSION || !value.config || typeof value.config !== 'object')
    return undefined
  return structuredClone((value as unknown as StoredAgentProjectConfigDocument).config)
}

function publicBudgetUsage(usedMicros: number, limitMicros: number, warningRatio: number) {
  const ratio = Math.min(1, usedMicros / limitMicros)
  const warningAtMicros = Math.floor(limitMicros * warningRatio)
  return {
    usedMicros,
    limitMicros,
    ratio,
    state:
      usedMicros >= limitMicros
        ? ('hard_stop' as const)
        : usedMicros >= warningAtMicros
          ? ('warning' as const)
          : ('ok' as const),
  }
}

function profileId(actorId: string, scope: AgentConfigScope, projectId?: string): string {
  return scope === 'user' ? `user:${actorId}` : `project:${projectId ?? 'missing'}`
}

function platformConfigured(env: AgentConfigRouteOptions['env']): boolean {
  return Boolean(env.EASY_EDITOR_AGENT_BASE_URL && env.EASY_EDITOR_AGENT_API_KEY && env.EASY_EDITOR_AGENT_MODEL)
}

function platformRuntime(
  options: AgentConfigRouteOptions,
  budget: BudgetLimit,
  source: ResolvedAgentModelRuntime['source'],
  billingScope: ResolvedAgentModelRuntime['billingScope'],
  payerId: string,
): ResolvedAgentModelRuntime {
  if (!platformConfigured(options.env)) {
    throw new ApiError(503, 'PLATFORM_MODEL_UNAVAILABLE', 'Platform Agent model is not configured')
  }
  return {
    profileId: 'platform:default',
    provider: 'platform',
    endpoint: new URL(options.env.EASY_EDITOR_AGENT_BASE_URL as string),
    apiKey: options.env.EASY_EDITOR_AGENT_API_KEY as string,
    model: options.env.EASY_EDITOR_AGENT_MODEL as string,
    budget,
    capabilities: { vision: true, toolCalling: true, structuredOutput: true },
    billingScope,
    payerId,
    source,
  }
}

async function effectiveConfig(
  options: AgentConfigRouteOptions,
  actorId: string,
  projectId: string,
): Promise<{
  config: StoredAgentModelConfig | undefined
  source: 'project' | 'user' | 'platform-default'
  billingScope: 'project' | 'user'
  payerId: string
}> {
  const projectConfig = options.repository.getAgentProjectModelConfig
    ? readStoredProjectConfig(await options.repository.getAgentProjectModelConfig(actorId, projectId))
    : undefined
  if (projectConfig) {
    return { config: projectConfig, source: 'project', billingScope: 'project', payerId: projectId }
  }
  const userConfig = readStoredDocument(await options.repository.getSettings(actorId)).user
  if (userConfig) return { config: userConfig, source: 'user', billingScope: 'user', payerId: actorId }
  return { config: undefined, source: 'platform-default', billingScope: 'project', payerId: projectId }
}

/** Resolves the effective model profile for a run without exposing its key. */
export async function resolveAgentModelRuntime(
  options: AgentConfigRouteOptions,
  actorId: string,
  projectId: string,
): Promise<ResolvedAgentModelRuntime> {
  if (!(await options.repository.getProject(actorId, projectId))) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  }
  const effective = await effectiveConfig(options, actorId, projectId)
  const selected = effective.config
  if (!selected) {
    return platformRuntime(options, DEFAULT_AGENT_BUDGET, 'platform-default', effective.billingScope, effective.payerId)
  }
  if (selected.profile.provider === 'platform') {
    return platformRuntime(options, selected.budget, effective.source, effective.billingScope, effective.payerId)
  }
  if (
    selected.profile.status !== 'active' ||
    !selected.profile.capabilities?.structuredOutput ||
    !selected.encryptedSecret
  ) {
    if (selected.profile.fallbackToPlatform) {
      return platformRuntime(options, selected.budget, 'platform-fallback', effective.billingScope, effective.payerId)
    }
    throw new ApiError(503, 'CUSTOM_MODEL_UNAVAILABLE', 'Custom Agent model is not active and verified')
  }
  const encryptionKey = options.env.AGENT_MODEL_PROFILE_ENCRYPTION_KEY
  if (!encryptionKey) {
    if (selected.profile.fallbackToPlatform) {
      return platformRuntime(options, selected.budget, 'platform-fallback', effective.billingScope, effective.payerId)
    }
    throw new ApiError(503, 'MODEL_PROFILE_SECRET_UNAVAILABLE', 'Model profile secret is unavailable')
  }
  let apiKey: string
  try {
    apiKey = decryptModelProfileApiKey({
      secret: selected.encryptedSecret,
      encryptionKey,
      profileId: selected.profile.id,
    })
  } catch {
    if (selected.profile.fallbackToPlatform) {
      return platformRuntime(options, selected.budget, 'platform-fallback', effective.billingScope, effective.payerId)
    }
    throw new ApiError(503, 'MODEL_PROFILE_SECRET_UNAVAILABLE', 'Model profile secret is unavailable')
  }
  const endpoint = normalizeCustomModelEndpoint(selected.profile.endpoint)
  try {
    await resolvePinnedHttpsTarget(endpoint, options.resolveHost)
  } catch (error) {
    if (selected.profile.fallbackToPlatform) {
      return platformRuntime(options, selected.budget, 'platform-fallback', effective.billingScope, effective.payerId)
    }
    throw mapProfileError(error)
  }
  return {
    profileId: selected.profile.id,
    provider: 'openai-compatible',
    endpoint,
    apiKey,
    model: selected.profile.model,
    budget: selected.budget,
    capabilities: selected.profile.capabilities,
    billingScope: effective.billingScope,
    payerId: effective.payerId,
    source: effective.source,
  }
}

function publicConfig(config: StoredAgentModelConfig | undefined, env: AgentConfigRouteOptions['env']) {
  if (!config) return null
  return {
    ...toModelProfileManifest(config.profile),
    endpoint: config.profile.endpoint,
    status: config.profile.status,
    configured: config.profile.provider === 'platform' ? platformConfigured(env) : Boolean(config.encryptedSecret),
    budget: config.budget,
  }
}

async function assertProjectAccess(
  repository: AgentConfigRouteOptions['repository'],
  actorId: string,
  scope: AgentConfigScope,
  projectId?: string,
  ownerOnly = false,
): Promise<void> {
  if (scope !== 'project') return
  if (!projectId || !(await repository.getProject(actorId, projectId))) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  }
  if (ownerOnly) {
    if (!repository.isProjectOwner) {
      throw new ApiError(503, 'PROJECT_OWNERSHIP_UNAVAILABLE', 'Project ownership verification is unavailable')
    }
    if (!(await repository.isProjectOwner(actorId, projectId))) {
      throw new ApiError(403, 'PROJECT_OWNER_REQUIRED', 'Only the project owner can manage project Agent settings')
    }
  }
}

async function writeDocument(
  repository: AgentConfigRouteOptions['repository'],
  actorId: string,
  document: StoredAgentConfigDocument,
): Promise<void> {
  await repository.updateSettings(actorId, { [SETTINGS_KEY]: document })
}

async function readScopedConfig(
  repository: AgentConfigRouteOptions['repository'],
  actorId: string,
  scope: AgentConfigScope,
  projectId?: string,
): Promise<StoredAgentModelConfig | undefined> {
  if (scope === 'user') return readStoredDocument(await repository.getSettings(actorId)).user
  if (!projectId || !repository.getAgentProjectModelConfig) {
    throw new ApiError(503, 'PROJECT_AGENT_CONFIG_UNAVAILABLE', 'Project Agent configuration is unavailable')
  }
  return readStoredProjectConfig(await repository.getAgentProjectModelConfig(actorId, projectId))
}

async function writeScopedConfig(
  repository: AgentConfigRouteOptions['repository'],
  actorId: string,
  scope: AgentConfigScope,
  config: StoredAgentModelConfig,
  projectId?: string,
): Promise<void> {
  if (scope === 'user') {
    const settings = await repository.getSettings(actorId)
    const document = readStoredDocument(settings)
    document.user = config
    await writeDocument(repository, actorId, document)
    return
  }
  if (!projectId || !repository.updateAgentProjectModelConfig) {
    throw new ApiError(503, 'PROJECT_AGENT_CONFIG_UNAVAILABLE', 'Project Agent configuration is unavailable')
  }
  const saved = await repository.updateAgentProjectModelConfig(actorId, projectId, {
    version: SETTINGS_VERSION,
    config,
  } satisfies StoredAgentProjectConfigDocument)
  if (!saved)
    throw new ApiError(403, 'PROJECT_OWNER_REQUIRED', 'Only the project owner can manage project Agent settings')
}

async function compareAndSetScopedConfig(
  repository: AgentConfigRouteOptions['repository'],
  actorId: string,
  scope: AgentConfigScope,
  expected: StoredAgentModelConfig,
  config: StoredAgentModelConfig,
  projectId?: string,
): Promise<boolean> {
  if (scope === 'user') {
    if (!repository.compareAndSetAgentUserModelConfig) {
      throw new ApiError(503, 'AGENT_CONFIG_CAS_UNAVAILABLE', 'Atomic Agent configuration updates are unavailable')
    }
    return repository.compareAndSetAgentUserModelConfig(
      actorId,
      expected as unknown as Record<string, unknown>,
      config as unknown as Record<string, unknown>,
    )
  }
  if (!projectId || !repository.compareAndSetAgentProjectModelConfig) {
    throw new ApiError(503, 'PROJECT_AGENT_CONFIG_UNAVAILABLE', 'Project Agent configuration is unavailable')
  }
  return repository.compareAndSetAgentProjectModelConfig(
    actorId,
    projectId,
    { version: SETTINGS_VERSION, config: expected } satisfies StoredAgentProjectConfigDocument,
    { version: SETTINGS_VERSION, config } satisfies StoredAgentProjectConfigDocument,
  )
}

async function throwProbeConflict(
  repository: AgentConfigRouteOptions['repository'],
  actorId: string,
  scope: AgentConfigScope,
  projectId?: string,
): Promise<never> {
  if (scope === 'project' && projectId && repository.isProjectOwner) {
    if (!(await repository.isProjectOwner(actorId, projectId))) {
      throw new ApiError(403, 'PROJECT_OWNER_REQUIRED', 'Only the project owner can manage project Agent settings')
    }
  }
  throw new ApiError(409, 'MODEL_PROFILE_CHANGED', 'Model configuration changed while the probe was running')
}

function configuredProfileInput(
  input: z.infer<typeof putSchema>,
  actorId: string,
  existing: StoredAgentModelConfig | undefined,
  options: AgentConfigRouteOptions,
): StoredAgentModelConfig {
  const id = profileId(actorId, input.scope, input.scope === 'project' ? input.projectId : undefined)
  const now = (options.now?.() ?? new Date()).toISOString()
  let endpoint: string
  let model: string
  let encryptedSecret: EncryptedModelProfileSecret | undefined

  if (input.provider === 'platform') {
    if (!platformConfigured(options.env)) {
      throw new ApiError(503, 'PLATFORM_MODEL_UNAVAILABLE', 'Platform Agent model is not configured')
    }
    endpoint = options.env.EASY_EDITOR_AGENT_BASE_URL as string
    model = options.env.EASY_EDITOR_AGENT_MODEL as string
  } else {
    if (!input.endpoint || !input.model) {
      throw new ApiError(422, 'MODEL_PROFILE_INCOMPLETE', 'Custom model endpoint and model are required')
    }
    endpoint = normalizeCustomModelEndpoint(input.endpoint).toString()
    model = input.model
    if (input.apiKey) {
      const encryptionKey = options.env.AGENT_MODEL_PROFILE_ENCRYPTION_KEY
      if (!encryptionKey) {
        throw new ApiError(503, 'MODEL_PROFILE_ENCRYPTION_UNAVAILABLE', 'Model profile encryption is not configured')
      }
      encryptedSecret = encryptModelProfileApiKey({ apiKey: input.apiKey, encryptionKey, profileId: id })
    } else if (existing?.profile.provider === 'openai-compatible') {
      encryptedSecret = existing.encryptedSecret
    }
    if (!encryptedSecret) {
      throw new ApiError(422, 'MODEL_API_KEY_REQUIRED', 'Custom model API key is required')
    }
  }

  const modelChanged =
    !existing ||
    existing.profile.provider !== input.provider ||
    existing.profile.endpoint !== endpoint ||
    existing.profile.model !== model ||
    Boolean(input.apiKey)
  const platformCapabilities = { vision: true, toolCalling: true, structuredOutput: true } as const
  return {
    profile: {
      id,
      ownerId: actorId,
      projectId: input.scope === 'project' ? input.projectId : null,
      provider: input.provider,
      endpoint,
      model,
      billingScope: input.scope,
      fallbackToPlatform: input.fallbackToPlatform,
      status: input.provider === 'platform' ? 'active' : modelChanged ? 'unverified' : existing.profile.status,
      capabilities:
        input.provider === 'platform' ? platformCapabilities : modelChanged ? null : existing.profile.capabilities,
      secret: null,
      createdAt: existing?.profile.createdAt ?? now,
      updatedAt: now,
    },
    ...(encryptedSecret ? { encryptedSecret } : {}),
    budget: input.budget,
  }
}

function completionsUrl(endpoint: URL): URL {
  const path = endpoint.pathname.endsWith('/') ? endpoint.pathname : `${endpoint.pathname}/`
  return new URL(`${path}chat/completions`, endpoint.origin)
}

async function probeRequest(
  input: AgentModelProbeInput,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await input.fetch(completionsUrl(input.endpoint), {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: input.model, max_tokens: 80, ...body }),
    signal: AbortSignal.timeout(input.timeoutMs),
  })
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new ModelProfileError('CAPABILITY_PROBE_FAILED', 'Model capability probe request failed')
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_PROBE_RESPONSE_BYTES) {
    throw new ModelProfileError('CAPABILITY_PROBE_FAILED', 'Model capability probe response is too large')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_PROBE_RESPONSE_BYTES) {
    throw new ModelProfileError('CAPABILITY_PROBE_FAILED', 'Model capability probe response is too large')
  }
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') {
    throw new ModelProfileError('CAPABILITY_PROBE_FAILED', 'Model capability probe returned invalid JSON')
  }
  return parsed as Record<string, unknown>
}

function firstMessage(payload: Record<string, unknown>): Record<string, unknown> | null {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const first = choices[0]
  if (!first || typeof first !== 'object') return null
  const message = (first as Record<string, unknown>).message
  return message && typeof message === 'object' ? (message as Record<string, unknown>) : null
}

export async function probeOpenAiCompatibleModel(input: AgentModelProbeInput): Promise<ModelCapabilities> {
  const vision = await probeRequest(input, {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with the color of this one-pixel image.' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
            },
          },
        ],
      },
    ],
  })
  const visionMessage = firstMessage(vision)
  const visionPassed = typeof visionMessage?.content === 'string' && visionMessage.content.trim().length > 0

  const toolCalling = await probeRequest(input, {
    messages: [{ role: 'user', content: 'Call the capability_probe tool exactly once.' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'capability_probe',
          description: 'Returns probe success.',
          parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'capability_probe' } },
  })
  const toolCalls = firstMessage(toolCalling)?.tool_calls
  const toolCallingPassed = Array.isArray(toolCalls) && toolCalls.length > 0

  const structured = await probeRequest(input, {
    messages: [{ role: 'user', content: 'Return JSON with ok=true.' }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'capability_probe',
        strict: true,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean', const: true } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    },
  })
  const structuredContent = firstMessage(structured)?.content
  let structuredOutputPassed = false
  if (typeof structuredContent === 'string') {
    try {
      structuredOutputPassed = (JSON.parse(structuredContent) as { ok?: unknown }).ok === true
    } catch {
      structuredOutputPassed = false
    }
  }

  return { vision: visionPassed, toolCalling: toolCallingPassed, structuredOutput: structuredOutputPassed }
}

function mapProfileError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof ModelProfileError) {
    if (error.code === 'INVALID_ENDPOINT' || error.code === 'PRIVATE_ENDPOINT') {
      return new ApiError(422, error.code, error.message)
    }
    return new ApiError(422, 'MODEL_CAPABILITY_PROBE_FAILED', error.message)
  }
  return new ApiError(503, 'MODEL_CAPABILITY_PROBE_UNAVAILABLE', 'Model capability probe could not be completed')
}

export function createAgentConfigRoutes(options: AgentConfigRouteOptions) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.get('/config', async c => {
    const parsed = scopeSchema.safeParse({
      scope: c.req.query('scope') ?? 'user',
      ...(c.req.query('projectId') ? { projectId: c.req.query('projectId') } : {}),
    })
    if (!parsed.success) throw new ApiError(422, 'VALIDATION_FAILED', 'Agent configuration scope is invalid')
    const actorId = c.get('actorId')
    const projectId = parsed.data.scope === 'project' ? parsed.data.projectId : undefined
    await assertProjectAccess(options.repository, actorId, parsed.data.scope, projectId, true)
    const config = await readScopedConfig(options.repository, actorId, parsed.data.scope, projectId)
    return c.json({ config: publicConfig(config, options.env), platformConfigured: platformConfigured(options.env) })
  })

  routes.get('/config/usage', async c => {
    const parsed = usageQuerySchema.safeParse({
      projectId: c.req.query('projectId'),
      taskId: c.req.query('taskId'),
    })
    if (!parsed.success) throw new ApiError(422, 'VALIDATION_FAILED', 'Agent budget usage query is invalid')
    const actorId = c.get('actorId')
    await assertProjectAccess(options.repository, actorId, 'project', parsed.data.projectId)
    if (!options.repository.getAgentBudgetUsage) {
      throw new ApiError(503, 'AGENT_COST_LEDGER_UNAVAILABLE', 'Agent budget ledger is unavailable')
    }
    const effective = await effectiveConfig(options, actorId, parsed.data.projectId)
    const usage = await options.repository.getAgentBudgetUsage(actorId, {
      projectId: parsed.data.projectId,
      taskId: parsed.data.taskId,
      billingScope: effective.billingScope,
      payerId: effective.payerId,
    })
    if (!usage) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const budget = effective.config?.budget ?? DEFAULT_AGENT_BUDGET
    return c.json({
      warningRatio: budget.warningRatio,
      task: publicBudgetUsage(usage.taskMicros, budget.taskMicros, budget.warningRatio),
      projectMonth: publicBudgetUsage(usage.projectMonthMicros, budget.projectMonthMicros, budget.warningRatio),
    })
  })

  routes.put('/config', async c => {
    const input = await readJson(c, putSchema)
    const actorId = c.get('actorId')
    const projectId = input.scope === 'project' ? input.projectId : undefined
    await assertProjectAccess(options.repository, actorId, input.scope, projectId, true)
    const existing = await readScopedConfig(options.repository, actorId, input.scope, projectId)
    let config: StoredAgentModelConfig
    try {
      config = configuredProfileInput(input, actorId, existing, options)
    } catch (error) {
      throw mapProfileError(error)
    }
    await writeScopedConfig(options.repository, actorId, input.scope, config, projectId)
    return c.json({ config: publicConfig(config, options.env), platformConfigured: platformConfigured(options.env) })
  })

  routes.post('/config/probe', async c => {
    const input = await readJson(c, scopeSchema)
    const actorId = c.get('actorId')
    const projectId = input.scope === 'project' ? input.projectId : undefined
    await assertProjectAccess(options.repository, actorId, input.scope, projectId, true)
    const config = await readScopedConfig(options.repository, actorId, input.scope, projectId)
    if (!config) throw new ApiError(404, 'MODEL_PROFILE_NOT_FOUND', 'Model profile is not configured')

    if (config.profile.provider === 'platform') {
      if (!platformConfigured(options.env)) {
        throw new ApiError(503, 'PLATFORM_MODEL_UNAVAILABLE', 'Platform Agent model is not configured')
      }
      const active = structuredClone(config)
      active.profile.status = 'active'
      active.profile.capabilities = { vision: true, toolCalling: true, structuredOutput: true }
      active.profile.updatedAt = (options.now?.() ?? new Date()).toISOString()
      if (!(await compareAndSetScopedConfig(options.repository, actorId, input.scope, config, active, projectId))) {
        await throwProbeConflict(options.repository, actorId, input.scope, projectId)
      }
      return c.json({ config: publicConfig(active, options.env), platformConfigured: true })
    }

    const encryptionKey = options.env.AGENT_MODEL_PROFILE_ENCRYPTION_KEY
    let apiKey: string
    if (!encryptionKey || !config.encryptedSecret) {
      throw new ApiError(503, 'MODEL_PROFILE_SECRET_UNAVAILABLE', 'Model profile secret is unavailable')
    }
    try {
      apiKey = decryptModelProfileApiKey({
        secret: config.encryptedSecret,
        encryptionKey,
        profileId: config.profile.id,
      })
    } catch {
      throw new ApiError(503, 'MODEL_PROFILE_SECRET_UNAVAILABLE', 'Model profile secret is unavailable')
    }

    const configured = structuredClone(config)
    const probing = structuredClone(config)
    probing.profile.status = 'probing'
    probing.profile.updatedAt = (options.now?.() ?? new Date()).toISOString()
    if (!(await compareAndSetScopedConfig(options.repository, actorId, input.scope, configured, probing, projectId))) {
      await throwProbeConflict(options.repository, actorId, input.scope, projectId)
    }

    try {
      const endpoint =
        probing.profile.provider === 'openai-compatible'
          ? normalizeCustomModelEndpoint(probing.profile.endpoint)
          : new URL(probing.profile.endpoint)
      await resolvePinnedHttpsTarget(endpoint, options.resolveHost)
      const capabilities = await (options.probe ?? probeOpenAiCompatibleModel)({
        endpoint,
        apiKey,
        model: probing.profile.model,
        fetch: createPinnedHttpsFetch({
          resolveHost: options.resolveHost,
          maximumResponseBytes: MAX_PROBE_RESPONSE_BYTES,
        }),
        timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      })
      const active = activateModelProfile({ ...probing.profile, secret: { apiKey } }, capabilities)
      const finalized = structuredClone(probing)
      finalized.profile = {
        ...active,
        secret: null,
        updatedAt: (options.now?.() ?? new Date()).toISOString(),
      }
      if (!(await compareAndSetScopedConfig(options.repository, actorId, input.scope, probing, finalized, projectId))) {
        await throwProbeConflict(options.repository, actorId, input.scope, projectId)
      }
      return c.json({
        config: publicConfig(finalized, options.env),
        platformConfigured: platformConfigured(options.env),
      })
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'MODEL_PROFILE_CHANGED' || error.code === 'PROJECT_OWNER_REQUIRED')
      ) {
        throw error
      }
      const failed = structuredClone(probing)
      failed.profile.status = 'failed'
      failed.profile.capabilities = null
      failed.profile.updatedAt = (options.now?.() ?? new Date()).toISOString()
      if (!(await compareAndSetScopedConfig(options.repository, actorId, input.scope, probing, failed, projectId))) {
        await throwProbeConflict(options.repository, actorId, input.scope, projectId)
      }
      throw mapProfileError(error)
    }
  })

  return routes
}
