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
import { Code, CodeXml, Component, ListTree, Pin, PinOff, Wand, X } from 'lucide-react'
import * as React from 'react'
import { useEffect } from 'react'
import { ComponentSidebar } from './Components'
import { MaterialsSidebar } from './Materials'
import { MethodStateSidebar } from './MethodState'
import { OutlineSidebar } from './Outline'
import { SchemaSidebar } from './Schema'

const data = {
  navTop: [
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
      key: 'materials',
      title: '素材',
      icon: Wand,
      component: <MaterialsSidebar />,
    },
  ],
  navBottom: [
    {
      key: 'schema',
      title: 'Schema',
      icon: CodeXml,
      component: <SchemaSidebar />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = React.useState(data.navTop[0])
  const { open, setOpen, fixed, toggleFixedSidebar } = useSidebar()

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
          '--sidebar-width': activeItem?.key === 'schema' ? '1000px' : '350px',
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible='none' className='!w-[calc(var(--sidebar-width-icon)_+_1px)] border-r'>
        <SidebarContent>
          <SidebarGroup className='h-full'>
            <SidebarGroupContent className='h-full px-1.5 md:px-0'>
              <SidebarMenu className='h-full flex flex-col justify-between'>
                <div>
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
                        className='px-2.5 md:px-2'
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </div>
                <div>
                  {data.navBottom.map(item => (
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
                        isActive={activeItem?.key === item.key}
                        className='px-2.5 md:px-2'
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </div>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>{/* <ThemeToggle /> */}</SidebarFooter>
      </Sidebar>

      <Sidebar collapsible='none' className='hidden flex-1 md:flex'>
        <SidebarHeader className='gap-3.5 border-b p-2'>
          <div className='flex w-full items-center justify-between'>
            <div className='text-base font-medium text-foreground'>{activeItem?.title}</div>
            <div className='flex items-center gap-2 text-sm'>
              {activeItem?.key !== 'schema' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant='ghost' size='icon' onClick={toggleFixedSidebar}>
                      {fixed ? <Pin /> : <PinOff />}
                      <span className='sr-only'>{fixed ? '取消固定' : '固定'}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{fixed ? '取消固定' : '固定'}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant='ghost' size='icon' onClick={() => setOpen(false)}>
                    <X />
                    <span className='sr-only'>关闭</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>关闭</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>{activeItem?.component}</SidebarContent>
      </Sidebar>
    </Sidebar>
  )
}
