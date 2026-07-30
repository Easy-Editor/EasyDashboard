import { installCookieLessFetchGuard } from '@/features/projects/cookie-less-fetch'
import { evaluatePublicViewerAccess } from '@/features/projects/public-viewer'
import { initGlobals } from '@/globals'
import { Suspense, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { buildViewerRedirectUrl, parseViewerLocation } from './viewer-route'

import '@/styles/global.css'

installCookieLessFetchGuard()

const PublicPreview = lazy(() => import('./PublicPreview').then(module => ({ default: module.PublicPreview })))

function ViewerState({ children }: { children: React.ReactNode }) {
  return <output className='grid min-h-screen place-items-center bg-black p-6 text-sm text-white'>{children}</output>
}

function ViewerApp() {
  const route = parseViewerLocation(window.location.pathname, window.location.search)
  const access = route
    ? evaluatePublicViewerAccess(route.slug, window.location.origin)
    : { status: 'misconfigured' as const }
  const redirectUrl =
    access.status === 'redirect'
      ? buildViewerRedirectUrl(access.viewerUrl, window.location.pathname, window.location.search)
      : null

  useEffect(() => {
    if (redirectUrl) {
      window.location.replace(redirectUrl)
    }
  }, [redirectUrl])

  if (!route) {
    return <ViewerState>发布地址无效。</ViewerState>
  }

  if (access.status === 'misconfigured') {
    return <ViewerState>公开 Viewer 域名未正确配置。</ViewerState>
  }

  if (access.status === 'redirect') {
    return <ViewerState>正在跳转…</ViewerState>
  }

  return <PublicPreview {...route} />
}

initGlobals()

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary fallback={<ViewerState>公开大屏加载失败，请稍后重试。</ViewerState>}>
    <Suspense fallback={<ViewerState>正在加载…</ViewerState>}>
      <ViewerApp />
    </Suspense>
  </ErrorBoundary>,
)
