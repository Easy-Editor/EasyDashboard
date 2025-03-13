import { AppLayout } from '@/layouts'
import { SimulatorRenderer } from '@easy-editor/react-renderer-dashboard'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { ThemeProvider } from './components/theme-provider'
import { simulator } from './editor'
import { RendererContextMenu } from './layouts/ContextMenu'

function App() {
  return (
    <ErrorBoundary fallback={<div className='p-4 text-red-500'>严重错误！请刷新页面</div>}>
      <ThemeProvider defaultTheme='system' storageKey='easy-dashboard-theme'>
        <Suspense fallback={<div className='w-full h-screen flex items-center justify-center'>初始化编辑器中...</div>}>
          <AppLayout>
            <RendererContextMenu>
              <SimulatorRenderer host={simulator} />
            </RendererContextMenu>
          </AppLayout>
        </Suspense>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
