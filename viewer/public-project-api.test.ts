import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublishedProject } from './public-project-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPublishedProject', () => {
  it('loads stable and numbered publications without credentials', async () => {
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            project: {
              projectId: 'project-1',
              slug: 'sales',
              releaseNumber: 7,
              document: {
                version: '1.0.0',
                componentsTree: [],
                meta: {
                  easyDashboard: {
                    documentVersion: 1,
                    startPageId: 'overview',
                    theme: { tokens: {} },
                  },
                },
              },
              name: 'Sales',
              publishedAt: '2026-07-30T00:00:00.000Z',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetch)

    const stable = await getPublishedProject('sales')
    const versioned = await getPublishedProject('sales', 7)

    expect(stable.schema).toMatchObject({ formatVersion: 1 })
    expect(stable.draftVersion).toBe(7)
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/public/projects/sales',
      expect.objectContaining({ credentials: 'omit' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/public/projects/sales/versions/7',
      expect.objectContaining({ credentials: 'omit' }),
    )
  })

  it('surfaces a clean not-found error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: '发布版本不存在' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(getPublishedProject('missing')).rejects.toMatchObject({
      name: 'PublicProjectNotFoundError',
      message: '发布版本不存在',
    })
  })
})
