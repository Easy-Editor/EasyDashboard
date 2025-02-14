import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { project } from '@/editor'
import { cn } from '@/lib/utils'
import type { NodeSchema } from '@easy-editor/core'
import { ChevronRight, Container, Eye, EyeOff, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { observer } from 'mobx-react'
import { type Key, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { SidebarMenuExtra, SidebarMenuExtraItem } from './ui/sidebar-extra'

export const OutlineSidebar = observer(() => {
  const docSchema = project.currentDocument?.export()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Collapsible className='group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90'>
          <SidebarMenuButton className='cursor-pointer'>
            <CollapsibleTrigger asChild>
              <ChevronRight className='transition-transform' />
            </CollapsibleTrigger>
            <Container />
            {docSchema?.componentName}
          </SidebarMenuButton>
          <CollapsibleContent>
            <SidebarMenuSub>
              {docSchema?.children?.map((subItem: NodeSchema, index: Key | null | undefined) => (
                <OutlineTree key={index} item={subItem} />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const OutlineTree = observer(({ item }: { item: NodeSchema }) => {
  const node = project.currentDocument?.getNode(item.id!)
  const [isShowExtra, setIsShowExtra] = useState(false)

  const handleHide = (e: React.MouseEvent) => {
    e.stopPropagation()
    node?.hide(!node?.isHidden)
  }

  const handleLock = (e: React.MouseEvent) => {
    e.stopPropagation()
    node?.lock(!node?.isLocked)
  }

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node?.canSelect) {
      node?.select()
    }
  }

  if (!item.children?.length) {
    return (
      <div
        onClick={handleSelect}
        onMouseEnter={() => setIsShowExtra(true)}
        onMouseLeave={() => setIsShowExtra(false)}
        className='flex w-full items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer'
      >
        {item.componentName}
        <SidebarMenuExtra className={cn('invisible', isShowExtra && 'visible')}>
          <SidebarMenuExtraItem onClick={handleHide}>{node?.hidden ? <EyeOff /> : <Eye />}</SidebarMenuExtraItem>
          <SidebarMenuExtraItem onClick={handleLock}>
            {node?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
          </SidebarMenuExtraItem>
        </SidebarMenuExtra>
      </div>
    )
  }

  return (
    <SidebarMenuItem>
      <Collapsible className='group/collapsible [&[data-state=open]>div>div>svg:first-child]:rotate-90'>
        <div
          onClick={handleSelect}
          onMouseEnter={() => setIsShowExtra(true)}
          onMouseLeave={() => setIsShowExtra(false)}
          className='flex w-full items-center justify-between rounded-md p-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer'
        >
          <div className='flex items-center gap-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground'>
            <CollapsibleTrigger asChild>
              <ChevronRight className='transition-transform' />
            </CollapsibleTrigger>
            {item.componentName}
          </div>
          <SidebarMenuExtra className={cn('invisible', isShowExtra && 'visible')}>
            <SidebarMenuExtraItem onClick={handleHide}>{node?.hidden ? <EyeOff /> : <Eye />}</SidebarMenuExtraItem>
            <SidebarMenuExtraItem onClick={handleLock}>
              {node?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
            </SidebarMenuExtraItem>
          </SidebarMenuExtra>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className='mr-0 pr-0'>
            {item.children?.map((subItem, index) => (
              <OutlineTree key={index} item={subItem} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
})
