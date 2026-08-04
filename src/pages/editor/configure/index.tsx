import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar'
import { setterManager } from '@/editor/remote'
import { customFieldItem } from '@/editor/setters'
import { project } from '@easy-editor/core'
import { SettingRenderer } from '@easy-editor/react-renderer'
import { EyeOff, Lock, SlidersHorizontal } from 'lucide-react'
import { observer } from 'mobx-react'
import { useEffect } from 'react'
import { ConfigureSkeleton } from './ConfigureSkeleton'
import { resolveClampedFloatingPosition } from './popover-position'

function useConfigurePopoverViewportClamp() {
  useEffect(() => {
    let animationFrame: number | null = null
    let delayedClamp: number | null = null

    const clampPopovers = () => {
      const panel = document.querySelector<HTMLElement>('[data-editor-configure]')
      if (!panel) return

      const panelRect = panel.getBoundingClientRect()
      if (panelRect.width === 0) return

      document.querySelectorAll<HTMLElement>('.es-popover-portal').forEach(portal => {
        portal.dataset.edShell = 'editor'
        const portalRect = portal.getBoundingClientRect()
        if (portalRect.left < panelRect.left - 1 || portalRect.left > panelRect.right + 1) return

        const floatingRects = [portal, ...portal.querySelectorAll<HTMLElement>('*')]
          .map(element => element.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0)
        if (floatingRects.length === 0) return

        const floatingLeft = Math.min(...floatingRects.map(rect => rect.left))
        const floatingTop = Math.min(...floatingRects.map(rect => rect.top))
        const floatingRight = Math.max(...floatingRects.map(rect => rect.right))
        const floatingBottom = Math.max(...floatingRects.map(rect => rect.bottom))
        const nextPosition = resolveClampedFloatingPosition(
          {
            left: floatingLeft,
            top: floatingTop,
            width: floatingRight - floatingLeft,
            height: floatingBottom - floatingTop,
          },
          {
            width: window.innerWidth,
            height: window.innerHeight,
          },
        )

        const leftDelta = nextPosition.left - floatingLeft
        const topDelta = nextPosition.top - floatingTop

        if (Math.abs(leftDelta) > 0.5) {
          portal.style.left = `${portalRect.left + leftDelta}px`
        }
        if (Math.abs(topDelta) > 0.5) {
          portal.style.top = `${portalRect.top + topDelta}px`
        }
      })
    }

    const scheduleClamp = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      if (delayedClamp !== null) window.clearTimeout(delayedClamp)

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = null
          clampPopovers()
        })
      })
      delayedClamp = window.setTimeout(() => {
        delayedClamp = null
        clampPopovers()
      }, 80)
    }

    const observer = new MutationObserver(scheduleClamp)
    observer.observe(document.body, { childList: true })
    window.addEventListener('resize', scheduleClamp)
    scheduleClamp()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleClamp)
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      if (delayedClamp !== null) window.clearTimeout(delayedClamp)
    }
  }, [])
}

export const ConfigureSidebar = observer(({ ...props }: React.ComponentProps<typeof Sidebar>) => {
  useConfigurePopoverViewportClamp()

  const isLoading = setterManager.isLoading
  const settings = project.designer.settingsManager.settings
  const isLocked = settings?.isLocked ?? false
  const isHidden = settings?.isHidden ?? false

  return (
    <Sidebar
      collapsible='none'
      data-editor-configure
      className='sticky top-0 hidden h-svh border-l border-[var(--ed-line)] bg-[var(--ed-panel)] text-[var(--ed-ink)] lg:flex'
      {...props}
    >
      <SidebarHeader className='flex h-[var(--ed-panel-header-height)] shrink-0 items-center border-b border-[var(--ed-line)] bg-[var(--ed-panel)] px-3 py-0'>
        <div className='flex w-full items-center justify-between'>
          <div className='flex min-w-0 items-center gap-2'>
            <SlidersHorizontal className='size-3.5 shrink-0 text-[var(--ed-ink-muted)]' aria-hidden='true' />
            <span className='truncate text-[12px] font-medium tracking-wide text-[var(--ed-ink-soft)]'>属性配置</span>
          </div>
          {(isLocked || isHidden) && (
            <div className='flex items-center gap-1.5'>
              {isLocked && (
                <div className='flex h-6 items-center gap-1 border border-[color-mix(in_srgb,var(--ed-warning)_38%,transparent)] bg-[color-mix(in_srgb,var(--ed-warning)_10%,var(--ed-panel))] px-1.5 text-[10px] text-[var(--ed-warning)]'>
                  <Lock className='size-3' />
                  <span>已锁定</span>
                </div>
              )}
              {isHidden && (
                <div className='flex h-6 items-center gap-1 border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] px-1.5 text-[10px] text-[var(--ed-ink-muted)]'>
                  <EyeOff className='size-3' />
                  <span>已隐藏</span>
                </div>
              )}
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className='min-w-0 bg-[var(--ed-panel)] p-3 text-[var(--ed-ink)] [&>*]:max-w-full'>
        {isLoading ? (
          <ConfigureSkeleton />
        ) : (
          <SettingRenderer designer={project.designer} customFieldItem={customFieldItem} />
        )}
      </SidebarContent>
    </Sidebar>
  )
})
