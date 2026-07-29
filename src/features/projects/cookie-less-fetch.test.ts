import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCookieLessFetchGuard } from './cookie-less-fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('installCookieLessFetchGuard', () => {
  it('overrides credentials for every viewer fetch, including Request inputs', async () => {
    const nativeFetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', nativeFetch)
    const restore = installCookieLessFetchGuard()

    await fetch(new Request('https://data.example.test/report', { credentials: 'include' }), {
      credentials: 'include',
    })

    expect(nativeFetch).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        credentials: 'omit',
      }),
    )

    restore()
    expect(globalThis.fetch).toBe(nativeFetch)
  })
})
