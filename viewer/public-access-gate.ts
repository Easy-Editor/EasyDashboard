export type PublicViewerGateResult = { status: 'allow' } | { status: 'not-found' } | { status: 'unavailable' }

type FetchLike = typeof fetch

export function publicViewerErrorResponse(status: 404 | 503, headOnly = false): Response {
  const notFound = status === 404
  const title = notFound ? '发布地址不存在' : '公开大屏暂时不可用'
  const detail = notFound ? '该大屏可能尚未发布、已取消发布或已移入回收站。' : '发布状态校验暂时失败，请稍后重试。'
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${status} · EasyDashboard</title><style>html{color-scheme:dark;background:#080a0d}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:ui-sans-serif,system-ui,sans-serif;color:#f1f5f7}.panel{width:min(420px,calc(100vw - 48px));border:1px solid #29333d;background:#0f141a;padding:28px}.code{font:600 12px ui-monospace,monospace;letter-spacing:.18em;color:#67c6d9}h1{margin:14px 0 8px;font-size:22px}p{margin:0;color:#81909a;font-size:13px;line-height:1.8}</style></head><body><main class="panel"><div class="code">${status}</div><h1>${title}</h1><p>${detail}</p></main></body></html>`

  return new Response(headOnly ? null : body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex',
      ...(status === 503 ? { 'Retry-After': '30' } : {}),
    },
  })
}

function publicApiOrigin(value: string | undefined): URL | null {
  const candidate = value?.trim()
  if (!candidate) return null

  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

export function publicViewerProbePath(pathname: string): string | null {
  const match = /^\/view\/([^/]+)(?:\/versions\/([^/]+))?\/?$/.exec(pathname)
  if (!match) return null

  try {
    const slug = decodeURIComponent(match[1]).trim()
    const releaseNumber = match[2] === undefined ? null : Number(match[2])
    if (!slug || (releaseNumber !== null && (!Number.isSafeInteger(releaseNumber) || releaseNumber <= 0))) {
      return null
    }

    const base = `/api/public/projects/${encodeURIComponent(slug)}`
    return `${releaseNumber === null ? base : `${base}/versions/${releaseNumber}`}?probe=1`
  } catch {
    return null
  }
}

export async function probePublicViewerAccess(input: {
  pathname: string
  apiOrigin: string | undefined
  fetch?: FetchLike
  timeoutMs?: number
}): Promise<PublicViewerGateResult> {
  const probePath = publicViewerProbePath(input.pathname)
  if (!probePath) return { status: 'not-found' }

  const origin = publicApiOrigin(input.apiOrigin)
  if (!origin) return { status: 'unavailable' }

  try {
    const response = await (input.fetch ?? fetch)(new URL(probePath, origin), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? 3_000),
    })

    if (response.status === 404 || response.status === 410) return { status: 'not-found' }
    if (!response.ok) return { status: 'unavailable' }
    return { status: 'allow' }
  } catch {
    return { status: 'unavailable' }
  }
}
