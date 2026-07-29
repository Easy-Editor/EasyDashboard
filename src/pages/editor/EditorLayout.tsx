import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { EditorModeProvider, useEditorMode } from '@/contexts/editor-mode-context'
import { useEffect } from 'react'
import { CodeView } from './canvas/CodeView'
import { ConfigureSidebar } from './configure'
import { AppHeader } from './header'
import { AppSidebar } from './sidebar'

function EditorContent({ children }: { children: React.ReactNode }) {
  const { mode } = useEditorMode()
  const { setOpen } = useSidebar()

  // 根据模式控制左侧侧边栏
  useEffect(() => {
    if (mode === 'preview' || mode === 'code') {
      setOpen(false)
    } else if (mode === 'canvas') {
      setOpen(true)
    }
  }, [mode, setOpen])

  // Canvas 和 Preview 模式显示配置面板
  const showConfigureSidebar = mode === 'canvas'

  return (
    <>
      <AppSidebar
        style={
          {
            height: 'calc(100vh - 57px)',
            top: '57px',
          } as React.CSSProperties
        }
      />
      <SidebarInset>
        <div className='relative flex flex-1 flex-col gap-4 overflow-hidden min-w-0'>
          {children}
          {/* Code 模式：悬浮在画布上方 */}
          {mode === 'code' && (
            <div className='absolute inset-0 z-10 bg-background'>
              <CodeView />
            </div>
          )}
        </div>
      </SidebarInset>
      {showConfigureSidebar && (
        <ConfigureSidebar
          style={
            {
              height: 'calc(100vh - 57px)',
              top: '57px',
            } as React.CSSProperties
          }
        />
      )}
    </>
  )
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <EditorModeProvider>
      <div className='h-full relative flex flex-col bg-background'>
        <div className='h-full border-grid flex flex-1 flex-col'>
          <AppHeader className='flex h-[57px]' />
          <main className='flex flex-1 flex-col'>
            <SidebarProvider
              defaultOpen={false}
              defaultFixed={false}
              style={
                {
                  '--sidebar-width': '350px',
                  '--header-height': '57px',
                } as React.CSSProperties
              }
            >
              <EditorContent>{children}</EditorContent>
            </SidebarProvider>
          </main>
          <Toaster position='top-center' />
        </div>
      </div>
    </EditorModeProvider>
  )
}

export default AppLayout
