export function installCookieLessFetchGuard(): () => void {
  const originalFetch = globalThis.fetch
  const guardedFetch: typeof fetch = (input, init) =>
    originalFetch(input, {
      ...init,
      credentials: 'omit',
    })

  globalThis.fetch = guardedFetch

  return () => {
    if (globalThis.fetch === guardedFetch) {
      globalThis.fetch = originalFetch
    }
  }
}
