import { describe, expect, it, vi } from 'vitest'
import { probePublicViewerAccess, publicViewerProbePath } from './public-access-gate'

describe('publicViewerProbePath', () => {
  it('maps stable and immutable viewer routes to the public API probe', () => {
    expect(publicViewerProbePath('/view/city%20ops')).toBe('/api/public/projects/city%20ops?probe=1')
    expect(publicViewerProbePath('/view/city-ops/versions/7/')).toBe('/api/public/projects/city-ops/versions/7?probe=1')
  })

  it('rejects malformed viewer routes before they reach the SPA fallback', () => {
    expect(publicViewerProbePath('/view')).toBeNull()
    expect(publicViewerProbePath('/view/city-ops/versions/latest')).toBeNull()
    expect(publicViewerProbePath('/view/city-ops/versions/0')).toBeNull()
    expect(publicViewerProbePath('/view/city-ops/other')).toBeNull()
  })
})

describe('probePublicViewerAccess', () => {
  it('allows only a successful public API probe without credentials or caching', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))

    await expect(
      probePublicViewerAccess({
        pathname: '/view/city-ops/versions/3',
        apiOrigin: 'https://app.example.com',
        fetch: fetchMock,
      }),
    ).resolves.toEqual({ status: 'allow' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://app.example.com/api/public/projects/city-ops/versions/3?probe=1')
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'manual',
    })
  })

  it('keeps not-found separate from upstream failure', async () => {
    await expect(
      probePublicViewerAccess({
        pathname: '/view/missing',
        apiOrigin: 'https://app.example.com',
        fetch: vi.fn(async () => new Response(null, { status: 404 })),
      }),
    ).resolves.toEqual({ status: 'not-found' })

    for (const response of [new Response(null, { status: 503 }), new Error('network down')]) {
      await expect(
        probePublicViewerAccess({
          pathname: '/view/published',
          apiOrigin: 'https://app.example.com',
          fetch: vi.fn(async () => {
            if (response instanceof Error) throw response
            return response
          }),
        }),
      ).resolves.toEqual({ status: 'unavailable' })
    }
  })
})
