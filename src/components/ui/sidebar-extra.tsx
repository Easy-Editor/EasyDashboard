import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import React from 'react'
import { TooltipProvider } from './tooltip'

const SIDEBAR_COOKIE_NAME = 'sidebar_state'
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_MOBILE = '18rem'
const SIDEBAR_WIDTH_ICON = '3rem'
const SIDEBAR_KEYBOARD_SHORTCUT = 'b'

const SidebarMenuExtra = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar='menu-extra'
      className={cn('flex justify-end items-center gap-2', className)}
      {...props}
    />
  ),
)
SidebarMenuExtra.displayName = 'SidebarMenuExtra'

const SidebarMenuExtraItem = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-sidebar='menu-extra-item'
      className={cn(
        'flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground',
        'peer-hover/menu-extra-item:text-sidebar-accent-foreground peer-data-[active=true]/menu-extra-item:text-sidebar-accent-foreground',
        'group-data-[collapsible=icon]:hidden',
        '[&>svg]:size-4',
        className,
      )}
      {...props}
    />
  ),
)
SidebarMenuExtraItem.displayName = 'SidebarMenuExtraItem'

export { SidebarMenuExtra, SidebarMenuExtraItem }
