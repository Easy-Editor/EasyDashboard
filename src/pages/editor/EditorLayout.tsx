import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { EditorModeProvider, useEditorMode } from '@/contexts/editor-mode-context'
import { useEffect, useRef } from 'react'
import { CodeView } from './canvas/CodeView'
import { ConfigureSidebar } from './configure'
import { getSidebarOpenForModeTransition } from './editor-sidebar-mode'
import { AppHeader } from './header'
import { AppSidebar } from './sidebar'

function EditorContent({ children }: { children: React.ReactNode }) {
  const { mode } = useEditorMode()
  const { setOpen } = useSidebar()
  const previousMode = useRef<typeof mode | undefined>(undefined)

  // 根据模式控制左侧侧边栏
  useEffect(() => {
    const nextOpen = getSidebarOpenForModeTransition(previousMode.current, mode)
    if (nextOpen !== undefined) {
      setOpen(nextOpen)
    }
    previousMode.current = mode
  }, [mode, setOpen])

  // Canvas 和 Preview 模式显示配置面板
  const showConfigureSidebar = mode === 'canvas'

  return (
    <>
      <AppSidebar
        style={
          {
            height: 'calc(100vh - 48px)',
            top: '48px',
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
              height: 'calc(100vh - 48px)',
              top: '48px',
              width: '304px',
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
      <div
        data-ed-shell='editor'
        data-editor-workbench
        className='relative flex h-full flex-col bg-[var(--ed-canvas)] text-[var(--ed-ink)]'
      >
        <div className='h-full border-grid flex flex-1 flex-col'>
          <AppHeader className='flex h-12' />
          <main className='flex flex-1 flex-col'>
            <SidebarProvider
              defaultOpen
              defaultFixed={false}
              style={
                {
                  '--sidebar-width': '308px',
                  '--sidebar-width-icon': '44px',
                  '--header-height': '48px',
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
