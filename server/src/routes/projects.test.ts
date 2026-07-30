import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { createProjectRoutes } from './projects.js'

const actorId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const revisionId = '33333333-3333-4333-8333-333333333333'
const now = new Date('2026-07-30T01:00:00.000Z')
const summary = {
  id: projectId,
  name: 'Dashboard',
  description: null,
  coverUrl: null,
  draftVersion: 4,
  isFavorite: true,
  pageCount: 1,
  canvasWidth: 1920,
  canvasHeight: 1080,
  startPageId: 'home',
  draftSavedAt: now,
  thumbnailMode: 'auto' as const,
  thumbnailStatus: 'queued' as const,
  thumbnailPath: null,
  thumbnailUrl: null,
  thumbnailDraftVersion: null,
  thumbnailErrorCode: null,
  publicationSlug: 'dashboard-stable',
  publishedRevisionId: revisionId,
  deletedAt: null,
  createdAt: new Date('2026-07-30T00:00:00.000Z'),
  updatedAt: now,
}
const detail = { ...summary, draftSchema: { componentsTree: [] } }

function createTestApp(repository: Partial<Repository>) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (c, next) => {
    c.set('actorId', actorId)
    c.set('accessToken', 'session-secret')
    await next()
  })
  app.route('/projects', createProjectRoutes(repository as Repository))
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  return app
}

