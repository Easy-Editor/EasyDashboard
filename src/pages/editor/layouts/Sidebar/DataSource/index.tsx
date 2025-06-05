import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { nanoid } from 'nanoid'
import { DataSourceList } from './DataSourceList'

export const genId = (size = 6) => nanoid(size)

export const DataSourceSidebar = () => {
  return (
    <SidebarMenu>
      <SidebarMenuItem className='p-4'>
        <DataSourceList />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
