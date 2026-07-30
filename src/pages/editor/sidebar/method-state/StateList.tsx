import { StateEditorModal, type StateEditorModalProps } from '@/components/common/StateEditorModal'
import type { JSExpression, Node, RootSchema } from '@easy-editor/core'
import { Plus } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { genId } from '.'
import { CardItem } from './CardItem'
import { normalizeExtraPropRecord } from './utils'

export const StateList = observer(({ rootNode }: { rootNode: Node<RootSchema> }) => {
  const state = normalizeExtraPropRecord(
    rootNode.getExtraPropValue('state') as Record<string, JSExpression> | null | undefined,
  )
  const [open, setOpen] = useState(false)
  const [currentState, setCurrentState] = useState<JSExpression & { name: string }>()

  const handleAdd = () => {
    setCurrentState(undefined)
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    setCurrentState(undefined)
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
    rootNode.clearExtraPropValue(`state.${key}`)
  }

  const handleCopy = (key: string) => {
    const copyMethod = state[key]
    const entries = Object.entries(state)

    // 插入
    const index = entries.findIndex(([k]) => k === key)
    const newEntries = [...entries.slice(0, index + 1), [`${key}-${genId()}`, copyMethod], ...entries.slice(index + 1)]

    rootNode.setExtraPropValue('state', Object.fromEntries(newEntries))
  }

  return (
    <StateEditorModal open={open} state={currentState} onClose={handleClose} onConfirm={handleEditConfirm}>
      <div className='space-y-4'>
        <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase mt-6 mb-4 flex justify-between items-center'>
          <span>状态</span>
          <button type='button' aria-label='新增状态' className='cursor-pointer' onClick={handleAdd}>
            <Plus className='w-4 h-4' />
          </button>
        </h3>
        {Object.keys(state).length > 0 ? (
          Object.entries(state).map(([key, value]) => (
            <CardItem
              key={key}
              name={key}
              description={value?.description}
              onEdit={handleEdit(key)}
              onDelete={() => handleDelete(key)}
              onCopy={() => handleCopy(key)}
            />
          ))
        ) : (
          <p className='text-xs text-muted-foreground'>暂无状态，点击 + 新增。</p>
        )}
      </div>
    </StateEditorModal>
  )
})
