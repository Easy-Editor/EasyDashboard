import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createProjectRestorePoint,
  deleteProjectPermanently,
  duplicateProject,
  getProject,
  listProjectRestorePoints,
  listProjects,
  publishProject,
  restoreProject,
  restoreProjectRevision,
  saveProjectDraft,
  setProjectFavorite,
  trashProject,
} from './project-api'

const projectId = '22222222-2222-4222-8222-222222222222'
const revisionId = '33333333-3333-4333-8333-333333333333'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('project product API', () => {
  it('unwraps the canonical Agent document before handing it to the editor', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        project: {
          id: projectId,
          name: 'Agent dashboard',
          description: null,
          draftVersion: 2,
          draftSchema: {
            formatVersion: 1,
            editorSchema: {
              version: '1.0.0',
              componentsMap: [
                {
                  devMode: 'proCode',
                  componentName: 'Text',
                  package: '@easy-editor/materials-dashboard-text',
                  version: '0.0.22',
                  globalName: 'EasyEditorMaterialsText',
                },
              ],
              componentsTree: [
                {
                  id: 'page-home-root',
                  componentName: 'Root',
                  fileName: 'home',
                  children: [{ id: 'agent-title', componentName: 'Text', props: { text: 'Agent dashboard' } }],
                },
              ],
            },
            presentation: { startPageId: 'page-home-root', theme: { mode: 'dark', tokens: {} } },
          },
          updatedAt: '2026-07-30T04:05:06.000Z',
        },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    const detail = await getProject(projectId)

    expect(detail.schema.componentsTree[0]).toMatchObject({
      id: 'page-home-root',
      children: [
        {
          id: 'agent-title',
          npm: {
            package: '@easy-editor/materials-dashboard-text',
            version: '0.0.22',
          },
        },
      ],
    })
  })

  it('loads lightweight active or trash summaries without deriving metadata from a schema', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        projects: [
          {
            id: projectId,
            name: 'Operations',
            description: null,
            draftVersion: 7,
            draftSavedAt: '2026-07-30T04:05:06.000Z',
            canvasWidth: 2560,
            canvasHeight: 1440,
            pageCount: 3,
            startPageId: 'page-overview',
            isFavorite: true,
            publicationSlug: 'operations-stable',
            isPublished: true,
            publishedAt: '2026-07-30T03:05:06.000Z',
            currentReleaseNumber: 4,
            thumbnailMode: 'auto',
            thumbnailStatus: 'ready',
            thumbnailUrl: 'https://assets.example.com/operations.webp',
            thumbnailDraftVersion: 7,
            deletedAt: null,
            updatedAt: '2026-07-30T04:05:06.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)

    const result = await listProjects('trash')

    expect(fetch).toHaveBeenCalledWith('/api/projects?view=trash', expect.any(Object))
    expect(result.projects[0]).toMatchObject({
      id: projectId,
      resolution: { width: 2560, height: 1440 },
      pageCount: 3,
      isFavorite: true,
      slug: 'operations-stable',
      state: 'published',
      publishedAt: '2026-07-30T03:05:06.000Z',
      currentReleaseNumber: 4,
      thumbnail: {
        mode: 'auto',
        status: 'ready',
        url: 'https://assets.example.com/operations.webp',
        draftVersion: 7,
      },
    })
  })

  it('uses explicit lifecycle endpoints for favorite, duplicate, trash, and restore', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ project: { id: projectId, isFavorite: true } }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            project: {
              id: projectId,
              name: 'Operations copy',
              description: null,
              draftVersion: 1,
              draftSchema: { componentsTree: [] },
              canvasWidth: 1920,
              canvasHeight: 1080,
              pageCount: 1,
              updatedAt: '2026-07-30T04:05:06.000Z',
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ project: { id: projectId, deletedAt: null } }))
    vi.stubGlobal('fetch', fetch)

    await setProjectFavorite(projectId, true)
    const duplicate = await duplicateProject(projectId)
    await trashProject(projectId)
    await restoreProject(projectId)

    expect(duplicate.name).toBe('Operations copy')
    expect(fetch.mock.calls.map(call => [call[0], (call[1] as RequestInit).method])).toEqual([
      [`/api/projects/${projectId}/favorite`, 'PUT'],
      [`/api/projects/${projectId}/duplicate`, 'POST'],
      [`/api/projects/${projectId}`, 'DELETE'],
      [`/api/projects/${projectId}/restore`, 'POST'],
    ])
  })

  it('uses the explicit permanent-delete endpoint for a confirmed trash action', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await deleteProjectPermanently(projectId)

    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${projectId}/permanent`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('uses server-confirmed save time and persistent restore-point endpoints', async () => {
    const savedAt = '2026-07-30T04:05:06.000Z'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ draftVersion: 8, savedAt }))
      .mockResolvedValueOnce(
        jsonResponse({
          revisions: [
            {
              id: revisionId,
              revisionNumber: 3,
              kind: 'manual',
              createdAt: savedAt,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            revision: {
              id: revisionId,
              revisionNumber: 4,
              kind: 'manual',
              createdAt: savedAt,
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ draftVersion: 9, savedAt }))
    vi.stubGlobal('fetch', fetch)

    await expect(saveProjectDraft(projectId, { version: '1.0.0', componentsTree: [] }, 7)).resolves.toEqual({
      draftVersion: 8,
      savedAt,
      updatedAt: savedAt,
    })
    await expect(listProjectRestorePoints(projectId)).resolves.toMatchObject({
      restorePoints: [{ id: revisionId, kind: 'manual' }],
    })
    await expect(createProjectRestorePoint(projectId)).resolves.toMatchObject({
      id: revisionId,
      kind: 'manual',
    })
    await expect(restoreProjectRevision(projectId, revisionId, 8)).resolves.toEqual({
      draftVersion: 9,
      savedAt,
      updatedAt: savedAt,
    })
  })

  it('returns both stable and immutable viewer URLs after publishing', async () => {
    const snapshotId = '55555555-5555-4555-8555-555555555555'
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            snapshot: { id: snapshotId, documentSha256: 'a'.repeat(64) },
            previewRun: { id: 'preview', source: 'editor_renderer_artifact' },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ approval: { id: 'approval' } }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            publication: {
              projectId,
              slug: 'operations-stable',
              revisionId,
              revisionNumber: 5,
              releaseNumber: 2,
              publishedAt: '2026-07-30T04:05:06.000Z',
              stableUrl: '/api/public/projects/operations-stable',
              versionUrl: '/api/public/projects/operations-stable/versions/2',
              isCurrent: true,
              isPublished: true,
            },
          },
          201,
        ),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(publishProject(projectId, 7)).resolves.toMatchObject({
      slug: 'operations-stable',
      releaseNumber: 2,
      stablePath: '/view/operations-stable',
      versionPath: '/view/operations-stable/versions/2',
    })
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `/api/projects/${projectId}/agent/publish-snapshots`,
      expect.objectContaining({ body: JSON.stringify({ draftVersion: 7 }) }),
    )
  })
})
