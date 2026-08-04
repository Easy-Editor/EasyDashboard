import { Hono } from 'hono'
import { z } from 'zod'
import { parseAgentProjectWorkspacePayload } from '../agent/workspace-contract.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'

const projectId = z.uuid()
const bodySchema = z
  .object({
    expectedRevision: z.number().int().positive().optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()

export function createAgentWorkspaceRoutes(repository: Repository) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.get('/workspace/:projectId', async c => {
    if (!repository.getAgentWorkspace)
      throw new ApiError(503, 'AGENT_WORKSPACE_UNAVAILABLE', 'Agent workspace persistence is unavailable')
    const parsed = projectId.safeParse(c.req.param('projectId'))
    if (!parsed.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ workspace: await repository.getAgentWorkspace(c.get('actorId'), parsed.data) })
  })
  app.put('/workspace/:projectId', async c => {
    if (!repository.upsertAgentWorkspace)
      throw new ApiError(503, 'AGENT_WORKSPACE_UNAVAILABLE', 'Agent workspace persistence is unavailable')
    const parsed = projectId.safeParse(c.req.param('projectId'))
    if (!parsed.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const input = await readJson(c, bodySchema)
    const actorId = c.get('actorId')
    let payload: ReturnType<typeof parseAgentProjectWorkspacePayload>
    try {
      payload = parseAgentProjectWorkspacePayload(input.payload, actorId, parsed.data)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError(422, 'AGENT_WORKSPACE_INVALID', 'Agent workspace payload is invalid')
      }
      throw error
    }
    const result = await repository.upsertAgentWorkspace(actorId, parsed.data, payload, input.expectedRevision)
    if (result === 'conflict') throw new ApiError(409, 'AGENT_WORKSPACE_CONFLICT', 'Agent workspace revision changed')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ workspace: result })
  })
  return app
}
