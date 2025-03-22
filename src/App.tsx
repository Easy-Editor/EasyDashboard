import { AppLayout } from '@/layouts'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ThemeProvider } from './components/theme-provider'
import Renderer from './layouts/Renderer'

function App() {
  return (
    <ErrorBoundary fallback={<div className='p-4 text-red-500'>严重错误！请刷新页面</div>}>
      <ThemeProvider defaultTheme='system' storageKey='easy-dashboard-theme'>
        <Suspense fallback={<div className='w-full h-screen flex items-center justify-center'>初始化编辑器中...</div>}>
          <AppLayout>
            <Renderer />
          </AppLayout>
        </Suspense>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
