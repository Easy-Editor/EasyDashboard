import { Component, ListTree, X } from 'lucide-react'
import * as React from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Label } from '@radix-ui/react-label'
import { ComponentSidebar } from './sidebar-component'
import { OutlineSidebar } from './sidebar-outline'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const data = {
  navMain: [
    {
      key: 'outline',
      title: '大纲',
      icon: ListTree,
      component: <OutlineSidebar />,
    },
    {
      key: 'components',
      title: '组件',
      icon: Component,
      component: <ComponentSidebar />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = React.useState(data.navMain[0])
  const { open, setOpen } = useSidebar()

  return (
    <Sidebar
      collapsible='icon'
      className='overflow-hidden [&>[data-sidebar=sidebar]]:flex-row h-[calc(100vh_-_var(--header-height))]'
      {...props}
    >
      <Sidebar collapsible='none' className='!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r'>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className='px-1.5 md:px-0'>
              <SidebarMenu>
                {data.navMain.map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={{
                        children: item.title,
                        hidden: false,
                      }}
                      onClick={() => {
                        setActiveItem(item)
                        setOpen(item.key === activeItem.key ? !open : true)
                      }}
                      isActive={activeItem.key === item.key}
                      className='px-2.5 md:px-2'
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter></SidebarFooter>
      </Sidebar>

      <Sidebar collapsible='none' className='hidden flex-1 md:flex'>
        <SidebarHeader className='gap-3.5 border-b p-2'>
          <div className='flex w-full items-center justify-between'>
            <div className='text-base font-medium text-foreground'>{activeItem.title}</div>
            <Label className='flex items-center gap-2 text-sm'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant='ghost' size='icon' onClick={() => setOpen(false)}>
                    <X className='h-4 w-4' />
                    <span className='sr-only'>关闭</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>关闭</TooltipContent>
              </Tooltip>
            </Label>
          </div>
        </SidebarHeader>
        <SidebarContent>{activeItem.component}</SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}
