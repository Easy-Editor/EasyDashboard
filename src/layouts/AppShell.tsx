import { useAuth } from '@/auth/useAuth'
import { BrandMark } from '@/components/brand/BrandMark'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getSettings } from '@/features/settings/settings-api'
import { cn } from '@/lib/utils'
import { FolderKanban, Home, LogOut, Plus, Settings, Trash2 } from 'lucide-react'
import { type ComponentType, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'

type NavItem = {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

const navigationItems: NavItem[] = [
  { label: '首页', to: '/', icon: Home, end: true },
  { label: '所有项目', to: '/projects', icon: FolderKanban },
  { label: '回收站', to: '/trash', icon: Trash2 },
]

const settingsItem: NavItem = { label: '设置', to: '/settings', icon: Settings }

function NavigationItem({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              'group/nav relative flex h-10 items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium text-[var(--ed-ink-muted)] outline-none transition-colors',
              'hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]',
              isActive &&
                'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--ed-blue)_16%,transparent),transparent_88%)] text-[var(--ed-ink)]',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'absolute inset-y-2 left-0 w-0.5 rounded-full bg-transparent',
                  isActive && 'bg-[var(--ed-cyan)] shadow-[0_0_10px_color-mix(in_srgb,var(--ed-cyan)_60%,transparent)]',
                )}
              />
              <Icon
                className={cn(
                  'size-[17px] shrink-0 transition-colors',
                  isActive ? 'text-[var(--ed-cyan)]' : 'text-[#738497] group-hover/nav:text-[#aebdca]',
                )}
              />
              <span>{item.label}</span>
            </>
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side='right' className='xl:hidden'>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

export function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = useState('')
  const email = user?.email ?? '未设置邮箱'

  useEffect(() => {
    void getSettings()
      .then(settings => setDisplayName(settings.displayName?.trim() ?? ''))
      .catch(() => setDisplayName(''))
  }, [])

  const resolvedDisplayName = displayName || user?.email?.split('@')[0] || 'Dashboard Maker'
  const initials = useMemo(() => resolvedDisplayName.trim().slice(0, 2).toLocaleUpperCase(), [resolvedDisplayName])

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div data-ed-shell='app' className='min-h-screen min-w-[1024px] bg-[var(--ed-canvas)] text-[var(--ed-ink)]'>
      <aside className='fixed inset-y-0 left-0 z-30 flex w-[216px] flex-col border-r border-[var(--ed-line)] bg-[var(--ed-rail)]'>
        <div className='flex h-[72px] items-center px-5'>
          <BrandMark />
        </div>

        <div className='px-3'>
          <Button
            asChild
            className='h-10 w-full rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] text-[#07111d] shadow-[0_8px_24px_rgba(0,0,0,0.18)] hover:bg-white'
          >
            <Link to='/projects?create=1'>
              <Plus className='size-4' />
              新建项目
            </Link>
          </Button>
        </div>

        <div className='mx-4 my-5 h-px bg-[var(--ed-line)]' />

        <nav aria-label='主导航' className='space-y-1 px-3'>
          {navigationItems.map(item => (
            <NavigationItem key={item.to} item={item} />
          ))}
        </nav>

        <div className='mt-auto'>
          <nav aria-label='系统导航' className='px-3 pb-3'>
            <NavigationItem item={settingsItem} />
          </nav>
          <div className='border-t border-[var(--ed-line)] p-3'>
            <div className='flex items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-2 hover:border-[var(--ed-line)] hover:bg-[var(--ed-panel)]'>
              <Avatar className='size-8 rounded-[8px] border border-[var(--ed-line-strong)]'>
                <AvatarFallback className='rounded-[7px] bg-[var(--ed-panel-raised)] font-mono text-[10px] text-[var(--ed-ink-soft)]'>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-xs font-medium text-[var(--ed-ink)]'>{resolvedDisplayName}</p>
                <p className='mt-0.5 truncate text-[10px] text-[var(--ed-ink-faint)]'>{email}</p>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                onClick={() => void handleSignOut()}
                className='size-8 rounded-[6px] text-[var(--ed-ink-faint)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
                aria-label='退出登录'
              >
                <LogOut className='size-3.5' />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <main className='min-h-screen pl-[216px]'>
        <Outlet />
      </main>
    </div>
  )
}
