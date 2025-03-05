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
import { Separator } from '@/components/ui/separator'
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { project } from '@/editor'
import type { JSExpression, JSFunction, Node, RootSchema } from '@easy-editor/core'
import { observer } from 'mobx-react'
import { nanoid } from 'nanoid'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import MethodEditorModal, { type MethodEditorModalProps } from './event/method-editor-modal'

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
            <MethodList rootNode={rootNode} methods={methods} lifeCycles={lifeCycles} />
          </TabsContent>
          <TabsContent value='state' className='box-border p-2 mt-2 space-y-6'>
            <StateList rootNode={rootNode} state={state} />
          </TabsContent>
        </Tabs>
      </SidebarMenuItem>
    </SidebarMenu>
  )
})

const MethodList = observer(
  ({
    rootNode,
    methods,
    lifeCycles,
  }: { rootNode: Node<RootSchema>; methods: Record<string, JSFunction>; lifeCycles: Record<string, JSFunction> }) => {
    const [open, setOpen] = useState(false)
    const currentType = useRef<'lifeCycles' | 'methods'>('methods')
    const [currentMethod, setCurrentMethod] = useState<JSFunction & { name: string; description?: string }>()

    const handleEdit = (type: 'lifeCycles' | 'methods', key: string) => () => {
      currentType.current = type
      setCurrentMethod({
        ...(type === 'lifeCycles' ? lifeCycles[key] : methods[key]),
        name: key,
      })
      setOpen(true)
    }

    const handleEditConfirm: MethodEditorModalProps['onConfirm'] = (name, method) => {
      const currentMethods = currentType.current === 'lifeCycles' ? lifeCycles : methods
      const editMethod = currentMethods[name]

      if (!editMethod) {
        toast.warning('方法不存在')
        return
      }

      rootNode.setExtraPropValue(`${currentType.current}.${name}`, method)
    }

    const handleDelete = (type: string, key: string) => () => {
      // TODO: extraProp 添加 clear
      rootNode.getExtraProp(`${type}.${key}`)?.unset()
    }

    const handleCopy = (type: string, key: string) => () => {
      let copyMethod: JSFunction
      let entries: [string, JSFunction][]

      if (type === 'lifeCycles') {
        copyMethod = lifeCycles[key]
        entries = Object.entries(lifeCycles)
      } else {
        copyMethod = methods[key]
        entries = Object.entries(methods)
      }

      // 插入
      const index = entries.findIndex(([k]) => k === key)
      const newEntries = [...entries.slice(0, index + 1), [`${key}-${id()}`, copyMethod], ...entries.slice(index + 1)]

      rootNode.setExtraPropValue(type, Object.fromEntries(newEntries))
    }

    return (
      <MethodEditorModal
        open={open}
        method={currentMethod}
        onClose={() => setOpen(false)}
        onConfirm={handleEditConfirm}
      >
        {Object.keys(lifeCycles).length > 0 && (
          <div className='space-y-4'>
            <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mb-4'>生命周期方法</h3>
            {Object.entries(lifeCycles).map(([key, value]) => (
              <CardItem
                key={key}
                name={key}
                description={value?.description}
                onEdit={handleEdit('lifeCycles', key)}
                onCopy={handleCopy('lifeCycles', key)}
                onDelete={handleDelete('lifeCycles', key)}
                disabled={{ copy: true }}
              />
            ))}
          </div>
        )}
        {Object.keys(methods).length > 0 && (
          <div className='space-y-4'>
            <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4'>普通方法</h3>
            {Object.entries(methods).map(([key, value]) => (
              <CardItem
                key={key}
                name={key}
                description={value?.description}
                onEdit={handleEdit('methods', key)}
                onCopy={handleCopy('methods', key)}
                onDelete={handleDelete('methods', key)}
              />
            ))}
          </div>
        )}
      </MethodEditorModal>
    )
  },
)

const StateList = ({ rootNode, state }: { rootNode: Node<RootSchema>; state: Record<string, JSExpression> }) => {
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
    <>
      {Object.keys(state).length > 0 && (
        <div className='space-y-4'>
          {Object.entries(state).map(([key, value]) => (
            <CardItem
              key={key}
              name={key}
              description={value?.description}
              onDelete={() => handleDelete(key)}
              onCopy={() => handleCopy(key)}
            />
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
