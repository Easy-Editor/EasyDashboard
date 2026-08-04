import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { AgentProjectContextRecord, Repository } from '../types.js'

const projectIdSchema = z.uuid()
const contextIdSchema = z.uuid()
const provenanceSchema = z
  .object({
    origin: z.enum(['agent_task', 'manual']),
    sourceKinds: z
      .array(z.enum(['user_request', 'agent_plan', 'agent_result']))
      .min(1)
      .max(3),
  })
  .strict()
const writeSchema = z
  .object({
    id: z.uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(160),
    content: z.string().max(20_000),
    status: z.literal('confirmed'),
    sourceTaskId: z.string().trim().min(1).max(160).optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict()
const rollbackSchema = z
  .object({ expectedRevision: z.number().int().positive(), targetRevision: z.number().int().positive() })
  .strict()
const deleteSchema = z.object({ expectedRevision: z.number().int().positive() }).strict()

function validId(value: string, schema: typeof projectIdSchema, code: string): string {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ApiError(404, code, 'Project context resource not found')
  return parsed.data
}

function publicContext(context: AgentProjectContextRecord) {
  return {
    ...context,
    createdAt: context.createdAt.toISOString(),
    updatedAt: context.updatedAt.toISOString(),
    confirmedAt: context.confirmedAt.toISOString(),
  }
}

export function createAgentProjectContextRoutes(repository: Repository) {
  const app = new Hono<{ Variables: AppVariables }>()

  app.get('/:projectId/agent/contexts', async c => {
    if (!repository.listAgentProjectContexts) {
      throw new ApiError(503, 'PROJECT_CONTEXT_UNAVAILABLE', 'Shared project context is unavailable')
    }
    const projectId = validId(c.req.param('projectId'), projectIdSchema, 'PROJECT_NOT_FOUND')
    const contexts = await repository.listAgentProjectContexts(c.get('actorId'), projectId)
    if (!contexts) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ contexts: contexts.map(publicContext) })
  })

  app.put('/:projectId/agent/contexts', async c => {
    if (!repository.upsertAgentProjectContext) {
      throw new ApiError(503, 'PROJECT_CONTEXT_UNAVAILABLE', 'Shared project context is unavailable')
    }
    const projectId = validId(c.req.param('projectId'), projectIdSchema, 'PROJECT_NOT_FOUND')
    const input = await readJson(c, writeSchema)
    const result = await repository.upsertAgentProjectContext(c.get('actorId'), projectId, {
      ...(input.id ? { id: input.id } : {}),
      ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
      title: input.title,
      content: input.content,
      ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
      ...(input.provenance ? { provenance: input.provenance } : {}),
    })
    if (result === 'conflict') {
      throw new ApiError(409, 'PROJECT_CONTEXT_CONFLICT', 'Project context revision changed')
    }
    if (!result)
      throw new ApiError(404, input.id ? 'PROJECT_CONTEXT_NOT_FOUND' : 'PROJECT_NOT_FOUND', 'Project context not found')
    return c.json({ context: publicContext(result) })
  })

  app.post('/:projectId/agent/contexts/:contextId/rollback', async c => {
    if (!repository.rollbackAgentProjectContext) {
      throw new ApiError(503, 'PROJECT_CONTEXT_UNAVAILABLE', 'Shared project context is unavailable')
    }
    const projectId = validId(c.req.param('projectId'), projectIdSchema, 'PROJECT_NOT_FOUND')
    const contextId = validId(c.req.param('contextId'), contextIdSchema, 'PROJECT_CONTEXT_NOT_FOUND')
    const input = await readJson(c, rollbackSchema)
    const result = await repository.rollbackAgentProjectContext(
      c.get('actorId'),
      projectId,
      contextId,
      input.expectedRevision,
      input.targetRevision,
    )
    if (result === 'conflict') {
      throw new ApiError(409, 'PROJECT_CONTEXT_CONFLICT', 'Project context revision changed')
    }
    if (!result) throw new ApiError(404, 'PROJECT_CONTEXT_NOT_FOUND', 'Project context not found')
    return c.json({ context: publicContext(result) })
  })

  app.delete('/:projectId/agent/contexts/:contextId', async c => {
    if (!repository.deleteAgentProjectContext) {
      throw new ApiError(503, 'PROJECT_CONTEXT_UNAVAILABLE', 'Shared project context is unavailable')
    }
    const projectId = validId(c.req.param('projectId'), projectIdSchema, 'PROJECT_NOT_FOUND')
    const contextId = validId(c.req.param('contextId'), contextIdSchema, 'PROJECT_CONTEXT_NOT_FOUND')
    const input = await readJson(c, deleteSchema)
    const result = await repository.deleteAgentProjectContext(
      c.get('actorId'),
      projectId,
      contextId,
      input.expectedRevision,
    )
    if (result === 'conflict') {
      throw new ApiError(409, 'PROJECT_CONTEXT_CONFLICT', 'Project context revision changed')
    }
    if (!result) throw new ApiError(404, 'PROJECT_CONTEXT_NOT_FOUND', 'Project context not found')
    return c.body(null, 204)
  })

  return app
}
