import { LogoLoading } from '@/components/common/logo-loading'
import { installCookieLessFetchGuard } from '@/features/projects/cookie-less-fetch'
import { evaluatePublicViewerAccess } from '@/features/projects/public-viewer'
import { initGlobals } from '@/globals'
import { Suspense, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from 'react-error-boundary'
import { BrowserRouter } from 'react-router'

import '@/styles/global.css'

installCookieLessFetchGuard()

const PublicPreview = lazy(() => import('./PublicPreview').then(module => ({ default: module.PublicPreview })))

function readSlug(pathname: string): string | null {
  const match = /^\/view\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function ViewerState({ children }: { children: React.ReactNode }) {
  return <div className='grid min-h-screen place-items-center bg-[#080A0D] p-6 text-sm text-[#F1F5F7]'>{children}</div>
}

function ViewerApp() {
  const slug = readSlug(window.location.pathname)
  const access = slug ? evaluatePublicViewerAccess(slug, window.location.origin) : { status: 'misconfigured' as const }

  useEffect(() => {
    if (access.status === 'redirect') {
      window.location.replace(access.viewerUrl)
    }
  }, [access])

  if (!slug) {
    return <ViewerState>发布地址无效。</ViewerState>
  }

  if (access.status === 'misconfigured') {
    return <ViewerState>公开 Viewer 域名未正确配置。</ViewerState>
  }

  if (access.status === 'redirect') {
    return <LogoLoading />
  }

  return <PublicPreview slug={slug} />
}

initGlobals()

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary fallback={<ViewerState>公开大屏加载失败，请稍后重试。</ViewerState>}>
    <Suspense fallback={<LogoLoading />}>
      <BrowserRouter>
        <ViewerApp />
      </BrowserRouter>
    </Suspense>
  </ErrorBoundary>,
)
