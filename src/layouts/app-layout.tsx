import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='relative flex flex-col bg-background'>
      <div className='border-grid flex flex-1 flex-col'>
        <AppHeader />
        <main className='flex flex-1 flex-col'>
          <SidebarProvider
            style={
              {
                '--sidebar-width': '350px',
              } as React.CSSProperties
            }
          >
            <AppSidebar
              style={
                {
                  '--header-height': '57px',
                  top: '57px',
                } as React.CSSProperties
              }
            />
            <SidebarInset>
              <div className='flex flex-1 flex-col gap-4 p-4'>{children}</div>
            </SidebarInset>
          </SidebarProvider>
        </main>
      </div>
    </div>
  )
}
