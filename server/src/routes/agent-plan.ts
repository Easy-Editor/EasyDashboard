import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { projectIdSchema } from '../validation.js'

const attachmentMetadataSchema = z
  .object({
    id: z.string().trim().min(1).max(160).optional(),
    name: z.string().trim().min(1).max(255),
    scope: z.enum(['conversation', 'project']).optional(),
    mimeType: z.string().trim().min(1).max(255).optional(),
    type: z.string().trim().min(1).max(120).optional(),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024)
      .optional(),
  })
  .strict()

const projectContextSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(2_000),
    status: z.enum(['pending', 'confirmed']),
  })
  .strict()

const agentPlanRequestSchema = z
  .object({
    projectId: projectIdSchema,
    conversationId: z.string().trim().min(1).max(160),
    taskId: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(4_000),
    attachments: z.array(attachmentMetadataSchema).max(12).default([]),
    projectContext: z.array(projectContextSchema).max(24).default([]),
  })
  .strict()

/**
 * Kept source-compatible while callers migrate away from the retired planning route.
 * Model configuration is deliberately not consumed here: all paid model work must use
 * the persisted Agent run route and its durable cost ledger.
 */
export interface AgentPlanRouteOptions {
  repository: Repository
  env: Pick<AppEnv, 'EASY_EDITOR_AGENT_BASE_URL' | 'EASY_EDITOR_AGENT_API_KEY' | 'EASY_EDITOR_AGENT_MODEL'>
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

export function createAgentPlanRoutes(options: AgentPlanRouteOptions) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.post('/plan', async c => {
    const input = await readJson(c, agentPlanRequestSchema)
    const actorId = c.get('actorId')
    const editableProject = await options.repository.getEditableProjectForAgentSpike(actorId, input.projectId)
    if (!editableProject) throw new ApiError(404, 'PROJECT_NOT_EDITABLE', 'Editable project not found')

    return c.json(
      {
        error: {
          code: 'AGENT_PLAN_ROUTE_RETIRED',
          message: 'Direct Agent planning is retired; start a persisted Agent run instead',
        },
      },
      410,
    )
  })

  return routes
}
