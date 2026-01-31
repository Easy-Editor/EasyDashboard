import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Maximize2 } from 'lucide-react'
import type { FC } from 'react'

export interface CanvasToolbarProps {
  /** 当前缩放比例 */
  scale: number
  /** 自适应宽度回调 */
  onFitWidth: () => void
}

/**
 * 画布底部工具条
 * 提供画布缩放、自适应等操作
 */
export const CanvasToolbar: FC<CanvasToolbarProps> = ({ scale, onFitWidth }) => {
  return (
    <div className='flex h-10 items-center justify-center gap-2 border-t bg-background/80 backdrop-blur-sm'>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='sm' className='h-7 gap-1.5 px-2 text-xs' onClick={onFitWidth}>
              <Maximize2 className='h-3.5 w-3.5' />
              <span>自适应宽度</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top'>
            <p>调整缩放以适应画布宽度</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <span className='text-xs text-muted-foreground'>{Math.round(scale * 100)}%</span>
    </div>
  )
}
