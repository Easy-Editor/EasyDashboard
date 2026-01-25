import { Sidebar, SidebarContent, SidebarHeader } from '@/components/ui/sidebar'
import { setterManager } from '@/editor/remote'
import { customFieldItem } from '@/editor/setters'
import { project } from '@easy-editor/core'
import { SettingRenderer } from '@easy-editor/react-renderer'
import { EyeOff, Lock } from 'lucide-react'
import { observer } from 'mobx-react'
import { ConfigureSkeleton } from './ConfigureSkeleton'

export const ConfigureSidebar = observer(({ ...props }: React.ComponentProps<typeof Sidebar>) => {
  const isLoading = setterManager.isLoading
  const settings = project.designer.settingsManager.settings
  const isLocked = settings?.isLocked ?? false
  const isHidden = settings?.isHidden ?? false

  return (
    <Sidebar collapsible='none' className='sticky hidden lg:flex top-0 h-svh border-l' {...props}>
      <SidebarHeader className='border-b p-3 shadow-sm bg-background'>
        <div className='flex w-full items-center justify-between'>
          <span className='text-base font-semibold text-foreground'>属性配置</span>
          {(isLocked || isHidden) && (
            <div className='flex items-center gap-1.5'>
              {isLocked && (
                <div className='flex items-center gap-1.5 px-2 py-1 text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded'>
                  <Lock className='h-3.5 w-3.5' />
                  <span>已锁定</span>
                </div>
              )}
              {isHidden && (
                <div className='flex items-center gap-1.5 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded'>
                  <EyeOff className='h-3.5 w-3.5' />
                  <span>已隐藏</span>
                </div>
              )}
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className='p-3 bg-surface'>
        {isLoading ? (
          <ConfigureSkeleton />
        ) : (
          <SettingRenderer designer={project.designer} customFieldItem={customFieldItem} />
        )}
      </SidebarContent>
    </Sidebar>
  )
})
