import { afterEach, describe, expect, it, vi } from 'vitest'
import viewerGate from './middleware'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('viewer routing middleware', () => {
  it('returns a real HTTP 404 before the SPA fallback for malformed or missing releases', async () => {
    vi.stubEnv('VITE_PUBLIC_API_ORIGIN', 'https://app.example.com')
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const missing = await viewerGate(new Request('https://view.example.com/view/missing'))
    const malformed = await viewerGate(new Request('https://view.example.com/view/project/versions/latest'))

    expect(missing.status).toBe(404)
    expect(missing.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await missing.text()).toContain('发布地址不存在')
    expect(malformed.status).toBe(404)
  })

  it('preserves the real 404 status for HEAD checks without returning a response body', async () => {
    vi.stubEnv('VITE_PUBLIC_API_ORIGIN', 'https://app.example.com')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )

    const response = await viewerGate(
      new Request('https://view.example.com/view/missing', {
        method: 'HEAD',
      }),
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })

  it('rewrites a visible release to the static Viewer entry', async () => {
    vi.stubEnv('VITE_PUBLIC_API_ORIGIN', 'https://app.example.com')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )

    const response = await viewerGate(new Request('https://view.example.com/view/city-ops/versions/2'))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://view.example.com/index.html')
  })

  it('returns 503 instead of a false 404 when publication validation is unavailable', async () => {
    vi.stubEnv('VITE_PUBLIC_API_ORIGIN', '')

    const response = await viewerGate(new Request('https://view.example.com/view/city-ops'))

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('30')
  })
})
