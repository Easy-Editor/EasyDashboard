import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { projectIdSchema } from '../validation.js'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const operationIdSchema = z.string().trim().min(1).max(160)
const MAX_BYTES = 10 * 1024 * 1024
const uploadSchema = z
  .object({
    candidateSha256: sha256Schema,
    draftVersion: z.number().int().positive(),
    contentType: z.literal('image/png'),
    size: z.number().int().positive().max(MAX_BYTES),
    sha256: sha256Schema,
  })
  .strict()
const completeSchema = z.object({ artifactId: z.uuid(), path: z.string().min(1).max(512) }).strict()

function projectIdFrom(c: { req: { param(name: string): string } }): string {
  const result = projectIdSchema.safeParse(c.req.param('projectId'))
  if (!result.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return result.data
}

function operationIdFrom(c: { req: { param(name: string): string } }): string {
  const result = operationIdSchema.safeParse(c.req.param('operationId'))
  if (!result.success) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
  return result.data
}

export function createAgentScreenshotArtifactRoutes(repository: Repository) {
  const routes = new Hono<{ Variables: AppVariables }>()
  const artifacts = repository as Required<
    Pick<
      Repository,
      | 'createAgentScreenshotArtifactUpload'
      | 'completeAgentScreenshotArtifactUpload'
      | 'getAgentScreenshotArtifactDownload'
    >
  >

  routes.post('/:projectId/agent-spike/operations/:operationId/screenshot-artifact/upload', async c => {
    const result = await artifacts.createAgentScreenshotArtifactUpload(
      c.get('actorId'),
      c.get('accessToken'),
      projectIdFrom(c),
      operationIdFrom(c),
      await readJson(c, uploadSchema),
    )
    if (result === 'conflict')
      throw new ApiError(409, 'AGENT_SCREENSHOT_ARTIFACT_IDEMPOTENCY_CONFLICT', 'Screenshot reservation conflicts')
    if (result === 'invalid_state')
      throw new ApiError(409, 'AGENT_SCREENSHOT_ARTIFACT_INVALID_STATE', 'Operation is not ready for a screenshot')
    if (!result) throw new ApiError(404, 'AGENT_OPERATION_NOT_FOUND', 'Agent operation not found')
    return c.json({ upload: result }, result.alreadyCompleted ? 200 : 201)
  })

  routes.post('/:projectId/agent-spike/operations/:operationId/screenshot-artifact/complete', async c => {
    const result = await artifacts.completeAgentScreenshotArtifactUpload(
      c.get('actorId'),
      c.get('accessToken'),
      projectIdFrom(c),
      operationIdFrom(c),
      await readJson(c, completeSchema),
    )
    if (result === 'invalid')
      throw new ApiError(422, 'AGENT_SCREENSHOT_ARTIFACT_INVALID', 'Uploaded screenshot does not match its reservation')
    if (result === 'integrity_conflict')
      throw new ApiError(409, 'AGENT_SCREENSHOT_ARTIFACT_INTEGRITY_CONFLICT', 'Screenshot binding is inconsistent')
    if (!result) throw new ApiError(404, 'AGENT_SCREENSHOT_ARTIFACT_NOT_FOUND', 'Screenshot artifact not found')
    return c.json({ artifact: result })
  })

  routes.get('/:projectId/agent-spike/operations/:operationId/screenshot-artifact', async c => {
    const download = await artifacts.getAgentScreenshotArtifactDownload(
      c.get('actorId'),
      c.get('accessToken'),
      projectIdFrom(c),
      operationIdFrom(c),
    )
    if (!download) throw new ApiError(404, 'AGENT_SCREENSHOT_ARTIFACT_NOT_FOUND', 'Screenshot artifact not found')
    return c.json({ download })
  })

  return routes
}
