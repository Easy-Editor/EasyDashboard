import { Hono } from 'hono'
import { z } from 'zod'
import { AssetModelInputError, encodeAssetModelInput } from '../agent/asset-model-input.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { projectIdSchema } from '../validation.js'

const MAX_BYTES = 20 * 1024 * 1024
const uploadSchema = z
  .object({
    idempotencyKey: z.uuid(),
    scope: z.enum(['conversation', 'project']),
    conversationId: z.string().trim().max(160).nullable().optional(),
    name: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(MAX_BYTES),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'conversation' && !value.conversationId)
      ctx.addIssue({
        code: 'custom',
        message: 'conversationId required for conversation scope',
        path: ['conversationId'],
      })
  })
const completeSchema = z.object({ id: z.uuid(), path: z.string().min(1).max(512) })

function projectId(c: { req: { param(name: string): string } }): string {
  const result = projectIdSchema.safeParse(c.req.param('projectId'))
  if (!result.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return result.data
}
function assetId(c: { req: { param(name: string): string } }): string {
  const result = z.uuid().safeParse(c.req.param('id'))
  if (!result.success) throw new ApiError(404, 'AGENT_ASSET_NOT_FOUND', 'Agent asset not found')
  return result.data
}

type DurableAgentAssetMethod = 'persistAgentAssetModelInput'
export type DurableAgentAssetRepository = Omit<Repository, DurableAgentAssetMethod> &
  Required<Pick<Repository, DurableAgentAssetMethod>>

export function createAgentAssetRoutes(repository: Repository) {
  const routes = new Hono<{ Variables: AppVariables }>()
  const assets = repository as Required<
    Pick<
      Repository,
      | 'createAgentAssetUpload'
      | 'completeAgentAssetUpload'
      | 'getAgentAssetDownloadUrl'
      | 'deleteAgentAsset'
      | 'listAgentAssets'
    >
  >
  routes.get('/:projectId/agent-assets', async c =>
    c.json({
      assets: await assets.listAgentAssets(c.get('actorId'), projectId(c), c.req.query('conversationId') || undefined),
    }),
  )
  routes.post('/:projectId/agent-assets/upload', async c => {
    const input = await readJson(c, uploadSchema)
    const result = await assets.createAgentAssetUpload(c.get('actorId'), c.get('accessToken'), projectId(c), input)
    if (result === 'quota') throw new ApiError(413, 'AGENT_ASSET_QUOTA_EXCEEDED', 'Agent asset quota exceeded')
    if (result === 'conflict')
      throw new ApiError(409, 'AGENT_ASSET_IDEMPOTENCY_CONFLICT', 'Agent asset idempotency key was reused')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ upload: result }, 201)
  })
  routes.post('/:projectId/agent-assets/complete', async c => {
    const actorId = c.get('actorId')
    const currentProjectId = projectId(c)
    const result = await assets.completeAgentAssetUpload(
      actorId,
      c.get('accessToken'),
      currentProjectId,
      await readJson(c, completeSchema),
    )
    if (result === 'invalid') throw new ApiError(422, 'AGENT_ASSET_INVALID', 'Uploaded file is invalid')
    if (!result) throw new ApiError(404, 'AGENT_ASSET_NOT_FOUND', 'Agent asset not found')
    if (/^image\/(?:png|jpeg|webp)$/iu.test(result.contentType)) {
      const durable = repository as Partial<DurableAgentAssetRepository>
      if (!durable.persistAgentAssetModelInput) {
        throw new ApiError(503, 'AGENT_ASSET_MODEL_INPUT_UNAVAILABLE', 'Image model input persistence is unavailable')
      }
      const url = await assets.getAgentAssetDownloadUrl(actorId, c.get('accessToken'), currentProjectId, result.id)
      if (!url) throw new ApiError(404, 'AGENT_ASSET_NOT_FOUND', 'Agent image attachment is unavailable')
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new ApiError(422, 'AGENT_ASSET_INVALID', 'Uploaded image could not be validated')
      try {
        const encoded = encodeAssetModelInput(result.contentType, new Uint8Array(await response.arrayBuffer()))
        const persisted = await durable.persistAgentAssetModelInput(actorId, currentProjectId, result.id, {
          record: encoded.record,
          bytes: encoded.copiedBytes,
        })
        if (!persisted)
          throw new ApiError(409, 'AGENT_ASSET_MODEL_INPUT_STALE', 'Image model input could not be persisted')
      } catch (error) {
        if (error instanceof AssetModelInputError) {
          throw new ApiError(
            error.code === 'IMAGE_TOO_LARGE' ? 413 : 422,
            error.code === 'IMAGE_TOO_LARGE' ? 'AGENT_IMAGE_TOO_LARGE' : 'AGENT_IMAGE_UNSUPPORTED',
            error.message,
          )
        }
        throw error
      }
    }
    return c.json({ asset: result })
  })
  routes.get('/:projectId/agent-assets/:id/content', async c => {
    const id = assetId(c)
    const url = await assets.getAgentAssetDownloadUrl(c.get('actorId'), c.get('accessToken'), projectId(c), id)
    if (!url) throw new ApiError(404, 'AGENT_ASSET_NOT_FOUND', 'Agent asset not found')
    return c.redirect(url, 302)
  })
  routes.delete('/:projectId/agent-assets/:id', async c => {
    const deleted = await assets.deleteAgentAsset(c.get('actorId'), c.get('accessToken'), projectId(c), assetId(c))
    if (!deleted) throw new ApiError(404, 'AGENT_ASSET_NOT_FOUND', 'Agent asset not found')
    return c.body(null, 204)
  })
  return routes
}
