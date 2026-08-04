import { useAuth } from '@/auth/useAuth'
import { BrandMark } from '@/components/brand/BrandMark'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getSettings } from '@/features/settings/settings-api'
import {
  type WorkspaceRailPreference,
  readCachedWorkspaceRailPreference,
} from '@/features/settings/workspace-rail-preference'
import { cn } from '@/lib/utils'
import { FolderKanban, Home, LogOut, PanelLeftClose, PanelLeftOpen, Pin, Plus, Settings, Trash2 } from 'lucide-react'
import {
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'

type NavItem = {
  label: string
  to: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

export type WorkspaceRailMode = 'docked' | 'hidden' | 'overlay'

const navigationItems: NavItem[] = [
  { label: '首页', to: '/', icon: Home, end: true },
  { label: '所有项目', to: '/projects', icon: FolderKanban },
  { label: '回收站', to: '/trash', icon: Trash2 },
]

const settingsItem: NavItem = { label: '设置', to: '/settings', icon: Settings }

export function getInitialWorkspaceRailMode(ownerUserId?: string | null): WorkspaceRailMode {
  return readCachedWorkspaceRailPreference(ownerUserId) === 'collapsed' ? 'hidden' : 'docked'
}

function NavigationItem({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'group/nav relative flex h-10 items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium text-[var(--ed-ink-muted)] outline-none transition-[background-color,color] duration-150',
          'hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ed-cyan)]',
          isActive && 'bg-[var(--ed-panel-raised)] text-[var(--ed-ink)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden='true'
            className={cn('absolute inset-y-2 left-0 w-px bg-transparent', isActive && 'bg-[var(--ed-cyan)]')}
          />
          <Icon
            className={cn(
              'size-[17px] shrink-0 transition-colors',
              isActive ? 'text-[var(--ed-cyan)]' : 'text-[#8091a0] group-hover/nav:text-[var(--ed-ink-soft)]',
            )}
          />
          <span className='truncate'>{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

type WorkspaceRailProps = {
  mode: WorkspaceRailMode
  onModeChange: (mode: WorkspaceRailMode) => void
  onPreferenceChange: (preference: WorkspaceRailPreference) => Promise<void>
}

export function WorkspaceRail({ mode, onModeChange, onPreferenceChange }: WorkspaceRailProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [displayName, setDisplayName] = useState('')
  const [preferenceSaving, setPreferenceSaving] = useState(false)
  const [preferenceError, setPreferenceError] = useState<string | null>(null)
  const previousLocationRef = useRef(`${location.pathname}${location.search}`)
  const expandButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const email = user?.email ?? '未设置邮箱'

  useEffect(() => {
    void getSettings()
      .then(settings => setDisplayName(settings.displayName?.trim() ?? ''))
      .catch(() => setDisplayName(''))
  }, [])

  useEffect(() => {
    function toggleWithKeyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        if (mode === 'hidden') openOverlay()
        else if (mode === 'overlay') hideOverlay()
        else void persistPreference('collapsed')
        return
      }
      if (event.key !== 'Escape' || mode !== 'overlay') return
      event.preventDefault()
      hideOverlay()
    }
    window.addEventListener('keydown', toggleWithKeyboard)
    return () => window.removeEventListener('keydown', toggleWithKeyboard)
  }, [mode])

  useEffect(() => {
    const currentLocation = `${location.pathname}${location.search}`
    if (previousLocationRef.current === currentLocation) return
    previousLocationRef.current = currentLocation
    if (mode === 'overlay') {
      onModeChange('hidden')
      focusOnNextFrame(expandButtonRef)
    }
  }, [location.pathname, location.search, mode, onModeChange])

  const resolvedDisplayName = displayName || user?.email?.split('@')[0] || 'Dashboard Maker'
  const initials = useMemo(() => resolvedDisplayName.trim().slice(0, 2).toLocaleUpperCase(), [resolvedDisplayName])

  function focusOnNextFrame(ref: RefObject<HTMLButtonElement | null>) {
    window.requestAnimationFrame(() => ref.current?.focus())
  }

  function openOverlay() {
    setPreferenceError(null)
    onModeChange('overlay')
    focusOnNextFrame(closeButtonRef)
  }

  function hideOverlay() {
    onModeChange('hidden')
    focusOnNextFrame(expandButtonRef)
  }

  async function persistPreference(preference: WorkspaceRailPreference) {
    if (preferenceSaving) return
    setPreferenceSaving(true)
    setPreferenceError(null)
    try {
      await onPreferenceChange(preference)
      if (preference === 'docked') focusOnNextFrame(closeButtonRef)
      else focusOnNextFrame(expandButtonRef)
    } catch {
      setPreferenceError('侧边栏偏好保存失败，已恢复原设置。')
    } finally {
      setPreferenceSaving(false)
    }
  }

  function keepOverlayFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (mode !== 'overlay' || event.key !== 'Tab') return
    const focusable = Array.from(
      railRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <>
      {mode === 'hidden' ? (
        <button
          type='button'
          ref={expandButtonRef}
          aria-controls='workspace-navigation-panel'
          aria-expanded={false}
          aria-label='展开工作区导航'
          title='展开导航（⌘/Ctrl B）'
          onClick={openOverlay}
          onMouseEnter={openOverlay}
          className='fixed left-4 top-4 z-30 grid size-9 place-items-center rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)] text-[var(--ed-ink-muted)] shadow-[0_6px_18px_rgba(0,0,0,.14)] hover:border-[var(--ed-line-strong)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ed-cyan)]'
        >
          <PanelLeftOpen className='size-[17px]' />
        </button>
      ) : null}

      {mode === 'overlay' ? (
        <div
          aria-hidden='true'
          className='fixed inset-y-0 left-[216px] right-0 z-40 cursor-default bg-black/20'
          onClick={hideOverlay}
        />
      ) : null}

      {preferenceError ? (
        <div
          role='alert'
          aria-live='assertive'
          className={cn(
            'fixed top-20 z-[60] max-w-[280px] rounded-[8px] border border-[var(--ed-error)]/35 bg-[var(--ed-rail)] px-3 py-2 text-[11px] leading-4 text-[var(--ed-error)] shadow-[0_10px_28px_rgba(0,0,0,.28)]',
            mode === 'docked' ? 'left-[228px]' : 'left-10',
          )}
        >
          {preferenceError}
        </div>
      ) : null}

      {mode === 'hidden' ? null : (
        <aside
          ref={railRef}
          id='workspace-navigation-panel'
          data-workspace-rail={mode}
          aria-label='工作区导航'
          role={mode === 'overlay' ? 'dialog' : undefined}
          aria-modal={mode === 'overlay' ? true : undefined}
          onKeyDown={keepOverlayFocus}
          className={cn(
            'fixed inset-y-0 left-0 flex w-[216px] flex-col border-r border-[var(--ed-line)] bg-[var(--ed-rail)]',
            mode === 'overlay' ? 'z-50 shadow-[12px_0_32px_rgba(0,0,0,0.18)]' : 'z-30',
          )}
        >
          <div className='flex h-16 shrink-0 items-center justify-between px-3'>
            <Link
              to='/'
              aria-label='返回首页'
              className='outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <BrandMark />
            </Link>
            <button
              type='button'
              ref={closeButtonRef}
              aria-controls='workspace-navigation-panel'
              aria-expanded={true}
              aria-label='收起工作区导航'
              title='收起导航（⌘/Ctrl B）'
              onClick={() => (mode === 'overlay' ? hideOverlay() : void persistPreference('collapsed'))}
              disabled={preferenceSaving}
              className='grid size-8 place-items-center rounded-[8px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <PanelLeftClose className='size-4' />
            </button>
          </div>

          <div className='px-3 pb-3'>
            <Link
              to='/projects?create=1'
              className='flex h-10 items-center gap-3 rounded-[8px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-3 text-[13px] font-medium text-[var(--ed-ink-soft)] outline-none transition-[background-color,border-color,color] duration-150 hover:border-[var(--ed-cyan)]/50 hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              <Plus className='size-4 shrink-0' />
              <span>新建项目</span>
            </Link>
          </div>

          {mode === 'overlay' ? (
            <div className='px-3 pb-3'>
              <button
                type='button'
                onClick={() => void persistPreference('docked')}
                disabled={preferenceSaving}
                className='flex h-9 w-full items-center gap-2.5 rounded-[8px] border border-[var(--ed-line-strong)] px-3 text-left text-[12px] font-medium text-[var(--ed-ink-soft)] transition-[background-color,border-color,color] hover:border-[var(--ed-cyan)]/45 hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] disabled:cursor-wait disabled:opacity-60'
              >
                <Pin className='size-3.5 text-[var(--ed-cyan)]' aria-hidden='true' />
                <span>{preferenceSaving ? '正在固定…' : '固定侧边栏'}</span>
              </button>
            </div>
          ) : null}

          <nav aria-label='主导航' className='space-y-1 px-3'>
            {navigationItems.map(item => (
              <NavigationItem key={item.to} item={item} />
            ))}
          </nav>

          <div className='mt-auto'>
            <nav aria-label='系统导航' className='px-3 pb-2'>
              <NavigationItem item={settingsItem} />
            </nav>
            <div className='border-t border-[var(--ed-line)] p-3'>
              <div className='flex items-center gap-2.5 rounded-[10px] px-1 py-1'>
                <Avatar className='size-8 shrink-0 rounded-[8px] border border-[var(--ed-line-strong)]'>
                  <AvatarFallback className='rounded-[7px] bg-[var(--ed-panel-raised)] text-[10px] text-[var(--ed-ink-soft)]'>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-xs font-medium text-[var(--ed-ink)]'>{resolvedDisplayName}</p>
                  <p className='mt-0.5 truncate text-[10px] text-[var(--ed-ink-muted)]'>{email}</p>
                </div>
                <button
                  type='button'
                  onClick={() => void handleSignOut()}
                  className='grid size-8 place-items-center rounded-[8px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
                  aria-label='退出登录'
                >
                  <LogOut className='size-3.5' />
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </>
  )
}
