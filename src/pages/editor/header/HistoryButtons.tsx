import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { project } from '@easy-editor/core'
import { Redo2, Undo2 } from 'lucide-react'
import { observer } from 'mobx-react'

export const HistoryButtons = observer(() => {
  const history = project.currentDocument?.history

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

  const canUndo = history?.isUndoable() ?? false
  const canRedo = history?.isRedoable() ?? false

  return (
    <div className='flex items-center gap-1'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleUndo} disabled={!canUndo}>
            <Undo2 className='h-4 w-4' />
            <span className='sr-only'>Undo</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Undo (Ctrl+Z)</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant='ghost' size='icon' className='h-8 w-8' onClick={handleRedo} disabled={!canRedo}>
            <Redo2 className='h-4 w-4' />
            <span className='sr-only'>Redo</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Redo (Ctrl+Y)</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
})
