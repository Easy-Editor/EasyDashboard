import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { project } from '@/editor'
import { observer } from 'mobx-react'
import { nanoid } from 'nanoid'
import { LifeCycleList } from './LifeCycleList'
import { MethodList } from './MethodList'
import { StateList } from './StateList'

export const genId = (size = 6) => nanoid(size)

const tabsList = [
  {
    label: '方法',
    value: 'methods',
  },
  {
    label: '状态',
    value: 'state',
  },
]

export const MethodStateSidebar = observer(() => {
  const rootNode = project.currentDocument?.rootNode

  if (!rootNode) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className='p-4'>
        <Tabs defaultValue={'methods'} className='w-full'>
          <TabsList
            className='grid w-full'
            style={{
              gridTemplateColumns: `repeat(${tabsList.length}, minmax(0, 1fr))`,
            }}
          >
            {tabsList.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value='methods' className='box-border p-2 mt-2 space-y-6'>
            <LifeCycleList rootNode={rootNode} />
            <MethodList rootNode={rootNode} />
          </TabsContent>
          <TabsContent value='state' className='box-border p-2 mt-2 space-y-6'>
            <StateList rootNode={rootNode} />
          </TabsContent>
        </Tabs>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})
