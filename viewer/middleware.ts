import { rewrite } from '@vercel/functions'
import { probePublicViewerAccess, publicViewerErrorResponse } from './public-access-gate'

export const config = {
  matcher: '/view/:path*',
  runtime: 'edge',
}

export default async function viewerGate(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Cache-Control': 'private, no-store',
      },
    })
  }

  const result = await probePublicViewerAccess({
    pathname: new URL(request.url).pathname,
    apiOrigin: process.env.VITE_PUBLIC_API_ORIGIN,
  })

  const headOnly = request.method === 'HEAD'
  if (result.status === 'not-found') return publicViewerErrorResponse(404, headOnly)
  if (result.status === 'unavailable') return publicViewerErrorResponse(503, headOnly)
  return rewrite(new URL('/index.html', request.url))
}
