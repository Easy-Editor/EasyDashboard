import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentWorkspaceRecord, Repository } from '../types.js'
import { createAgentWorkspaceRoutes } from './agent-workspace.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const now = new Date('2026-07-31T12:00:00.000Z')

function payload() {
  return {
    version: 1,
    ownerUserId: actorId,
    projectId,
    conversations: [],
    projectContexts: [],
  }
}

function record(revision = 1): AgentWorkspaceRecord {
  return { ownerId: actorId, projectId, revision, payload: payload(), createdAt: now, updatedAt: now }
}

function testApp(repository: Partial<Repository>) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (context, next) => {
    context.set('actorId', actorId)
    context.set('accessToken', 'access')
    await next()
  })
  app.route('/agent', createAgentWorkspaceRoutes(repository as Repository))
  app.onError((error, context) => {
    if (error instanceof ApiError) {
      return context.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return app
}

describe('Agent workspace routes', () => {
  it('reads and CAS-updates only the authenticated project slice', async () => {
    const getAgentWorkspace = vi.fn(async () => record())
    const upsertAgentWorkspace = vi.fn(async () => record(2))
    const app = testApp({ getAgentWorkspace, upsertAgentWorkspace })

    const read = await app.request(`/agent/workspace/${projectId}`)
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({ workspace: { revision: 1 } })
    expect(getAgentWorkspace).toHaveBeenCalledWith(actorId, projectId)

    const update = await app.request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: payload() }),
    })
    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toMatchObject({ workspace: { revision: 2 } })
    expect(upsertAgentWorkspace).toHaveBeenCalledWith(actorId, projectId, payload(), 1)
  })

  it('rejects cross-project payloads before repository writes', async () => {
    const upsertAgentWorkspace = vi.fn(async () => record())
    const app = testApp({ upsertAgentWorkspace })
    const poisoned = payload()
    poisoned.projectId = '33333333-3333-4333-8333-333333333333'

    const response = await app.request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: poisoned }),
    })

    expect(response.status).toBe(422)
    expect(upsertAgentWorkspace).not.toHaveBeenCalled()
  })

  it('maps lost-update conflicts and unavailable persistence explicitly', async () => {
    const conflict = testApp({ upsertAgentWorkspace: async () => 'conflict' })
    const conflictResponse = await conflict.request(`/agent/workspace/${projectId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, payload: payload() }),
    })
    expect(conflictResponse.status).toBe(409)
    await expect(conflictResponse.json()).resolves.toMatchObject({ error: { code: 'AGENT_WORKSPACE_CONFLICT' } })

    const unavailable = testApp({})
    expect((await unavailable.request(`/agent/workspace/${projectId}`)).status).toBe(503)
  })
})
