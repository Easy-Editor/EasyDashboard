import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentProjectContextRecord, Repository } from '../types.js'
import { createAgentProjectContextRoutes } from './agent-project-context.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const contextId = '33333333-3333-4333-8333-333333333333'
const now = new Date('2026-08-01T02:00:00.000Z')
const provenance = { origin: 'agent_task', sourceKinds: ['user_request', 'agent_result'] } as const

function context(): AgentProjectContextRecord {
  return {
    id: contextId,
    projectId,
    title: '本轮需求摘要',
    content: '保持深色主题',
    status: 'confirmed',
    revision: 2,
    sourceTaskId: 'task-1',
    provenance: { origin: provenance.origin, sourceKinds: [...provenance.sourceKinds] },
    history: [
      {
        revision: 1,
        title: '本轮需求摘要',
        content: '使用深色主题',
        status: 'confirmed',
        sourceTaskId: 'task-1',
        provenance: { origin: provenance.origin, sourceKinds: [...provenance.sourceKinds] },
        createdAt: now.toISOString(),
      },
    ],
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
  }
}

function app(repository: Partial<Repository>) {
  const target = new Hono<{ Variables: AppVariables }>()
  target.use('*', async (c, next) => {
    c.set('actorId', actorId)
    c.set('accessToken', 'token')
    await next()
  })
  target.route('/projects', createAgentProjectContextRoutes(repository as Repository))
  target.onError((error, c) =>
    error instanceof ApiError
      ? c.json({ error: { code: error.code } }, error.status)
      : c.json({ error: { code: 'INTERNAL' } }, 500),
  )
  return target
}

function put(body: unknown) {
  return new Request(`https://app.example.com/projects/${projectId}/agent/contexts`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('Agent project context routes', () => {
  it('forwards and returns bounded task provenance, including revision history', async () => {
    const upsert = vi.fn<NonNullable<Repository['upsertAgentProjectContext']>>(async () => context())
    const response = await app({ upsertAgentProjectContext: upsert }).request(
      put({
        title: '本轮需求摘要',
        content: '保持深色主题',
        status: 'confirmed',
        sourceTaskId: 'task-1',
        provenance,
      }),
    )

    expect(response.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(actorId, projectId, {
      title: '本轮需求摘要',
      content: '保持深色主题',
      sourceTaskId: 'task-1',
      provenance,
    })
    await expect(response.json()).resolves.toMatchObject({
      context: {
        sourceTaskId: 'task-1',
        provenance,
        history: [{ sourceTaskId: 'task-1', provenance }],
      },
    })
  })

  it('accepts manual provenance and rejects unbounded, unknown, or extra provenance fields', async () => {
    const upsert = vi.fn<NonNullable<Repository['upsertAgentProjectContext']>>(async () => context())
    const target = app({ upsertAgentProjectContext: upsert })
    const base = { title: '约束', content: '内容', status: 'confirmed' }

    expect(
      (await target.request(put({ ...base, provenance: { origin: 'manual', sourceKinds: ['user_request'] } }))).status,
    ).toBe(200)
    for (const invalid of [
      { origin: 'import', sourceKinds: ['user_request'] },
      { origin: 'manual', sourceKinds: [] },
      { origin: 'manual', sourceKinds: ['user_request', 'agent_plan', 'agent_result', 'user_request'] },
      { origin: 'manual', sourceKinds: ['private_message'] },
      { origin: 'manual', sourceKinds: ['user_request'], detail: 'private body' },
    ]) {
      expect((await target.request(put({ ...base, provenance: invalid }))).status).toBe(422)
    }
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})
