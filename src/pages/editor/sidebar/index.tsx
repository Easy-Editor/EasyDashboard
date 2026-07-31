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
import { Code, Component, Database, File, History, Image, ListTree, Palette, Wand, X } from 'lucide-react'
import type * as React from 'react'
import { useState } from 'react'
import { MaterialsSidebar } from './Materials'
import { OutlineSidebar } from './Outline'
import { ComponentSidebar } from './components'
import { DataSourceSidebar } from './data-source'
import { MethodStateSidebar } from './method-state'
import { PageSidebar } from './page'
import { ThemeSidebar } from './theme'
import { ThumbnailSidebar } from './thumbnail'
import { VersionsSidebar } from './versions'

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
    {
      key: 'theme',
      title: '外观',
      icon: Palette,
      component: <ThemeSidebar />,
    },
    {
      key: 'thumbnail',
      title: '封面',
      icon: Image,
      component: <ThumbnailSidebar />,
    },
    {
      key: 'versions',
      title: '版本记录',
      icon: History,
      component: <VersionsSidebar />,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = useState(data.navTop[0])
  const { open, setOpen } = useSidebar()

  return (
    <Sidebar
      collapsible='icon'
      variant='sidebar'
      className='overflow-hidden [&>[data-sidebar=sidebar]]:flex-row'
      {...props}
      style={
        {
          ...props.style,
          '--sidebar-width': 'calc(var(--ed-tool-rail-width) + var(--ed-left-panel-width))',
          '--sidebar-width-icon': 'var(--ed-tool-rail-width)',
        } as React.CSSProperties
      }
    >
      <Sidebar
        collapsible='none'
        data-editor-tool-rail
        className='shrink-0 border-r border-[var(--ed-line)] bg-[var(--ed-rail)]'
        style={{ width: 'var(--ed-tool-rail-width)' }}
      >
        <SidebarContent>
          <SidebarGroup className='h-full px-1 py-2'>
            <SidebarGroupContent className='h-full'>
              <SidebarMenu className='gap-1.5'>
                {data.navTop.map(item => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      id={`editor-tool-${item.key}`}
                      aria-label={item.title}
                      aria-controls='editor-tool-panel'
                      aria-expanded={activeItem?.key === item.key && open}
                      aria-pressed={activeItem?.key === item.key}
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
                      className='mx-auto size-9 justify-center rounded-md p-0 text-[var(--ed-ink-faint)] transition-colors hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink-soft)] data-[active=true]:bg-[var(--ed-panel-raised)] data-[active=true]:text-[var(--ed-cyan)]'
                    >
                      <item.icon className='size-4' />
                      <span className='sr-only'>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>{/* <ThemeToggle /> */}</SidebarFooter>
      </Sidebar>

      {open ? (
        <Sidebar
          collapsible='none'
          id='editor-tool-panel'
          aria-labelledby={`editor-tool-${activeItem.key}`}
          className='hidden shrink-0 border-r border-[var(--ed-line)] bg-[var(--ed-panel)] md:flex'
          style={{ width: 'var(--ed-left-panel-width)' }}
        >
          <SidebarHeader className='flex h-[var(--ed-panel-header-height)] shrink-0 items-center justify-between border-b border-[var(--ed-line)] px-3'>
            <div className='flex items-center gap-2'>
              <div className='h-3.5 w-0.5 rounded-full bg-[var(--ed-cyan)]' />
              <h2 className='text-[12px] font-medium tracking-wide text-[var(--ed-ink-soft)]'>{activeItem?.title}</h2>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => setOpen(false)}
                  className='size-7 text-[var(--ed-ink-faint)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
                >
                  <X className='w-4 h-4' />
                  <span className='sr-only'>关闭</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>关闭</TooltipContent>
            </Tooltip>
          </SidebarHeader>
          <SidebarContent className='bg-[var(--ed-panel)] text-[var(--ed-ink)]'>{activeItem?.component}</SidebarContent>
        </Sidebar>
      ) : null}
    </Sidebar>
  )
}
