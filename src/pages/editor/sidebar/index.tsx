import { Button } from '@/components/ui/button'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Code, Component, Database, File, ListTree, Wand, X } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useState } from 'react'
import { MaterialsSidebar } from './Materials'
import { OutlineSidebar } from './Outline'
import { ComponentSidebar } from './components'
import { DataSourceSidebar } from './data-source'
import { MethodStateSidebar } from './method-state'
import { PageSidebar } from './page'

const data = {
  navTop: [
    {
      key: 'page',
      title: '页面',
      icon: File,
      component: <PageSidebar />,
    },
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
    {
      key: 'method-state',
      title: '方法状态',
      icon: Code,
      component: <MethodStateSidebar />,
    },
    {
      key: 'data-source',
      title: '数据源',
      icon: Database,
      component: <DataSourceSidebar />,
    },
    {
      key: 'materials',
      title: '素材',
      icon: Wand,
      component: <MaterialsSidebar />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = useState(data.navTop[2])
  const { open, setOpen } = useSidebar()

  useEffect(() => {
    setOpen(true)
  }, [])

  return (
    <Sidebar
      collapsible='icon'
      variant='sidebar'
      className='overflow-hidden [&>[data-sidebar=sidebar]]:flex-row'
      {...props}
      style={
        {
          ...props.style,
          '--sidebar-width': '350px',
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible='none' className='!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r'>
        <SidebarContent>
          <SidebarGroup className='h-full'>
            <SidebarGroupContent className='h-full px-1.5 md:px-0'>
              <SidebarMenu>
                {data.navTop.map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={{
                        children: item.title,
                        hidden: false,
                      }}
                      onClick={() => {
                        setActiveItem(item)
                        setOpen(item.key === activeItem?.key ? !open : true)
                      }}
                      isActive={activeItem?.key === item.key}
                      data-active={activeItem?.key === item.key}
                      className='px-2.5 md:px-2 transition-all duration-200 [transition-timing-function:var(--ease-out)] hover:scale-105 active:scale-95'
                    >
                      <item.icon className='transition-all duration-200 [transition-timing-function:var(--ease-out)] group-hover:scale-110' />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>{/* <ThemeToggle /> */}</SidebarFooter>
      </Sidebar>

      <Sidebar collapsible='none' className='hidden flex-1 md:flex'>
        <SidebarHeader className='h-12 px-4 border-b border-border/60 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <div className='w-1 h-4 bg-foreground rounded-full' />
            <h2 className='text-sm font-semibold'>{activeItem?.title}</h2>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => setOpen(false)}
                className='h-7 w-7 transition-all duration-200 [transition-timing-function:var(--ease-out)]'
              >
                <X className='w-4 h-4' />
                <span className='sr-only'>关闭</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>关闭</TooltipContent>
          </Tooltip>
        </SidebarHeader>
        <SidebarContent>{activeItem?.component}</SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}
