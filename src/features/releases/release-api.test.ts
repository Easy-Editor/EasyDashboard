import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listProjectReleases,
  publishProjectRelease,
  restoreProjectReleaseDraft,
  unpublishProjectRelease,
} from './release-api'

const projectId = '22222222-2222-4222-8222-222222222222'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('release API', () => {
  it('lists release history with stable and immutable viewer paths', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        releases: [
          {
            projectId,
            releaseNumber: 3,
            revisionId: '33333333-3333-4333-8333-333333333333',
            revisionNumber: 8,
            publishedAt: '2026-07-30T04:05:06.000Z',
            stableUrl: '/api/public/projects/operations-stable',
            versionUrl: '/api/public/projects/operations-stable/versions/3',
            isCurrent: true,
            isPublished: true,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(listProjectReleases(projectId)).resolves.toEqual([
      {
        projectId,
        releaseNumber: 3,
        revisionId: '33333333-3333-4333-8333-333333333333',
        revisionNumber: 8,
        publishedAt: '2026-07-30T04:05:06.000Z',
        slug: 'operations-stable',
        stablePath: '/view/operations-stable',
        versionPath: '/view/operations-stable/versions/3',
        isCurrent: true,
        isPublished: true,
      },
    ])
    expect(fetch).toHaveBeenCalledWith(`/api/projects/${projectId}/releases`, expect.any(Object))
  })

  it('publishes the saved draft and returns both viewer paths', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          publication: {
            projectId,
            releaseNumber: 4,
            revisionId: '44444444-4444-4444-8444-444444444444',
            revisionNumber: 9,
            publishedAt: '2026-07-30T05:05:06.000Z',
            slug: 'operations-stable',
            stableUrl: '/api/public/projects/operations-stable',
            versionUrl: '/api/public/projects/operations-stable/versions/4',
          },
        },
        201,
      ),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(publishProjectRelease(projectId, 8)).resolves.toMatchObject({
      slug: 'operations-stable',
      releaseNumber: 4,
      stablePath: '/view/operations-stable',
      versionPath: '/view/operations-stable/versions/4',
      isCurrent: true,
      isPublished: true,
    })
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${projectId}/publish`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 8 }),
      }),
    )
  })

  it('unpublishes without creating or restoring another release', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await expect(unpublishProjectRelease(projectId)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${projectId}/unpublish`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
  })

  it('restores a published release into the draft with optimistic concurrency', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        project: {
          draftSchema: {
            version: '1.0.0',
            componentsTree: [],
          },
          draftVersion: 12,
        },
        savedAt: '2026-07-30T06:05:06.000Z',
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(restoreProjectReleaseDraft(projectId, 4, 11)).resolves.toEqual({
      project: {
        draftSchema: {
          version: '1.0.0',
          componentsTree: [],
        },
        draftVersion: 12,
      },
      savedAt: '2026-07-30T06:05:06.000Z',
    })
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${projectId}/releases/4/restore`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 11 }),
      }),
    )
  })

  it('rejects a malformed release restore response instead of accepting an unknown baseline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    await expect(restoreProjectReleaseDraft(projectId, 4, 11)).rejects.toThrow(
      '发布版本恢复响应缺少项目文档、版本或保存时间',
    )
  })
})
