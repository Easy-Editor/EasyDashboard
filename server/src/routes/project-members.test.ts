import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { createProjectMemberRoutes } from './project-members.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const member = {
  projectId,
  userId: memberId,
  role: 'editor' as const,
  createdAt: new Date('2026-08-01T09:50:00.000Z'),
  createdBy: actorId,
}

function app(repository: Partial<Repository>) {
  const instance = new Hono<{ Variables: AppVariables }>()
  instance.use('*', async (c, next) => {
    c.set('actorId', actorId)
    c.set('accessToken', 'access')
    await next()
  })
  instance.route('/projects', createProjectMemberRoutes(repository as Repository))
  instance.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return instance
}

function mutation(method: 'PUT' | 'DELETE', body?: unknown) {
  return new Request(`https://app.example.com/projects/${projectId}/members/${memberId}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('project membership routes', () => {
  it('lists memberships for a project member', async () => {
    const listProjectMembers = vi.fn(async () => [member])
    const response = await app({ listProjectMembers }).request(`/projects/${projectId}/members`)

    expect(response.status).toBe(200)
    expect(listProjectMembers).toHaveBeenCalledWith(actorId, projectId)
    await expect(response.json()).resolves.toMatchObject({ members: [{ userId: memberId, role: 'editor' }] })
  })

  it('lets an owner assign a validated project role', async () => {
    const setProjectMemberRole = vi.fn(async () => member)
    const response = await app({ setProjectMemberRole }).request(mutation('PUT', { role: 'editor' }))

    expect(response.status).toBe(200)
    expect(setProjectMemberRole).toHaveBeenCalledWith(actorId, projectId, memberId, 'editor')
  })

  it.each([
    ['editor management', 'forbidden' as const, 403, 'PROJECT_MEMBERSHIP_FORBIDDEN'],
    ['final owner demotion', 'last_owner' as const, 409, 'PROJECT_LAST_OWNER'],
    ['missing membership', null, 404, 'PROJECT_MEMBER_NOT_FOUND'],
  ])('reports %s without weakening membership authority', async (_case, result, status, code) => {
    const setProjectMemberRole = vi.fn(async () => result)
    const response = await app({ setProjectMemberRole }).request(mutation('PUT', { role: 'viewer' }))

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ error: { code } })
  })

  it('removes a member and preserves the final-owner conflict', async () => {
    const removeProjectMember = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce('last_owner')
    const instance = app({ removeProjectMember })

    expect((await instance.request(mutation('DELETE'))).status).toBe(204)
    const conflict = await instance.request(mutation('DELETE'))
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ error: { code: 'PROJECT_LAST_OWNER' } })
  })
})
