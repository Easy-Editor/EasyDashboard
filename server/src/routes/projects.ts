import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import {
  ValidationError,
  assertCanvasDimensions,
  assertSchemaBudget,
  projectIdSchema,
  projectSchemaSchema,
} from '../validation.js'

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  coverUrl: z.string().url().max(2048).nullable().optional(),
  schema: projectSchemaSchema,
})

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    coverUrl: z.string().url().max(2048).nullable().optional(),
  })
  .refine(value => Object.keys(value).length > 0, 'At least one field is required')

const draftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  schema: projectSchemaSchema,
})

const publishSchema = z.object({ snapshotId: z.uuid() }).strict()
const createPublishSnapshotSchema = z.object({ draftVersion: z.number().int().positive() }).strict()
const emptyMutationSchema = z.object({}).strict()

const revisionIdSchema = z.object({ revisionId: z.uuid() })
const restoreSchema = z.object({ expectedVersion: z.number().int().positive() })
const releaseNumberSchema = z.coerce.number().int().positive()
const restorePointSchema = z.object({ label: z.string().trim().min(1).max(120).nullable().optional() })
const projectViewSchema = z.enum(['active', 'trash']).default('active')
const thumbnailUploadSchema = z
  .object({
    draftVersion: z.number().int().positive(),
    mode: z.enum(['auto', 'custom']),
    source: z.enum(['renderer', 'blueprint', 'custom']),
    contentType: z.enum(['image/webp', 'image/svg+xml']),
    size: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .refine(
    input =>
      (input.mode === 'auto' &&
        ((input.source === 'renderer' && input.contentType === 'image/webp') ||
          (input.source === 'blueprint' && input.contentType === 'image/svg+xml'))) ||
      (input.mode === 'custom' && input.source === 'custom' && input.contentType === 'image/webp'),
    'Thumbnail mode, source, and content type do not match',
  )
const thumbnailCompleteSchema = z.object({
  draftVersion: z.number().int().positive(),
  path: z.string().min(1).max(512),
})
const thumbnailFailureSchema = z.object({
  draftVersion: z.number().int().positive(),
  path: z.string().min(1).max(512),
  errorCode: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

function idFrom(c: { req: { param(name: string): string } }): string {
  const result = projectIdSchema.safeParse(c.req.param('projectId'))
  if (!result.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return result.data
}

function snapshotIdFrom(c: { req: { param(name: string): string } }): string {
  const result = z.uuid().safeParse(c.req.param('snapshotId'))
  if (!result.success) throw new ApiError(404, 'PUBLISH_SNAPSHOT_NOT_FOUND', 'Publish snapshot not found')
  return result.data
}

function assertBudget(schema: Record<string, unknown>): void {
  try {
    assertCanvasDimensions(schema)
    assertSchemaBudget(schema)
  } catch (error) {
    if (error instanceof ValidationError) {
      const status = error.code === 'INVALID_CANVAS_DIMENSION' ? 422 : 413
      throw new ApiError(status, error.code, error.message)
    }
    throw error
  }
}

export function createProjectRoutes(repository: Repository) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.get('/', async c => {
    const view = projectViewSchema.safeParse(c.req.query('view'))
    if (!view.success) throw new ApiError(400, 'INVALID_PROJECT_VIEW', 'Project view must be active or trash')
    return c.json({
      projects: await repository.listProjects(c.get('actorId'), view.data === 'trash' ? 'trashed' : 'active'),
    })
  })

  routes.post('/', async c => {
    const input = await readJson(c, createProjectSchema)
    assertBudget(input.schema)
    const project = await repository.createProject(c.get('actorId'), input)
    return c.json({ project }, 201)
  })

  routes.get('/:projectId', async c => {
    const project = await repository.getProject(c.get('actorId'), idFrom(c))
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project })
  })

  routes.patch('/:projectId', async c => {
    const input = await readJson(c, updateProjectSchema)
    const project = await repository.updateProject(c.get('actorId'), idFrom(c), input)
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project })
  })

  routes.put('/:projectId/favorite', async c => {
    const project = await repository.setProjectFavorite(c.get('actorId'), idFrom(c), true)
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project })
  })

  routes.delete('/:projectId/favorite', async c => {
    const project = await repository.setProjectFavorite(c.get('actorId'), idFrom(c), false)
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.body(null, 204)
  })

  routes.post('/:projectId/duplicate', async c => {
    const project = await repository.duplicateProject(c.get('actorId'), idFrom(c))
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project }, 201)
  })

  routes.delete('/:projectId', async c => {
    const trashed = await repository.trashProject(c.get('actorId'), c.get('accessToken'), idFrom(c))
    if (!trashed) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.body(null, 204)
  })

  routes.delete('/:projectId/permanent', async c => {
    const deleted = await repository.permanentlyDeleteProject(c.get('actorId'), c.get('accessToken'), idFrom(c))
    if (deleted === 'conflict') {
      throw new ApiError(409, 'PROJECT_NOT_TRASHED', 'Project must be moved to trash before permanent deletion')
    }
    if (!deleted) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.body(null, 204)
  })

  routes.post('/:projectId/restore', async c => {
    const project = await repository.restoreProject(c.get('actorId'), idFrom(c))
    if (project === 'deletion_in_progress') {
      throw new ApiError(
        409,
        'PROJECT_PERMANENT_DELETE_IN_PROGRESS',
        'Project permanent deletion is already in progress',
      )
    }
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project })
  })

  routes.post('/:projectId/thumbnail/upload', async c => {
    const input = await readJson(c, thumbnailUploadSchema)
    const result = await repository.createThumbnailUpload(c.get('actorId'), c.get('accessToken'), idFrom(c), input)
    if (result === 'conflict') throw new ApiError(409, 'THUMBNAIL_VERSION_CONFLICT', 'Draft version changed')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ upload: result }, 201)
  })

  routes.post('/:projectId/thumbnail/complete', async c => {
    const input = await readJson(c, thumbnailCompleteSchema)
    const result = await repository.completeThumbnailUpload(c.get('actorId'), c.get('accessToken'), idFrom(c), input)
    if (result === 'conflict') throw new ApiError(409, 'THUMBNAIL_VERSION_CONFLICT', 'Draft version changed')
    if (result === 'invalid') throw new ApiError(422, 'THUMBNAIL_UPLOAD_INVALID', 'Uploaded thumbnail is invalid')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project: result })
  })

  routes.post('/:projectId/thumbnail/fail', async c => {
    const input = await readJson(c, thumbnailFailureSchema)
    const result = await repository.failThumbnailUpload(c.get('actorId'), c.get('accessToken'), idFrom(c), input)
    if (result === 'conflict') throw new ApiError(409, 'THUMBNAIL_VERSION_CONFLICT', 'Draft version changed')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.body(null, 204)
  })

  routes.post('/:projectId/thumbnail/reconcile', async c => {
    const result = await repository.reconcileThumbnailArtifacts(c.get('actorId'), c.get('accessToken'), idFrom(c))
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ cleanup: result })
  })

  routes.get('/:projectId/thumbnail/content', async c => {
    const signedUrl = await repository.getThumbnailDownloadUrl(c.get('actorId'), c.get('accessToken'), idFrom(c))
    if (!signedUrl) throw new ApiError(404, 'THUMBNAIL_NOT_FOUND', 'Thumbnail not found')
    c.header('Cache-Control', 'private, no-store')
    return c.redirect(signedUrl, 302)
  })

  routes.put('/:projectId/draft', async c => {
    const input = await readJson(c, draftSchema)
    assertBudget(input.schema)
    const result = await repository.saveDraft(c.get('actorId'), idFrom(c), input.expectedVersion, input.schema)
    if (result === 'conflict') throw new ApiError(409, 'DRAFT_CONFLICT', 'The saved draft has changed')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project: result, savedAt: result.updatedAt })
  })

  const listRestorePoints = async (c: Context<{ Variables: AppVariables }>) => {
    const revisions = await repository.listRevisions(c.get('actorId'), idFrom(c))
    if (!revisions) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({
      revisions: revisions.map(({ id, projectId, revisionNumber, kind, label, sourceDraftVersion, createdAt }) => ({
        id,
        projectId,
        revisionNumber,
        kind,
        label,
        sourceDraftVersion,
        createdAt,
      })),
    })
  }

  routes.get('/:projectId/revisions', listRestorePoints)
  routes.get('/:projectId/restore-points', listRestorePoints)

  routes.get('/:projectId/releases', async c => {
    const releases = await repository.listReleases(c.get('actorId'), idFrom(c))
    if (!releases) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({
      releases: releases.map(({ slug, ...release }) => {
        const stableUrl = slug ? `/api/public/projects/${slug}` : null
        return {
          ...release,
          stableUrl,
          versionUrl: stableUrl ? `${stableUrl}/versions/${release.releaseNumber}` : null,
        }
      }),
    })
  })

  routes.post('/:projectId/releases/:releaseNumber/restore', async c => {
    const releaseNumber = releaseNumberSchema.safeParse(c.req.param('releaseNumber'))
    if (!releaseNumber.success) throw new ApiError(404, 'RELEASE_NOT_FOUND', 'Release not found')
    const input = await readJson(c, restoreSchema)
    const project = await repository.restoreRelease(
      c.get('actorId'),
      idFrom(c),
      releaseNumber.data,
      input.expectedVersion,
    )
    if (project === 'conflict') throw new ApiError(409, 'DRAFT_CONFLICT', 'The saved draft has changed')
    if (!project) throw new ApiError(404, 'RELEASE_NOT_FOUND', 'Release not found')
    return c.json({ project, savedAt: project.updatedAt })
  })

  routes.post('/:projectId/restore-points', async c => {
    const input = await readJson(c, restorePointSchema)
    const revision = await repository.createRestorePoint(c.get('actorId'), idFrom(c), 'manual', input.label)
    if (!revision) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    const { id, projectId, revisionNumber, kind, label, sourceDraftVersion, createdAt } = revision
    return c.json({ revision: { id, projectId, revisionNumber, kind, label, sourceDraftVersion, createdAt } }, 201)
  })

  routes.post('/:projectId/restore-points/:revisionId/restore', async c => {
    const revisionId = revisionIdSchema.safeParse({ revisionId: c.req.param('revisionId') })
    if (!revisionId.success) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Restore point not found')
    const input = await readJson(c, restoreSchema)
    const project = await repository.restoreRevision(
      c.get('actorId'),
      idFrom(c),
      revisionId.data.revisionId,
      input.expectedVersion,
    )
    if (project === 'conflict') throw new ApiError(409, 'DRAFT_CONFLICT', 'The saved draft has changed')
    if (!project) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Restore point not found')
    return c.json({ project, savedAt: project.updatedAt })
  })

  routes.post('/:projectId/agent/publish-snapshots', async c => {
    const input = await readJson(c, createPublishSnapshotSchema)
    const result = await repository.createPublishSnapshot(c.get('actorId'), idFrom(c), input.draftVersion)
    if (result === 'conflict') {
      throw new ApiError(409, 'PUBLISH_SNAPSHOT_DRAFT_CONFLICT', 'Snapshot requires the current saved draft')
    }
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json(result, 201)
  })

  routes.post('/:projectId/agent/publish-snapshots/:snapshotId/approve', async c => {
    await readJson(c, emptyMutationSchema)
    const result = await repository.approvePublishSnapshot(c.get('actorId'), idFrom(c), snapshotIdFrom(c))
    if (result === 'forbidden') throw new ApiError(403, 'PROJECT_OWNER_REQUIRED', 'Project Owner role is required')
    if (result === 'preview_required') {
      throw new ApiError(409, 'PUBLISH_PREVIEW_REQUIRED', 'Verified snapshot preview evidence is required')
    }
    if (!result) throw new ApiError(404, 'PUBLISH_SNAPSHOT_NOT_FOUND', 'Publish snapshot not found')
    return c.json({ approval: result }, 201)
  })

  const publishSnapshot = async (c: Context<{ Variables: AppVariables }>, snapshotId: string) => {
    const result = await repository.publish(c.get('actorId'), idFrom(c), { snapshotId })
    if (result === 'forbidden') throw new ApiError(403, 'PROJECT_OWNER_REQUIRED', 'Project Owner role is required')
    if (result === 'approval_required') {
      throw new ApiError(409, 'PUBLISH_APPROVAL_REQUIRED', 'An unused Owner approval is required')
    }
    if (!result) throw new ApiError(404, 'PUBLISH_SNAPSHOT_NOT_FOUND', 'Publish snapshot not found')
    const stableUrl = `/api/public/projects/${result.slug}`
    const versionUrl = `${stableUrl}/versions/${result.releaseNumber}`
    return c.json({ publication: { ...result, stableUrl, versionUrl } }, 201)
  }

  routes.post('/:projectId/agent/publish-snapshots/:snapshotId/publish', async c => {
    await readJson(c, emptyMutationSchema)
    return publishSnapshot(c, snapshotIdFrom(c))
  })

  routes.post('/:projectId/publish', async c => {
    const input = await readJson(c, publishSchema)
    return publishSnapshot(c, input.snapshotId)
  })

  routes.post('/:projectId/unpublish', async c => {
    const removed = await repository.unpublish(c.get('actorId'), idFrom(c))
    if (removed === 'forbidden') throw new ApiError(403, 'PROJECT_OWNER_REQUIRED', 'Project Owner role is required')
    if (!removed) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Publication not found')
    return c.body(null, 204)
  })

  return routes
}
