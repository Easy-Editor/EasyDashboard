import { MethodEditorModal, type MethodEditorModalProps } from '@/components/common/MethodEditorModal'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { JSFunction, Node, RootSchema } from '@easy-editor/core'
import { Plus } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { genId } from '.'
import { CardItem } from './CardItem'
import { normalizeExtraPropRecord } from './utils'

const lifeCycleOptions = [
  { name: 'componentDidMount', description: '组件挂载时' },
  { name: 'componentDidUpdate', description: '组件更新时' },
  { name: 'componentWillUnmount', description: '组件卸载时' },
  { name: 'render', description: '组件渲染时' },
  { name: 'componentDidCatch', description: '组件错误时' },
  { name: 'getSnapshotBeforeUpdate', description: '组件更新时获取快照' },
  { name: 'getDerivedStateFromProps', description: '组件更新时获取状态' },
]

export const LifeCycleList = observer(({ rootNode }: { rootNode: Node<RootSchema> }) => {
  const lifeCycles = normalizeExtraPropRecord(
    rootNode.getExtraPropValue('lifeCycles') as Record<string, JSFunction> | null | undefined,
  )
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
    rootNode.clearExtraPropValue(`lifeCycles.${key}`)
  }

  const handleCopy = (key: string) => () => {
    const copyMethod = lifeCycles[key]
    const entries = Object.entries(lifeCycles)

    // 插入
    const index = entries.findIndex(([k]) => k === key)
    const newEntries = [...entries.slice(0, index + 1), [`${key}-${genId()}`, copyMethod], ...entries.slice(index + 1)]

    rootNode.setExtraPropValue('lifeCycles', Object.fromEntries(newEntries))
  }

  return (
    <MethodEditorModal open={open} method={currentLifeCycle} onClose={() => setOpen(false)} onConfirm={handleConfirm}>
      <div className='space-y-4'>
        <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4 flex justify-between items-center'>
          <span>生命周期方法</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                aria-label='新增生命周期方法'
                className='inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                <Plus className='size-4' aria-hidden='true' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-64'>
              {lifeCycleOptions.map(option => (
                <DropdownMenuItem
                  key={option.name}
                  disabled={usedLifeCycles.includes(option.name)}
                  onSelect={() => handleAdd(option.name)}
                  className='flex-col items-start gap-1 py-2'
                >
                  <span className='text-xs font-medium leading-none normal-case'>{option.name}</span>
                  <span className='text-xs leading-snug text-muted-foreground'>{option.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </h3>
        {Object.keys(lifeCycles).length > 0 ? (
          Object.entries(lifeCycles).map(([key, value]) => (
            <CardItem
              key={key}
              name={key}
              description={value?.description}
              onEdit={handleEdit(key)}
              onCopy={handleCopy(key)}
              onDelete={handleDelete(key)}
              disabled={{ copy: true }}
            />
          ))
        ) : (
          <p className='text-xs text-muted-foreground'>暂无生命周期方法，点击 + 新增。</p>
        )}
      </div>
    </MethodEditorModal>
  )
})
