import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { project } from '@easy-editor/core'
import { MoveDiagonal } from 'lucide-react'
import { observer } from 'mobx-react'
import type { FC } from 'react'

export interface CanvasToolbarProps {
  onFitWidth: () => void
  minScale?: number
  maxScale?: number
}

export const CanvasToolbar: FC<CanvasToolbarProps> = observer(({ onFitWidth, minScale = 0.1, maxScale = 3 }) => {
  const viewport = project.simulator?.viewport
  const scale = viewport?.scale ?? 1

  const onScaleChange = (newScale: number) => {
    if (viewport) {
      viewport.scale = newScale
    }
  }

  const handleSliderChange = (values: number[]) => {
    onScaleChange?.(values[0])
  }

  return (
    <div className='flex h-8 shrink-0 items-center justify-end gap-2 border-t bg-background px-2'>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='icon' className='h-6 w-6' onClick={onFitWidth}>
              <MoveDiagonal className='h-3.5 w-3.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top'>
            <p>自适应画布</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* 缩放滑块 */}
      {onScaleChange && (
        <div
          className='w-24'
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onContextMenu={e => e.stopPropagation()}
        >
          <Slider
            value={[scale]}
            min={minScale}
            max={maxScale}
            step={0.05}
            onValueChange={handleSliderChange}
            className='cursor-pointer'
          />
        </div>
      )}

      <span className='min-w-10 text-center text-xs text-muted-foreground tabular-nums'>
        {Math.round(scale * 100)}%
      </span>
    </div>
  )
})
