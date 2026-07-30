import { installCookieLessFetchGuard } from '@/features/projects/cookie-less-fetch'
import { evaluatePublicViewerAccess } from '@/features/projects/public-viewer'
import { initGlobals } from '@/globals'
import { Suspense, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { ViewerState } from './ViewerState'
import { buildViewerRedirectUrl, parseViewerLocation } from './viewer-route'

import '@/styles/global.css'

installCookieLessFetchGuard()

const PublicPreview = lazy(() => import('./PublicPreview').then(module => ({ default: module.PublicPreview })))

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
    return (
      <ViewerState
        code='404 / ROUTE'
        title='发布地址无效'
        detail='请确认链接完整，并向发布者重新获取访问地址。'
        tone='error'
      />
    )
  }

  if (access.status === 'misconfigured') {
    return (
      <ViewerState
        code='503 / CONFIG'
        title='公开 Viewer 尚未就绪'
        detail='发布域名配置不完整，请稍后再试或联系发布者。'
        tone='error'
      />
    )
  }

  if (access.status === 'redirect') {
    return <ViewerState code='VIEW / REDIRECT' title='正在打开公开大屏…' detail='正在切换到独立 Viewer 域名。' />
  }

  return <PublicPreview {...route} />
}

initGlobals()

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary
    fallback={
      <ViewerState
        code='VIEW / RENDER'
        title='公开大屏渲染失败'
        detail='页面内容未能完成渲染，请刷新后重试。'
        tone='error'
        actionLabel='刷新页面'
        onAction={() => window.location.reload()}
      />
    }
  >
    <Suspense fallback={<ViewerState code='VIEW / BOOT' title='正在启动 Viewer…' detail='正在装载大屏渲染环境。' />}>
      <ViewerApp />
    </Suspense>
  </ErrorBoundary>,
)
