import { MethodEditorModal, type MethodEditorModalProps } from '@/components/common/MethodEditorModal'
import type { JSFunction, Node, RootSchema } from '@easy-editor/core'
import { Plus } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { genId } from '.'
import { CardItem } from './CardItem'
import { normalizeExtraPropRecord } from './utils'

export const MethodList = observer(({ rootNode }: { rootNode: Node<RootSchema> }) => {
  const methods = normalizeExtraPropRecord(
    rootNode.getExtraPropValue('methods') as Record<string, JSFunction> | null | undefined,
  )
  const [open, setOpen] = useState(false)
  const [currentMethod, setCurrentMethod] = useState<JSFunction & { name: string; description?: string }>()

  const handleAdd = () => {
    setCurrentMethod(undefined)
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    setCurrentMethod(undefined)
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
    <MethodEditorModal open={open} method={currentMethod} onClose={handleClose} onConfirm={handleConfirm}>
      <div className='space-y-4'>
        <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4 flex justify-between items-center'>
          <span>普通方法</span>
          <button type='button' aria-label='新增普通方法' className='cursor-pointer' onClick={handleAdd}>
            <Plus className='w-4 h-4' />
          </button>
        </h3>
        {Object.keys(methods).length > 0 ? (
          Object.entries(methods).map(([key, value]) => (
            <CardItem
              key={key}
              name={key}
              description={value?.description}
              onEdit={handleEdit(key)}
              onCopy={handleCopy(key)}
              onDelete={handleDelete(key)}
            />
          ))
        ) : (
          <p className='text-xs text-muted-foreground'>暂无普通方法，点击 + 新增。</p>
        )}
      </div>
    </MethodEditorModal>
  )
})
