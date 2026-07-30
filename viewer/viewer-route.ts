export type ViewerRoute = {
  slug: string
  releaseNumber: number | null
  pageId: string | null
}

export function buildViewerRedirectUrl(viewerUrl: string, pathname: string, search: string): string {
  return new URL(`${pathname}${search}`, viewerUrl).toString()
}

/** Page deep links are shared by stable and immutable URLs through `?page=<pageId>`. */
export function parseViewerLocation(pathname: string, search: string): ViewerRoute | null {
  const match = /^\/view\/([^/]+)(?:\/versions\/([^/]+))?\/?$/.exec(pathname)
  if (!match) return null

  try {
    const slug = decodeURIComponent(match[1])
    const releaseNumber = match[2] === undefined ? null : Number(match[2])
    if (!slug || (releaseNumber !== null && (!Number.isSafeInteger(releaseNumber) || releaseNumber <= 0))) {
      return null
    }

    const pageId = new URLSearchParams(search).get('page')?.trim() || null
    return { slug, releaseNumber, pageId }
  } catch {
    return null
  }
}
