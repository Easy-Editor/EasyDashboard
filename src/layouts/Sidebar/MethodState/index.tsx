import MethodEditorModal, { type MethodEditorModalProps } from '@/components/event/MethodEditorModal'
import StateEditorModal, { type StateEditorModalProps } from '@/components/event/StateEditorModal'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Select } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { project } from '@/editor'
import { cn } from '@/lib/utils'
import type { JSExpression, JSFunction, Node, RootSchema } from '@easy-editor/core'
import { Plus } from 'lucide-react'
import { observer } from 'mobx-react'
import { nanoid } from 'nanoid'
import { useState } from 'react'
import { toast } from 'sonner'

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
            <LifeCycleList rootNode={rootNode} lifeCycles={lifeCycles} />
            <MethodList rootNode={rootNode} methods={methods} />
          </TabsContent>
          <TabsContent value='state' className='box-border p-2 mt-2 space-y-6'>
            <StateList rootNode={rootNode} state={state} />
          </TabsContent>
        </Tabs>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const lifeCycleOptions = [
  { name: 'componentDidMount', description: '组件挂载时' },
  { name: 'componentDidUpdate', description: '组件更新时' },
  { name: 'componentWillUnmount', description: '组件卸载时' },
  { name: 'render', description: '组件渲染时' },
  { name: 'componentDidCatch', description: '组件错误时' },
  { name: 'getSnapshotBeforeUpdate', description: '组件更新时获取快照' },
  { name: 'getDerivedStateFromProps', description: '组件更新时获取状态' },
]

