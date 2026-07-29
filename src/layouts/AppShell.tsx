import type { ProjectSummary } from '@/api/contracts'
import { useAuth } from '@/auth/useAuth'
import { BrandMark } from '@/components/brand/BrandMark'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { listProjects } from '@/features/projects/project-api'
import { getSettings } from '@/features/settings/settings-api'
import { cn } from '@/lib/utils'
import { FolderKanban, LayoutTemplate, LogOut, Menu, Plus, Settings } from 'lucide-react'
import { type ComponentType, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'

type NavItem = {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
}

const workspaceItems: NavItem[] = [
  { label: '我的项目', to: '/projects', icon: FolderKanban },
  { label: '模板', to: '/templates', icon: LayoutTemplate },
]

const systemItems: NavItem[] = [{ label: '设置', to: '/settings', icon: Settings }]

function NavigationItem({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'relative flex min-h-11 items-center gap-3 rounded-[6px] px-3 text-sm text-[#87939D] transition-colors',
              'hover:bg-[#171D24] hover:text-[#F1F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67C6D9] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F1318]',
              'md:justify-center md:px-0 xl:justify-start xl:px-3',
              isActive &&
                'bg-[#171D24] text-[#F1F5F7] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-[#67C6D9]',
            )
          }
        >
          <Icon className='size-4.5 shrink-0' />
          <span className='md:hidden xl:inline'>{item.label}</span>
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side='right' className='hidden md:block xl:hidden'>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

function SidebarContent({
  mobile = false,
  onNavigate,
  projects,
  displayName,
  email,
  onSignOut,
}: {
  mobile?: boolean
  onNavigate?: () => void
  projects: ProjectSummary[]
  displayName: string
  email: string
  onSignOut: () => void
}) {
  const initials = useMemo(() => {
    const normalized = displayName.trim() || email
    return normalized.slice(0, 2).toLocaleUpperCase()
  }, [displayName, email])

  return (
    <div className='flex h-full flex-col bg-[#0F1318]'>
      <div
        className={cn('flex h-16 items-center px-4', !mobile && 'md:justify-center md:px-0 xl:justify-start xl:px-4')}
      >
        {mobile ? (
          <BrandMark />
        ) : (
          <>
            <BrandMark compact />
            <span className='ml-2.5 hidden font-[Alibaba_PuHuiTi] text-[15px] font-semibold tracking-[0.01em] text-[#F1F5F7] xl:inline'>
              EasyDashboard
            </span>
          </>
        )}
      </div>
      <div className='px-3 md:px-2 xl:px-3'>
        <Button asChild className='h-9 w-full rounded-[6px] bg-[#F1F5F7] text-[#080A0D] hover:bg-white md:px-0 xl:px-4'>
          <Link to='/projects?create=1' onClick={onNavigate}>
            <Plus />
            <span className='md:hidden xl:inline'>新建项目</span>
          </Link>
        </Button>
      </div>
      <Separator className='my-4 bg-[#222B34]' />
      <nav aria-label='工作区导航' className='space-y-1 px-3 md:px-2 xl:px-3'>
        {workspaceItems.map(item => (
          <NavigationItem key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className={cn('mt-6 px-4', !mobile && 'hidden xl:block')}>
        <p className='mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#586570]'>最近项目</p>
        <div className='space-y-0.5'>
          {projects.slice(0, 3).map(project => (
            <Link
              key={project.id}
              to={`/projects/${project.id}/editor`}
              onClick={onNavigate}
              className='flex min-h-9 items-center gap-2 rounded-[6px] px-2 text-xs text-[#87939D] hover:bg-[#171D24] hover:text-[#F1F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67C6D9]'
            >
              <span className='size-1.5 shrink-0 border border-[#65717D]' />
              <span className='truncate'>{project.name}</span>
            </Link>
          ))}
        </div>
      </div>
      <div className='mt-auto'>
        <Separator className='bg-[#222B34]' />
        <nav aria-label='系统导航' className='space-y-1 p-3 md:p-2 xl:p-3'>
          {systemItems.map(item => (
            <NavigationItem key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </nav>
        <div
          className={cn(
            'flex items-center gap-3 border-t border-[#222B34] p-3',
            !mobile && 'md:justify-center xl:justify-start',
          )}
        >
          <Avatar className='size-8 border border-[#2A333D]'>
            <AvatarFallback className='bg-[#171D24] font-mono text-[10px] text-[#B7C3CB]'>{initials}</AvatarFallback>
          </Avatar>
          <div className={cn('min-w-0', !mobile && 'md:hidden xl:block')}>
            <p className='truncate text-xs font-medium text-[#F1F5F7]'>{displayName}</p>
            <p className='truncate text-[10px] text-[#65717D]'>{email}</p>
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={onSignOut}
            className={cn(
              'ml-auto min-h-11 min-w-11 text-[#71808B] hover:bg-[#171D24] hover:text-white',
              !mobile && 'md:hidden xl:inline-flex',
            )}
            aria-label='退出登录'
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([])
  const [displayName, setDisplayName] = useState('')
  const email = user?.email ?? '未设置邮箱'

  useEffect(() => {
    void listProjects()
      .then(response => setRecentProjects(response.projects))
      .catch(() => setRecentProjects([]))
    void getSettings()
      .then(settings => setDisplayName(settings.displayName?.trim() ?? ''))
      .catch(() => setDisplayName(''))
  }, [])

  const resolvedDisplayName = displayName || user?.email?.split('@')[0] || 'Dashboard Maker'

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className='min-h-screen bg-[#080A0D] text-[#F1F5F7]'>
      <aside className='fixed inset-y-0 left-0 z-30 hidden w-14 border-r border-[#222B34] md:block xl:w-[232px]'>
        <SidebarContent
          projects={recentProjects}
          displayName={resolvedDisplayName}
          email={email}
          onSignOut={() => void handleSignOut()}
        />
      </aside>
      <header className='sticky top-0 z-20 flex h-14 items-center justify-between border-b border-[#222B34] bg-[#0F1318]/95 px-4 backdrop-blur md:hidden'>
        <BrandMark />
        <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
          <SheetTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='min-h-11 min-w-11 text-[#A5B0B9] hover:bg-[#171D24] hover:text-white'
              aria-label='打开导航'
            >
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side='left' className='w-[280px] border-[#2A333D] bg-[#0F1318] p-0'>
            <SheetTitle className='sr-only'>应用导航</SheetTitle>
            <SidebarContent
              mobile
              projects={recentProjects}
              displayName={resolvedDisplayName}
              email={email}
              onSignOut={() => void handleSignOut()}
              onNavigate={() => setMobileNavigationOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </header>
      <main className='min-h-screen md:ml-14 xl:ml-[232px]'>
        <Outlet />
      </main>
    </div>
  )
}
