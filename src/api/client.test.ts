import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiRequest } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it("preserves explicit credentials: 'omit' for public requests", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ slug: 'public-dashboard' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetch)

    await apiRequest('/api/public/projects/public-dashboard', {
      credentials: 'omit',
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      '/api/public/projects/public-dashboard',
      expect.objectContaining({ credentials: 'omit' }),
    )
  })

  it('sends the JSON and CSRF headers required by bodyless mutations', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)

    await apiRequest('/api/auth/sign-out', { method: 'POST' })

    const request = fetch.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(request.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('X-CSRF-Token')).toBe('1')
  })
})
