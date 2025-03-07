import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { SidebarMenuExtra, SidebarMenuExtraItem } from '@/components/ui/sidebar-extra'
import { project } from '@/editor'
import { cn } from '@/lib/utils'
import type { Node, NodeSchema } from '@easy-editor/core'
import { ChevronRight, Container, Eye, EyeOff, LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { observer } from 'mobx-react'
import { type Key, useState } from 'react'

export const OutlineSidebar = observer(() => {
  const currentDocumentRootNode = project.currentDocument?.rootNode

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Collapsible className='group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90'>
          <SidebarMenuButton className='cursor-pointer'>
            <CollapsibleTrigger asChild>
              <ChevronRight className='transition-transform' />
            </CollapsibleTrigger>
            <Container />
            {currentDocumentRootNode?.componentName}
          </SidebarMenuButton>
          <CollapsibleContent>
            <SidebarMenuSub>
              {currentDocumentRootNode?.childrenNodes.map(
                (childrenNode: Node<NodeSchema>, index: Key | null | undefined) => (
                  <OutlineTree key={index} childrenNode={childrenNode} />
                ),
              )}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const OutlineTree = observer(({ childrenNode }: { childrenNode: Node<NodeSchema> }) => {
  const [isShowExtra, setIsShowExtra] = useState(false)

  const handleHide = (e: React.MouseEvent) => {
    e.stopPropagation()
    childrenNode.hide(!childrenNode.isHidden)
  }

  const handleLock = (e: React.MouseEvent) => {
    e.stopPropagation()
    childrenNode.lock(!childrenNode.isLocked)
  }

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (childrenNode.canSelect()) {
      childrenNode.select()
    }
  }

  if (!childrenNode.childrenNodes?.length) {
    return (
      <div
        onClick={handleSelect}
        onMouseEnter={() => setIsShowExtra(true)}
        onMouseLeave={() => setIsShowExtra(false)}
        className='flex w-full items-center rounded-md p-2 text-left text-sm justify-between hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer'
      >
        {childrenNode.componentName}
        <SidebarMenuExtra>
          <SidebarMenuExtraItem
            className={cn('invisible', (isShowExtra || childrenNode?.hidden) && 'visible')}
            onClick={handleHide}
          >
            {childrenNode?.hidden ? <EyeOff /> : <Eye />}
          </SidebarMenuExtraItem>
          <SidebarMenuExtraItem
            className={cn('invisible', (isShowExtra || childrenNode?.locked) && 'visible')}
            onClick={handleLock}
          >
            {childrenNode?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
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
            {childrenNode.componentName}
          </div>
          <SidebarMenuExtra>
            <SidebarMenuExtraItem
              className={cn('invisible', (isShowExtra || childrenNode?.hidden) && 'visible')}
              onClick={handleHide}
            >
              {childrenNode?.hidden ? <EyeOff /> : <Eye />}
            </SidebarMenuExtraItem>
            <SidebarMenuExtraItem
              className={cn('invisible', (isShowExtra || childrenNode?.locked) && 'visible')}
              onClick={handleLock}
            >
              {childrenNode?.locked ? <LockKeyhole /> : <LockKeyholeOpen />}
            </SidebarMenuExtraItem>
          </SidebarMenuExtra>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className='mr-0 pr-0'>
            {childrenNode.childrenNodes?.map((childrenNode: Node<NodeSchema>, index: Key | null | undefined) => (
              <OutlineTree key={index} childrenNode={childrenNode} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
})
