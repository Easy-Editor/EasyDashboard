import { Suspense, lazy, useEffect } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { RouterProvider, createBrowserRouter, useParams } from 'react-router'
import { PublicOnlyRoute, RequireSession } from './auth/RequireSession'
import { LogoLoading } from './components/common/logo-loading'
import { ThemeProvider } from './components/theme-provider'
import { evaluatePublicViewerAccess } from './features/projects/public-viewer'
import { AppShell } from './layouts/AppShell'
import { AuthLayout } from './layouts/AuthLayout'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { LoginPage } from './pages/auth/LoginPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { SignupPage } from './pages/auth/SignupPage'
import { HomePage } from './pages/home/HomePage'
import { NotFoundPage } from './pages/not-found/NotFoundPage'
import { ProjectsPage } from './pages/projects/ProjectsPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { TrashPage } from './pages/trash/TrashPage'

const Preview = lazy(() => import('./pages/preview'))
const Editor = lazy(() => import('./pages/editor'))

function PublicViewerRoute() {
  const { slug } = useParams<{ slug: string }>()
  const access = slug ? evaluatePublicViewerAccess(slug, window.location.origin) : { status: 'misconfigured' as const }
  const redirectUrl =
    access.status === 'redirect'
      ? new URL(`${window.location.pathname}${window.location.search}`, access.viewerUrl).toString()
      : null

  useEffect(() => {
    if (redirectUrl) {
      window.location.replace(redirectUrl)
    }
  }, [redirectUrl])

  if (!slug) {
    return (
      <div
        data-ed-shell='viewer-gate'
        className='grid min-h-screen place-items-center bg-[var(--ed-canvas)] p-6 text-sm text-[var(--ed-ink)]'
      >
        发布地址无效。
      </div>
    )
  }

  if (access.status === 'misconfigured' || access.status === 'ready') {
    return (
      <div
        data-ed-shell='viewer-gate'
        className='grid min-h-screen place-items-center bg-[var(--ed-canvas)] p-6 text-[var(--ed-ink)]'
      >
        <div className='border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-6 py-5 text-center'>
          <p className='text-sm font-medium'>
            {access.status === 'ready' ? '当前部署不是公开预览构建' : '公开预览域名未配置'}
          </p>
          <p className='mt-2 text-xs text-[var(--ed-ink-muted)]'>
            {access.status === 'ready'
              ? '公开项目只能由独立 Viewer 构建加载。'
              : '请配置 VITE_PUBLIC_VIEWER_ORIGIN 后重新部署。'}
          </p>
        </div>
      </div>
    )
  }

  return <LogoLoading />
}

const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      {
        path: '/login',
        element: (
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        ),
      },
      {
        path: '/signup',
        element: (
          <PublicOnlyRoute>
            <SignupPage />
          </PublicOnlyRoute>
        ),
      },
      {
        path: '/forgot-password',
        element: (
          <PublicOnlyRoute>
            <ForgotPasswordPage />
          </PublicOnlyRoute>
        ),
      },
      {
        path: '/reset-password',
        element: <ResetPasswordPage />,
      },
    ],
  },
  {
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/trash', element: <TrashPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '/projects/:projectId/editor',
    element: (
      <RequireSession>
        <Editor />
      </RequireSession>
    ),
  },
  {
    path: '/projects/:projectId/preview',
    element: (
      <RequireSession>
        <Preview />
      </RequireSession>
    ),
  },
  { path: '/view/:slug', element: <PublicViewerRoute /> },
  { path: '/view/:slug/versions/:releaseNumber', element: <PublicViewerRoute /> },
  { path: '*', element: <NotFoundPage /> },
])

function App() {
  return (
    <ErrorBoundary
      fallback={
        <div
          data-ed-shell='error'
          className='grid min-h-screen place-items-center bg-[var(--ed-canvas)] p-6 text-sm text-[var(--ed-ink)]'
        >
          页面加载失败，请刷新后重试。
        </div>
      }
    >
      <ThemeProvider defaultTheme='dark' storageKey='easy-dashboard-theme'>
        <Suspense fallback={<LogoLoading />}>
          <RouterProvider router={router} />
        </Suspense>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
