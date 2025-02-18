import { editor } from '@/editor'
import { customFieldItem } from '@/editor/setters'
import { SettingRender } from '@easy-editor/react-renderer'
import { observer } from 'mobx-react'
import { Sidebar, SidebarContent, SidebarHeader } from './ui/sidebar'

export const ConfigureSidebar = observer(({ ...props }: React.ComponentProps<typeof Sidebar>) => {
  return (
    <Sidebar collapsible='none' className='sticky hidden lg:flex top-0 h-svh border-l' {...props}>
      <SidebarHeader className='border-b p-2'>
        <div className='flex w-full items-center justify-between'>
          <div className='text-base font-medium text-foreground'>属性配置</div>
        </div>
      </SidebarHeader>
      <SidebarContent className='p-2'>
        <SettingRender editor={editor} customFieldItem={customFieldItem} />
      </SidebarContent>
    </Sidebar>
  )
})
