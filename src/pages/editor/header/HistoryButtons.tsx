import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { project } from '@easy-editor/core'
import { Redo2, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'

export const HistoryButtons = () => {
  const history = project.currentDocument?.history

  const [canUndo, setCanUndo] = useState(() => history?.isUndoable() ?? false)
  const [canRedo, setCanRedo] = useState(() => history?.isRedoable() ?? false)

  useEffect(() => {
    if (!history) return

    // 初始化状态
    setCanUndo(history.isUndoable())
    setCanRedo(history.isRedoable())

    // 订阅状态变化事件
    const unsubscribe = history.onStateChange(() => {
      setCanUndo(history.isUndoable())
      setCanRedo(history.isRedoable())
    })

    return unsubscribe
  }, [history])

  const handleUndo = () => {
    if (history?.isUndoable()) {
      history.back()
    }
  }

  const handleRedo = () => {
    if (history?.isRedoable()) {
      history.forward()
    }
  }

  return (
    <div className='flex items-center gap-1'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-[var(--ed-control-compact)] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            onClick={handleUndo}
            disabled={!canUndo}
          >
            <Undo2 className='size-4' />
            <span className='sr-only'>撤销</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>撤销本次编辑会话中的操作 (Ctrl+Z)</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-[var(--ed-control-compact)] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            onClick={handleRedo}
            disabled={!canRedo}
          >
            <Redo2 className='size-4' />
            <span className='sr-only'>重做</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>重做本次编辑会话中的操作 (Ctrl+Y)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
