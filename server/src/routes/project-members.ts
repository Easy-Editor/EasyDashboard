import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { projectIdSchema } from '../validation.js'

const userIdSchema = z.uuid()
const roleSchema = z.object({ role: z.enum(['owner', 'editor', 'viewer']) })

function uuidParam(value: string): string {
  const parsed = projectIdSchema.safeParse(value)
  if (!parsed.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return parsed.data
}

function membershipError(result: 'forbidden' | 'last_owner' | null): never {
  if (result === 'forbidden') {
    throw new ApiError(403, 'PROJECT_MEMBERSHIP_FORBIDDEN', 'Only project owners can manage members')
  }
  if (result === 'last_owner') {
    throw new ApiError(409, 'PROJECT_LAST_OWNER', 'A project must keep at least one owner')
  }
  throw new ApiError(404, 'PROJECT_MEMBER_NOT_FOUND', 'Project or member not found')
}

export function createProjectMemberRoutes(repository: Repository) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.get('/:projectId/members', async c => {
    const members = await repository.listProjectMembers(c.get('actorId'), uuidParam(c.req.param('projectId')))
    if (!members) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ members })
  })

  routes.put('/:projectId/members/:userId', async c => {
    const userId = userIdSchema.safeParse(c.req.param('userId'))
    if (!userId.success) throw new ApiError(404, 'PROJECT_MEMBER_NOT_FOUND', 'Project or member not found')
    const input = await readJson(c, roleSchema)
    const result = await repository.setProjectMemberRole(
      c.get('actorId'),
      uuidParam(c.req.param('projectId')),
      userId.data,
      input.role,
    )
    if (!result || typeof result === 'string') membershipError(result)
    return c.json({ member: result })
  })

  routes.delete('/:projectId/members/:userId', async c => {
    const userId = userIdSchema.safeParse(c.req.param('userId'))
    if (!userId.success) throw new ApiError(404, 'PROJECT_MEMBER_NOT_FOUND', 'Project or member not found')
    const result = await repository.removeProjectMember(
      c.get('actorId'),
      uuidParam(c.req.param('projectId')),
      userId.data,
    )
    if (result !== true) membershipError(result)
    return c.body(null, 204)
  })

  return routes
}