function jsonMutation(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('project product routes', () => {
  it('lists lightweight active or trashed summaries without a project schema', async () => {
    const listProjects = vi.fn(async () => [summary])
    const response = await createTestApp({ listProjects }).request('/projects?view=trash')

    expect(response.status).toBe(200)
    expect(listProjects).toHaveBeenCalledWith(actorId, 'trashed')
    const payload = (await response.json()) as { projects: Array<Record<string, unknown>> }
    expect(payload.projects[0]).not.toHaveProperty('draftSchema')
  })

  it('favorites, duplicates, trashes, and restores projects through explicit lifecycle routes', async () => {
    const setProjectFavorite = vi.fn(async () => summary)
    const duplicateProject = vi.fn(async () => ({ ...detail, name: 'Dashboard copy' }))
    const trashProject = vi.fn(async () => true)
    const restoreProject = vi.fn(async () => detail)
    const app = createTestApp({ setProjectFavorite, duplicateProject, trashProject, restoreProject })

    const favorite = await app.request(jsonMutation(`/projects/${projectId}/favorite`, 'PUT', {}))
    const duplicate = await app.request(jsonMutation(`/projects/${projectId}/duplicate`, 'POST', {}))
    const trash = await app.request(jsonMutation(`/projects/${projectId}`, 'DELETE'))
    const restore = await app.request(jsonMutation(`/projects/${projectId}/restore`, 'POST', {}))

    expect(favorite.status).toBe(200)
    expect(duplicate.status).toBe(201)
    expect(trash.status).toBe(204)
    expect(restore.status).toBe(200)
    expect(setProjectFavorite).toHaveBeenCalledWith(actorId, projectId, true)
    expect(duplicateProject).toHaveBeenCalledWith(actorId, projectId)
    expect(trashProject).toHaveBeenCalledWith(actorId, 'session-secret', projectId)
    expect(restoreProject).toHaveBeenCalledWith(actorId, projectId)
  })

  it('creates manual restore points and restores drafts without publishing them', async () => {
    const revision = {
      id: revisionId,
      projectId,
      revisionNumber: 8,
      kind: 'manual' as const,
      label: null,
      sourceDraftVersion: 4,
      schema: { componentsTree: [] },
      createdAt: new Date('2026-07-30T02:00:00.000Z'),
    }
    const createRestorePoint = vi.fn(async () => revision)
    const restoreRevision = vi.fn(async () => ({
      ...detail,
      draftVersion: 5,
      updatedAt: new Date('2026-07-30T03:00:00.000Z'),
    }))
    const listRevisions = vi.fn(async () => [revision])
    const app = createTestApp({ createRestorePoint, restoreRevision, listRevisions })

    const list = await app.request(`/projects/${projectId}/restore-points`)
    const point = await app.request(jsonMutation(`/projects/${projectId}/restore-points`, 'POST', {}))
    const restored = await app.request(
      jsonMutation(`/projects/${projectId}/restore-points/${revisionId}/restore`, 'POST', {
        expectedVersion: 4,
      }),
    )

    expect(list.status).toBe(200)
    const listed = (await list.json()) as { revisions: Array<Record<string, unknown>> }
    expect(listed.revisions[0]).not.toHaveProperty('schema')
    expect(point.status).toBe(201)
    expect(restored.status).toBe(200)
    expect(createRestorePoint).toHaveBeenCalledWith(actorId, projectId, 'manual', undefined)
    expect(restoreRevision).toHaveBeenCalledWith(actorId, projectId, revisionId, 4)
  })

  it('lists private publish releases as metadata with stable and immutable paths', async () => {
    const listReleases = vi.fn(async () => [
      {
        projectId,
        releaseNumber: 2,
        revisionId,
        revisionNumber: 8,
        name: '发布时名称',
        description: '发布时描述',
        publishedAt: now,
        slug: 'dashboard-stable',
        isCurrent: true,
        isPublished: true,
      },
    ])
    const response = await createTestApp({ listReleases }).request(`/projects/${projectId}/releases`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      releases: [
        {
          projectId,
          releaseNumber: 2,
          revisionId,
          revisionNumber: 8,
          name: '发布时名称',
          description: '发布时描述',
          publishedAt: now.toISOString(),
          isCurrent: true,
          isPublished: true,
          stableUrl: '/api/public/projects/dashboard-stable',
          versionUrl: '/api/public/projects/dashboard-stable/versions/2',
        },
      ],
    })
  })

  it('returns the server-authored saved time for a successful CAS draft save', async () => {
    const savedAt = new Date('2026-07-30T04:05:06.000Z')
    const saveDraft = vi.fn(async () => ({ ...detail, draftVersion: 5, updatedAt: savedAt }))
    const response = await createTestApp({ saveDraft }).request(
      new Request(`https://app.example.com/projects/${projectId}/draft`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: 4, schema: { componentsTree: [] } }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ savedAt: savedAt.toISOString() })
  })

  it('issues a signed thumbnail upload without exposing the session token', async () => {
    const createThumbnailUpload = vi.fn(async () => ({
      bucket: 'easy-dashboard-thumbnails',
      path: `${actorId}/${projectId}/4/artifact.webp`,
      signedUrl: 'https://storage.example.com/signed-upload',
      token: 'upload-token',
      draftVersion: 4,
      mode: 'auto' as const,
      contentType: 'image/webp' as const,
      maxBytes: 10 * 1024 * 1024,
      expiresIn: 7200,
    }))
    const response = await createTestApp({ createThumbnailUpload }).request(
      new Request(`https://app.example.com/projects/${projectId}/thumbnail/upload`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: '__Host-ed-access-token=session-secret',
        },
        body: JSON.stringify({
          draftVersion: 4,
          mode: 'auto',
          source: 'renderer',
          contentType: 'image/webp',
          size: 1024,
        }),
      }),
    )

    expect(response.status).toBe(201)
    expect(createThumbnailUpload).toHaveBeenCalledWith(actorId, 'session-secret', projectId, {
      draftVersion: 4,
      mode: 'auto',
      source: 'renderer',
      contentType: 'image/webp',
      size: 1024,
    })
    expect(await response.text()).not.toContain('session-secret')
  })

  it('commits or fails only the thumbnail matching the requested draft version', async () => {
    const completeThumbnailUpload = vi.fn(async () => ({
      ...summary,
      thumbnailStatus: 'ready' as const,
      thumbnailPath: `${actorId}/${projectId}/4/artifact.webp`,
      thumbnailUrl: `/api/projects/${projectId}/thumbnail/content`,
      thumbnailDraftVersion: 4,
    }))
    const failThumbnailUpload = vi.fn(async () => true)
    const app = createTestApp({ completeThumbnailUpload, failThumbnailUpload })
    const headers = {
      'content-type': 'application/json',
      cookie: '__Host-ed-access-token=session-secret',
    }

    const complete = await app.request(
      new Request(`https://app.example.com/projects/${projectId}/thumbnail/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          draftVersion: 4,
          path: `${actorId}/${projectId}/4/artifact.webp`,
        }),
      }),
    )
    const failed = await app.request(
      new Request(`https://app.example.com/projects/${projectId}/thumbnail/fail`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          draftVersion: 4,
          path: `${actorId}/${projectId}/4/artifact.webp`,
          errorCode: 'canvas-security',
        }),
      }),
    )

    expect(complete.status).toBe(200)
    expect(failed.status).toBe(204)
    expect(completeThumbnailUpload).toHaveBeenCalledWith(
      actorId,
      'session-secret',
      projectId,
      expect.objectContaining({ draftVersion: 4 }),
    )
    expect(failThumbnailUpload).toHaveBeenCalledWith(actorId, 'session-secret', projectId, {
      draftVersion: 4,
      path: `${actorId}/${projectId}/4/artifact.webp`,
      errorCode: 'canvas-security',
    })
  })

  it('reconciles thumbnail artifacts with the user session only through the backend', async () => {
    const reconcileThumbnailArtifacts = vi.fn(async () => ({ deleted: 2, retryPending: 1 }))
    const response = await createTestApp({ reconcileThumbnailArtifacts }).request(
      new Request(`https://app.example.com/projects/${projectId}/thumbnail/reconcile`, {
        method: 'POST',
        headers: { cookie: '__Host-ed-access-token=session-secret' },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ cleanup: { deleted: 2, retryPending: 1 } })
    expect(reconcileThumbnailArtifacts).toHaveBeenCalledWith(actorId, 'session-secret', projectId)
  })
})
