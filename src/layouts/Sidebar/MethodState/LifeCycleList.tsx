import { MethodEditorModal, type MethodEditorModalProps } from '@/components/common/MethodEditorModal'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { JSFunction, Node, RootSchema } from '@easy-editor/core'
import { Plus } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { genId } from '.'
import { CardItem } from './CardItem'

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
  const lifeCycles = rootNode.getExtraPropValue('lifeCycles') as Record<string, JSFunction>
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
})
