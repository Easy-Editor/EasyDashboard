import { Suspense, lazy } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { LogoLoading } from './components/common/logo-loading'
import { ThemeProvider } from './components/theme-provider'

const Preview = lazy(() => import('./pages/preview'))
const Editor = lazy(() => import('./pages/editor'))

function App() {
  return (
    <ErrorBoundary fallback={<div className='p-4 text-red-500'>严重错误！请刷新页面</div>}>
      <ThemeProvider defaultTheme='dark' storageKey='easy-dashboard-theme'>
        <Suspense fallback={<LogoLoading />}>
          <BrowserRouter>
            <Routes>
              <Route path='/' element={<Editor />} />
              <Route path='/preview' element={<Preview />} />
              <Route path='/test' element={<div>test</div>} />

              <Route path='*' element={<Navigate to='/' />} />
            </Routes>
          </BrowserRouter>
        </Suspense>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
