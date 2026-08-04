import { describe, expect, it, vi } from 'vitest'
import { probePublicViewerAccess, publicViewerErrorResponse, publicViewerProbePath } from './public-access-gate'

describe('publicViewerErrorResponse', () => {
  it('renders a human-readable Chinese error without release diagnostics', async () => {
    const response = publicViewerErrorResponse(404)
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(html).toContain('<title>发布地址不存在 · EasyDashboard</title>')
    expect(html).toContain('请检查链接，或联系发布者确认该大屏仍在公开。')
    expect(html).toContain('>重新检查</button>')
    expect(html).not.toMatch(/404 \/ RELEASE|class="code"|class="head"/)
  })

  it('keeps HEAD responses empty while preserving retry metadata', async () => {
    const response = publicViewerErrorResponse(503, true)

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(await response.text()).toBe('')
  })
})

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
