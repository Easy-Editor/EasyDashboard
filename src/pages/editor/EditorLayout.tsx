import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { EditorModeProvider, useEditorMode } from '@/contexts/editor-mode-context'
import { useEffect, useRef, useState } from 'react'
import { EditorAgentDock } from './AgentDock'
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
            height: 'calc(100vh - var(--ed-header-height))',
            top: 'var(--ed-header-height)',
          } as React.CSSProperties
        }
      />
      <SidebarInset>
        <div className='relative flex min-w-0 flex-1 flex-col gap-0 overflow-hidden'>
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
              height: 'calc(100vh - var(--ed-header-height))',
              top: 'var(--ed-header-height)',
              width: 'var(--ed-inspector-width)',
            } as React.CSSProperties
          }
        />
      )}
    </>
  )
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const [agentOpen, setAgentOpen] = useState(false)

  return (
    <EditorModeProvider>
      <div
        data-ed-shell='editor'
        data-editor-workbench
        className='relative flex h-full flex-col bg-[var(--ed-canvas)] text-[var(--ed-ink)]'
      >
        <div className='h-full border-grid flex flex-1 flex-col'>
          <AppHeader className='flex h-12' agentOpen={agentOpen} onAgentToggle={() => setAgentOpen(open => !open)} />
          <main className='flex flex-1 flex-col'>
            <SidebarProvider
              defaultOpen
              defaultFixed={false}
              style={
                {
                  '--sidebar-width': 'calc(var(--ed-tool-rail-width) + var(--ed-left-panel-width))',
                  '--sidebar-width-icon': 'var(--ed-tool-rail-width)',
                  '--header-height': 'var(--ed-header-height)',
                } as React.CSSProperties
              }
            >
              <EditorContent>{children}</EditorContent>
            </SidebarProvider>
          </main>
          <Toaster position='top-center' />
          <EditorAgentDock open={agentOpen} onOpenChange={setAgentOpen} />
        </div>
      </div>
    </EditorModeProvider>
  )
}

export default AppLayout
