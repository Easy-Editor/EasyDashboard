import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { AppEnv } from '../src/env.js'
import type { AuthService, ProjectRecord, Repository } from '../src/types.js'

const actor = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' }
const projectId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-07-29T00:00:00.000Z')
const executorCompatibility = {
  runtimeVersion: '0.1.0-m0',
  runtimeSha256: '1'.repeat(64),
  coreVersion: '1.0.3-m0',
  coreSha256: '2'.repeat(64),
  rendererVersion: '1.0.3-m0',
  rendererSha256: '3'.repeat(64),
  dashboardAgentHostVersion: '0.1.0-m0',
  dashboardAgentHostSha256: '4'.repeat(64),
  browserArtifactVersion: '0.0.0-m0',
  browserArtifactSha256: '6'.repeat(64),
  materialManifestVersion: 'manifest-2026-07-31',
  materialManifestSha256: '5'.repeat(64),
}
const project: ProjectRecord = {
  id: projectId,
  name: 'Dashboard',
  description: null,
  coverUrl: null,
  draftSchema: { componentsTree: [] },
  draftVersion: 2,
  isFavorite: false,
  pageCount: 1,
  canvasWidth: 1920,
  canvasHeight: 1080,
  startPageId: null,
  draftSavedAt: now,
  thumbnailMode: 'auto',
  thumbnailStatus: 'queued',
  thumbnailPath: null,
  thumbnailUrl: null,
  thumbnailDraftVersion: null,
  thumbnailErrorCode: null,
  publishedAt: null,
  currentReleaseNumber: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
}

const env: AppEnv = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'https://app.example.com',
  PUBLIC_VIEWER_ORIGIN: 'https://view.example.com',
  PORT: 8787,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890',
  DATABASE_URL: 'postgresql://test',
}

function auth(overrides: Partial<AuthService> = {}): AuthService {
  return {
    signUp: async () => ({ user: actor, session: null }),
    signIn: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: actor,
    }),
    startOAuth: async provider => ({
      url: `https://example.supabase.co/auth/v1/authorize?provider=${provider}`,
      codeVerifier: 'oauth-verifier',
    }),
    exchangeCode: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: actor,
    }),
    requestPasswordReset: async () => ({ codeVerifier: 'recovery-verifier' }),
    updatePassword: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: actor,
    }),
    refresh: async () => {
      throw new Error('not refreshable')
    },
    getUser: async token => (token === 'access' ? actor : null),
    signOut: async () => undefined,
    ...overrides,
  }
}

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    ping: async () => undefined,
    ensurePersonalSpace: async () => '33333333-3333-4333-8333-333333333333',
    listProjects: async () => [project],
    createProject: async () => project,
    getProject: async () => project,
    listProjectMembers: async () => [],
    setProjectMemberRole: async () => null,
    removeProjectMember: async () => null,
    getEditableProjectForAgentSpike: async () => ({
      id: project.id,
      draftVersion: project.draftVersion,
      draftSchema: project.draftSchema,
    }),
    issueAgentSpikeOperation: async () => null,
    prepareAgentSpikeOperation: async () => null,
    commitAgentSpikeStage: async () => null,
    getAgentSpikeOperationOutcome: async () => null,
    updateProject: async () => project,
    setProjectFavorite: async () => project,
    duplicateProject: async () => project,
    trashProject: async () => true,
    permanentlyDeleteProject: async () => true,
    restoreProject: async () => project,
    saveDraft: async () => project,
    listRevisions: async () => [],
    listReleases: async () => [],
    createRestorePoint: async () => null,
    restoreRevision: async () => null,
    restoreRelease: async () => null,
    createPublishSnapshot: async () => null,
    approvePublishSnapshot: async () => null,
    publish: async () => null,
    unpublish: async () => false,
    isPublicProjectAvailable: async () => false,
    getPublicProject: async () => null,
    getPublicProjectVersion: async () => null,
    createThumbnailUpload: async () => null,
    completeThumbnailUpload: async () => null,
    failThumbnailUpload: async () => false,
    reconcileThumbnailArtifacts: async () => ({ deleted: 0, retryPending: 0 }),
    getThumbnailDownloadUrl: async () => null,
    listTemplates: async () => [],
    getSettings: async () => ({}),
    updateSettings: async (_actorId, settings) => settings,
    ...overrides,
  }
}

