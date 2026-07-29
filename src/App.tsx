import { Suspense, lazy, useEffect } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { Navigate, RouterProvider, createBrowserRouter, useParams } from 'react-router'
import { PublicOnlyRoute, RequireSession } from './auth/RequireSession'
import { LogoLoading } from './components/common/logo-loading'
import { ThemeProvider } from './components/theme-provider'
import { evaluatePublicViewerAccess } from './features/projects/public-viewer'
import { AppShell } from './layouts/AppShell'
import { AuthLayout } from './layouts/AuthLayout'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { ProjectsPage } from './pages/projects/ProjectsPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { TemplatesPage } from './pages/templates/TemplatesPage'

const Preview = lazy(() => import('./pages/preview'))
const Editor = lazy(() => import('./pages/editor'))

function PublicViewerRoute() {
  const { slug } = useParams<{ slug: string }>()
  const access = slug ? evaluatePublicViewerAccess(slug, window.location.origin) : { status: 'misconfigured' as const }
  const redirectUrl = access.status === 'redirect' ? access.viewerUrl : null

  useEffect(() => {
    if (redirectUrl) {
      window.location.replace(redirectUrl)
    }
  }, [redirectUrl])

  if (!slug) {
    return (
      <div className='grid min-h-screen place-items-center bg-[#080A0D] p-6 text-sm text-[#F1F5F7]'>发布地址无效。</div>
    )
  }

  if (access.status === 'misconfigured' || access.status === 'ready') {
    return (
      <div className='grid min-h-screen place-items-center bg-[#080A0D] p-6 text-[#F1F5F7]'>
        <div className='border border-[#2A333D] bg-[#0F1318] px-6 py-5 text-center'>
          <p className='text-sm font-medium'>
            {access.status === 'ready' ? '当前部署不是公开预览构建' : '公开预览域名未配置'}
          </p>
          <p className='mt-2 text-xs text-[#8D99A3]'>
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
    ],
  },
  {
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/templates', element: <TemplatesPage /> },
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
  { path: '/', element: <Navigate to='/projects' replace /> },
  { path: '*', element: <Navigate to='/projects' replace /> },
])

function App() {
  return (
    <ErrorBoundary
      fallback={
        <div className='grid min-h-screen place-items-center bg-[#080A0D] p-6 text-sm text-[#F1F5F7]'>
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
