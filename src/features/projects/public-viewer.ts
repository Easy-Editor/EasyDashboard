const DEVELOPMENT_VIEWER_ORIGIN = 'http://view.localhost:5174'

export type PublicViewerAccess =
  | {
      status: 'ready'
      viewerUrl: string
    }
  | {
      status: 'redirect'
      viewerUrl: string
    }
  | {
      status: 'misconfigured'
    }

export function normalizePublicViewerOrigin(value: string | undefined): string | null {
  const candidate = value?.trim()
  if (!candidate) return null

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

export function resolvePublicViewerOrigin(configuredOrigin: string | undefined, production: boolean): string | null {
  const normalizedOrigin = normalizePublicViewerOrigin(configuredOrigin)
  if (normalizedOrigin) return normalizedOrigin
  if (configuredOrigin?.trim() || production) return null
  return DEVELOPMENT_VIEWER_ORIGIN
}

export function getPublicViewerOrigin(): string | null {
  return resolvePublicViewerOrigin(
    import.meta.env.VITE_PUBLIC_VIEWER_ORIGIN as string | undefined,
    import.meta.env.PROD,
  )
}

export function getPublishedProjectUrl(slug: string, viewerOrigin = getPublicViewerOrigin()): string | null {
  if (!viewerOrigin) return null
  return new URL(`/view/${encodeURIComponent(slug)}`, `${viewerOrigin}/`).toString()
}

export function evaluatePublicViewerAccess(
  slug: string,
  currentOrigin: string,
  viewerOrigin = getPublicViewerOrigin(),
): PublicViewerAccess {
  const viewerUrl = getPublishedProjectUrl(slug, viewerOrigin)
  if (!viewerUrl || normalizePublicViewerOrigin(currentOrigin) !== viewerOrigin) {
    return viewerUrl ? { status: 'redirect', viewerUrl } : { status: 'misconfigured' }
  }
  return { status: 'ready', viewerUrl }
}
