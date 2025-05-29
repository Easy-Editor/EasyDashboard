import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { project } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { nanoid } from 'nanoid'
import { DataSourceList } from './DataSourceList'

export const genId = (size = 6) => nanoid(size)

export const DataSourceSidebar = observer(() => {
  const rootNode = project.currentDocument?.rootNode

  if (!rootNode) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className='p-4'>
        <DataSourceList rootNode={rootNode} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
})
