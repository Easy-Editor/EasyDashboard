import { MethodEditorModal, type MethodEditorModalProps } from '@/components/common/MethodEditorModal'
import type { JSFunction, Node, RootSchema } from '@easy-editor/core'
import { Plus } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { genId } from '.'
import { CardItem } from './CardItem'

export const MethodList = observer(({ rootNode }: { rootNode: Node<RootSchema> }) => {
  const methods = rootNode.getExtraPropValue('methods') as Record<string, JSFunction>
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
    rootNode.clearExtraPropValue(`methods.${key}`)
  }

  const handleCopy = (key: string) => () => {
    const copyMethod = methods[key]
    const entries = Object.entries(methods)

    // 插入
    const index = entries.findIndex(([k]) => k === key)
    const newEntries = [...entries.slice(0, index + 1), [`${key}-${genId()}`, copyMethod], ...entries.slice(index + 1)]

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
})