function mutation(path: string, body: unknown, cookie?: string) {
  return new Request(`https://app.example.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: env.APP_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': '1',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('EasyDashboard API', () => {
  it('reports liveness without external dependencies', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/health/live')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('reports readiness when the required database schema is available', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/health/ready')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ready' })
  })

  it('fails readiness when the database or required schema is unavailable', async () => {
    const app = createApp({
      env,
      auth: auth(),
      repository: repository({
        ping: async () => Promise.reject(new Error('relation "app.project_releases" does not exist')),
      }),
    })
    const response = await app.request('/api/health/ready')
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ status: 'unavailable' })
  })

  it('rejects mutations from a different origin', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/auth/sign-in', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        'x-csrf-token': '1',
      },
      body: JSON.stringify({ email: 'owner@example.com', password: 'password123' }),
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'INVALID_ORIGIN' } })
  })

  it('rejects requests above the API transfer budget before parsing JSON', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/auth/sign-in', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(4 * 1024 * 1024),
        origin: env.APP_ORIGIN,
        'x-csrf-token': '1',
      },
      body: '{}',
    })
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'BODY_TOO_LARGE' } })
  })

  it('keeps Supabase tokens in secure host-only cookies', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request(
      mutation('/api/auth/sign-in', { email: 'owner@example.com', password: 'password123' }),
    )
    expect(response.status).toBe(200)
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('__Host-ed-access-token=access')
    expect(cookies).toContain('__Host-ed-refresh-token=refresh')
    expect(cookies).toContain('HttpOnly')
    expect(cookies).toContain('Secure')
    expect(await response.text()).not.toContain('access')
  })

  it('requires authentication for project reads', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const response = await app.request('/api/projects')
    expect(response.status).toBe(401)
  })

  it('returns the publication slug when reading a published project', async () => {
    const publicationSlug = 'published-dashboard'
    const app = createApp({
      env,
      auth: auth(),
      repository: repository({
        getProject: async () => ({ ...project, publicationSlug }),
      }),
    })

    const response = await app.request(`/api/projects/${projectId}`, {
      headers: { cookie: '__Host-ed-access-token=access' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      project: { id: projectId, publicationSlug },
    })
  })

  it('returns a deterministic draft conflict', async () => {
    const app = createApp({
      env,
      auth: auth(),
      repository: repository({ saveDraft: async () => 'conflict' }),
    })
    const request = mutation(
      `/api/projects/${projectId}/draft`,
      { expectedVersion: 1, schema: { componentsTree: [] } },
      '__Host-ed-access-token=access',
    )
    const response = await app.request(
      new Request(request, {
        method: 'PUT',
      }),
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'DRAFT_CONFLICT' } })
  })

  it('rejects a schema that exceeds the nesting budget', async () => {
    const app = createApp({ env, auth: auth(), repository: repository() })
    const schema: Record<string, unknown> = {}
    let cursor = schema
    for (let index = 0; index < 66; index += 1) {
      cursor.child = {}
      cursor = cursor.child as Record<string, unknown>
    }
    const response = await app.request(
      mutation('/api/projects', { name: 'Too deep', schema }, '__Host-ed-access-token=access'),
    )
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SCHEMA_TOO_DEEP' } })
  })

  it('does not expose direct Agent operation grant issuance to project clients', async () => {
    const getEditableProjectForAgentSpike = vi.fn(async () => ({
      id: project.id,
      draftVersion: project.draftVersion,
      draftSchema: project.draftSchema,
    }))
    const issueAgentSpikeOperation = vi.fn()
    const app = createApp({
      env: {
        ...env,
        AGENT_EXECUTOR_GRANT_SECRET: 'executor-grant-secret-with-at-least-32-bytes',
        AGENT_EXECUTOR_COMPATIBILITY_JSON: executorCompatibility,
      },
      auth: auth(),
      repository: repository({
        getEditableProjectForAgentSpike,
        issueAgentSpikeOperation,
      }),
    })

    const response = await app.request(
      mutation(
        `/api/projects/${projectId}/agent-spike/operations`,
        {
          executorId: 'executor-1',
          operationId: 'operation-1',
          taskId: 'task-1',
          stageId: 'stage-1',
          compatibility: {
            ...executorCompatibility,
            coreSha256: 'f'.repeat(64),
          },
          invocation: {
            sessionId: 'session-1',
            stepId: 'step-1',
            callId: 'call-1',
            capability: 'screen.applyChangeSet',
            arguments: {
              schemaVersion: 1,
              documentId: 'page-home',
              operations: [{ opId: 'remove-old-title', type: 'remove', nodeId: 'old-title' }],
            },
          },
        },
        '__Host-ed-access-token=access',
      ),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(getEditableProjectForAgentSpike).not.toHaveBeenCalled()
    expect(issueAgentSpikeOperation).not.toHaveBeenCalled()
  })
})