const LifeCycleList = observer(
  ({ rootNode, lifeCycles }: { rootNode: Node<RootSchema>; lifeCycles: Record<string, JSFunction> }) => {
    const [open, setOpen] = useState(false)
    const [currentLifeCycle, setCurrentLifeCycle] = useState<JSFunction & { name: string; description?: string }>()
    const usedLifeCycles = Object.keys(lifeCycles)

    const handleAdd = (type: string) => {
      const lifeCycle = lifeCycleOptions.find(option => option.name === type)

      if (!lifeCycle) {
        toast.warning('生命周期不存在')
        return
      }

      setCurrentLifeCycle({
        ...lifeCycle,
        type: 'JSFunction',
        value: `function ${lifeCycle.name}() {\n  // TODO: 实现\n}`,
      })
      setOpen(true)
    }

    const handleEdit = (key: string) => () => {
      setCurrentLifeCycle({
        ...lifeCycles[key],
        name: key,
      })
      setOpen(true)
    }

    const handleConfirm: MethodEditorModalProps['onConfirm'] = (name, method) => {
      rootNode.setExtraPropValue(`lifeCycles.${name}`, method)
      setCurrentLifeCycle(undefined)
    }

    const handleDelete = (key: string) => () => {
      // TODO: extraProp 添加 clear
      rootNode.getExtraProp(`lifeCycles.${key}`)?.unset()
    }

    const handleCopy = (key: string) => () => {
      const copyMethod = lifeCycles[key]
      const entries = Object.entries(lifeCycles)

      // 插入
      const index = entries.findIndex(([k]) => k === key)
      const newEntries = [...entries.slice(0, index + 1), [`${key}-${id()}`, copyMethod], ...entries.slice(index + 1)]

      rootNode.setExtraPropValue('lifeCycles', Object.fromEntries(newEntries))
    }

    return (
      <MethodEditorModal open={open} method={currentLifeCycle} onClose={() => setOpen(false)} onConfirm={handleConfirm}>
        {Object.keys(lifeCycles).length > 0 && (
          <div className='space-y-4'>
            <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4 flex justify-between items-center'>
              <span>生命周期方法</span>
              <Select>
                <HoverCard>
                  <HoverCardTrigger>
                    <Plus className='w-4 h-4 cursor-pointer' />
                  </HoverCardTrigger>
                  <HoverCardContent>
                    <ul className='space-y-2'>
                      {lifeCycleOptions.map(option => (
                        <li
                          key={option.name}
                          onClick={() => (usedLifeCycles?.includes(option.name) ? undefined : handleAdd(option.name))}
                        >
                          <a
                            className={cn(
                              'block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors',
                              usedLifeCycles?.includes(option.name)
                                ? 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed pointer-events-none'
                                : 'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground',
                            )}
                            aria-disabled={usedLifeCycles?.includes(option.name)}
                          >
                            <div className='text-xs font-medium leading-none normal-case'>{option.name}</div>
                            <p className='line-clamp-2 text-xs leading-snug text-muted-foreground'>
                              {option.description}
                            </p>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </HoverCardContent>
                </HoverCard>
              </Select>
            </h3>
            {Object.entries(lifeCycles).map(([key, value]) => (
              <CardItem
                key={key}
                name={key}
                description={value?.description}
                onEdit={handleEdit(key)}
                onCopy={handleCopy(key)}
                onDelete={handleDelete(key)}
                disabled={{ copy: true }}
              />
            ))}
          </div>
        )}
      </MethodEditorModal>
    )
  },
)

const MethodList = observer(
  ({ rootNode, methods }: { rootNode: Node<RootSchema>; methods: Record<string, JSFunction> }) => {
    const [open, setOpen] = useState(false)
    const [currentMethod, setCurrentMethod] = useState<JSFunction & { name: string; description?: string }>()

    const handleAdd = () => {
      setOpen(true)
    }

    const handleEdit = (key: string) => () => {
      setCurrentMethod({
        ...methods[key],
        name: key,
      })
      setOpen(true)
    }

    const handleConfirm: MethodEditorModalProps['onConfirm'] = (name, method) => {
      rootNode.setExtraPropValue(`methods.${name}`, method)
      setCurrentMethod(undefined)
    }

    const handleDelete = (key: string) => () => {
      // TODO: extraProp 添加 clear
      rootNode.getExtraProp(`methods.${key}`)?.unset()
    }

    const handleCopy = (key: string) => () => {
      const copyMethod = methods[key]
      const entries = Object.entries(methods)

      // 插入
      const index = entries.findIndex(([k]) => k === key)
      const newEntries = [...entries.slice(0, index + 1), [`${key}-${id()}`, copyMethod], ...entries.slice(index + 1)]

      rootNode.setExtraPropValue('methods', Object.fromEntries(newEntries))
    }

    return (
      <MethodEditorModal open={open} method={currentMethod} onClose={() => setOpen(false)} onConfirm={handleConfirm}>
        {Object.keys(methods).length > 0 && (
          <div className='space-y-4'>
            <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4 flex justify-between items-center'>
              <span>普通方法</span>
              <Plus className='w-4 h-4 cursor-pointer' onClick={handleAdd} />
            </h3>
            {Object.entries(methods).map(([key, value]) => (
              <CardItem
                key={key}
                name={key}
                description={value?.description}
                onEdit={handleEdit(key)}
                onCopy={handleCopy(key)}
                onDelete={handleDelete(key)}
              />
            ))}
          </div>
        )}
      </MethodEditorModal>
    )
  },
)

const StateList = ({ rootNode, state }: { rootNode: Node<RootSchema>; state: Record<string, JSExpression> }) => {
  const [open, setOpen] = useState(false)
  const [currentState, setCurrentState] = useState<JSExpression & { name: string }>()

  const handleAdd = () => {
    setOpen(true)
  }

  const handleEdit = (key: string) => () => {
    setCurrentState({
      name: key,
      ...state[key],
    })
    setOpen(true)
  }

  const handleEditConfirm: StateEditorModalProps['onConfirm'] = (name, newState) => {
    const isEdit = !!currentState

    if (isEdit) {
      const editState = state[name]

      if (!editState) {
        toast.warning('状态不存在')
        return
      }
    }

    rootNode.setExtraPropValue(`state.${name}`, newState)
    setCurrentState(undefined)
  }

  const handleDelete = (key: string) => {
    // TODO: extraProp 添加 clear
    rootNode.getExtraProp(`state.${key}`)?.unset()
  }

  const handleCopy = (key: string) => {
    const copyMethod = state[key]
    const entries = Object.entries(state)

    // 插入
    const index = entries.findIndex(([k]) => k === key)
    const newEntries = [...entries.slice(0, index + 1), [`${key}-${id()}`, copyMethod], ...entries.slice(index + 1)]

    rootNode.setExtraPropValue('state', Object.fromEntries(newEntries))
  }

  return (
    <StateEditorModal open={open} state={currentState} onClose={() => setOpen(false)} onConfirm={handleEditConfirm}>
      {Object.keys(state).length > 0 && (
        <div className='space-y-4'>
          <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4 flex justify-between items-center'>
            <span>状态</span>
            <Plus className='w-4 h-4 cursor-pointer' onClick={handleAdd} />
          </h3>
          {Object.entries(state).map(([key, value]) => (
            <CardItem
              key={key}
              name={key}
              description={value?.description}
              onEdit={handleEdit(key)}
              onDelete={() => handleDelete(key)}
              onCopy={() => handleCopy(key)}
            />
          ))}
        </div>
      )}
    </StateEditorModal>
  )
}

const CardItem = ({
  name,
  description,
  onEdit,
  onDelete,
  onCopy,
  disabled,
}: {
  name: string
  description?: string
  onEdit?: () => void
  onDelete?: () => void
  onCopy?: () => void
  disabled?:
    | boolean
    | {
        edit?: boolean
        del?: boolean
        copy?: boolean
      }
}) => {
  const {
    edit = false,
    del = false,
    copy = false,
  } = typeof disabled === 'boolean' ? { edit: disabled, del: disabled, copy: disabled } : (disabled ?? {})

  return (
    <div>
      <div className='space-y-1'>
        <h4 className='text-sm font-medium leading-none mb-2'>{name}</h4>
        <p className='text-xs text-muted-foreground'>{description ?? '-'}</p>
      </div>
      <Separator className='my-3' />
      <div className='flex h-4 items-center space-x-4 text-xs'>
        <Button
          variant='link'
          className='hover:text-primary transition-colors cursor-pointer text-xs px-0 py-0'
          onClick={onEdit}
          disabled={edit}
        >
          编辑
        </Button>
        <Separator orientation='vertical' />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant='link'
              className='hover:text-primary transition-colors cursor-pointer text-xs px-0 py-0'
              disabled={del}
            >
              删除
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定删除吗？</AlertDialogTitle>
              <AlertDialogDescription>删除后，该状态将无法恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className='h-8 text-xs px-4 py-[5px]'>取消</AlertDialogCancel>
              <AlertDialogAction className='h-8 text-xs px-4 py-[5px]' onClick={onDelete}>
                确定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Separator orientation='vertical' />

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant='link'
              className='hover:text-primary transition-colors cursor-pointer text-xs px-0 py-0'
              disabled={copy}
            >
              复制
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定复制吗？</AlertDialogTitle>
              <AlertDialogDescription>复制后，该状态将新增一个副本。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className='h-8 text-xs px-4 py-[5px]'>取消</AlertDialogCancel>
              <AlertDialogAction className='h-8 text-xs px-4 py-[5px]' onClick={onCopy}>
                确定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

const id = (size = 6) => nanoid(size)
