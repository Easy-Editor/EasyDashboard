import { Separator } from '@/components/ui/separator'
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { project } from '@/editor'
import type { JSExpression, JSFunction } from '@easy-editor/core'
import { observer } from 'mobx-react'

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

  const lifeCycles = rootNode.getExtraPropValue('lifeCycles') as Record<string, JSFunction>
  const methods = rootNode.getExtraPropValue('methods') as Record<string, JSFunction>
  const state = rootNode.getExtraPropValue('state') as Record<string, JSExpression>

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
            <MethodList lifeCycles={lifeCycles} methods={methods} />
          </TabsContent>
          <TabsContent value='state' className='box-border p-2 mt-2 space-y-6'>
            <StateList state={state} />
          </TabsContent>
        </Tabs>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const MethodList = ({
  lifeCycles,
  methods,
}: { lifeCycles: Record<string, JSFunction>; methods: Record<string, JSFunction> }) => {
  return (
    <>
      {Object.keys(lifeCycles).length > 0 && (
        <div className='space-y-4'>
          <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mb-4'>生命周期方法</h3>
          {Object.entries(lifeCycles).map(([key, value]) => (
            <CardItem key={key} name={key} description={value?.description} />
          ))}
        </div>
      )}

      {Object.keys(methods).length > 0 && (
        <div className='space-y-4'>
          <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4'>普通方法</h3>
          {Object.entries(methods).map(([key, value]) => (
            <CardItem key={key} name={key} description={value?.description} />
          ))}
        </div>
      )}
    </>
  )
}

const StateList = ({ state }: { state: Record<string, JSExpression> }) => {
  return (
    <>
      {Object.keys(state).length > 0 && (
        <div className='space-y-4'>
          {Object.entries(state).map(([key, value]) => (
            <CardItem key={key} name={key} description={value?.description} />
          ))}
        </div>
      )}
    </>
  )
}

const CardItem = ({
  name,
  description,
  onEdit,
  onDelete,
  onCopy,
}: {
  name: string
  description?: string
  onEdit?: () => void
  onDelete?: () => void
  onCopy?: () => void
}) => {
  return (
    <div>
      <div className='space-y-1'>
        <h4 className='text-sm font-medium leading-none mb-2'>{name}</h4>
        <p className='text-xs text-muted-foreground'>{description ?? '-'}</p>
      </div>
      <Separator className='my-3' />
      <div className='flex h-4 items-center space-x-4 text-xs'>
        <div className='hover:text-primary transition-colors cursor-pointer' onClick={onEdit}>
          编辑
        </div>
        <Separator orientation='vertical' />
        <div className='hover:text-primary transition-colors cursor-pointer' onClick={onDelete}>
          删除
        </div>
        <Separator orientation='vertical' />
        <div className='hover:text-primary transition-colors cursor-pointer' onClick={onCopy}>
          复制
        </div>
      </div>
    </div>
  )
}
