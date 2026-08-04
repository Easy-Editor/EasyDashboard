import { Hono } from 'hono'
import { z } from 'zod'
import {
  bindAgentWorkspaceTaskRunProjection,
  parseAgentProjectWorkspacePayload,
  parseWritableAgentProjectWorkspacePayload,
  preserveAgentWorkspaceLegacyTasks,
  preserveAgentWorkspaceTaskRunProjections,
} from '../agent/workspace-contract.js'
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
    if (!repository.getAgentWorkspace || !repository.upsertAgentWorkspace)
      throw new ApiError(503, 'AGENT_WORKSPACE_UNAVAILABLE', 'Agent workspace persistence is unavailable')
    const parsed = projectId.safeParse(c.req.param('projectId'))
    if (!parsed.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const input = await readJson(c, bodySchema)
    const actorId = c.get('actorId')
    let payload: ReturnType<typeof parseWritableAgentProjectWorkspacePayload>
    try {
      payload = parseWritableAgentProjectWorkspacePayload(input.payload, actorId, parsed.data)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiError(422, 'AGENT_WORKSPACE_INVALID', 'Agent workspace payload is invalid')
      }
      throw error
    }
    const current = await repository.getAgentWorkspace(actorId, parsed.data)
    let expectedRevision = input.expectedRevision
    if (current) {
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new ApiError(409, 'AGENT_WORKSPACE_CONFLICT', 'Agent workspace revision changed')
      }
      let persisted: ReturnType<typeof parseAgentProjectWorkspacePayload>
      try {
        persisted = parseAgentProjectWorkspacePayload(current.payload, actorId, parsed.data)
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ApiError(503, 'AGENT_WORKSPACE_INVALID', 'Persisted Agent workspace is invalid')
        }
        throw error
      }
      try {
        payload = preserveAgentWorkspaceLegacyTasks(payload, persisted)
        payload = preserveAgentWorkspaceTaskRunProjections(payload, persisted)
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ApiError(422, 'AGENT_WORKSPACE_INVALID', 'Agent workspace payload is invalid')
        }
        throw error
      }
      expectedRevision = current.revision
    } else if (payload.conversations.some(conversation => conversation.tasks.some(task => 'stages' in task))) {
      throw new ApiError(422, 'AGENT_WORKSPACE_INVALID', 'Agent workspace payload is invalid')
    }
    const result = await repository.upsertAgentWorkspace(actorId, parsed.data, payload, expectedRevision)
    if (result === 'conflict') throw new ApiError(409, 'AGENT_WORKSPACE_CONFLICT', 'Agent workspace revision changed')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ workspace: result })
  })
  return app
}

export type BindAgentWorkspaceTaskRunResult =
  | 'bound'
  | 'already_bound'
  | 'conflict'
  | 'legacy'
  | 'not_found'
  | 'unavailable'

/**
 * CAS-binds the relational run identity after that run has been durably
 * created. This helper never accepts browser-provided lifecycle state.
 */
export async function bindAgentWorkspaceTaskRun(
  repository: Repository,
  actorId: string,
  projectIdValue: string,
  input: { conversationId: string; taskId: string; taskRunId: string },
): Promise<BindAgentWorkspaceTaskRunResult> {
  if (!repository.getAgentWorkspace || !repository.upsertAgentWorkspace) return 'unavailable'

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workspace = await repository.getAgentWorkspace(actorId, projectIdValue)
    if (!workspace) return 'not_found'
    const payload = parseAgentProjectWorkspacePayload(workspace.payload, actorId, projectIdValue)
    const projection = bindAgentWorkspaceTaskRunProjection(payload, input)
    if (projection.status !== 'bound') return projection.status
    const result = await repository.upsertAgentWorkspace(
      actorId,
      projectIdValue,
      projection.payload,
      workspace.revision,
    )
    if (result === 'conflict') continue
    return result ? 'bound' : 'not_found'
  }
  return 'conflict'
}
