import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ResolutionSetter from '@/editor/setters/resolution-setter'
import { project } from '@easy-editor/core'
import { ChevronUp, Monitor, MoveDiagonal } from 'lucide-react'
import { observer } from 'mobx-react'
import { type FC, useEffect } from 'react'

export interface CanvasToolbarProps {
  onFitWidth: () => void
  minScale?: number
  maxScale?: number
}

export const CanvasToolbar: FC<CanvasToolbarProps> = observer(({ onFitWidth, minScale = 0.1, maxScale = 3 }) => {
  const viewport = project.simulator?.viewport
  const scale = viewport?.scale ?? 1
  const rootNode = project.currentDocument?.rootNode
  const simulator = project.simulator
  const dashboardRect = rootNode?.getDashboardRect()
  const deviceViewport = simulator?.deviceStyle?.viewport as { width?: number; height?: number } | undefined
  const resolutionWidth = dashboardRect?.width ?? deviceViewport?.width ?? 1920
  const resolutionHeight = dashboardRect?.height ?? deviceViewport?.height ?? 1080
  const resolution = {
    width: resolutionWidth,
    height: resolutionHeight,
  }

  useEffect(() => {
    if (!simulator || (deviceViewport?.width === resolutionWidth && deviceViewport?.height === resolutionHeight)) {
      return
    }

    simulator.set('deviceStyle', {
      viewport: {
        width: resolutionWidth,
        height: resolutionHeight,
      },
    })
  }, [deviceViewport?.height, deviceViewport?.width, resolutionHeight, resolutionWidth, simulator])

  const onScaleChange = (newScale: number) => {
    if (viewport) {
      viewport.scale = newScale
    }
  }

  const handleSliderChange = (values: number[]) => {
    onScaleChange?.(values[0])
  }

  const handleResolutionChange = (value: { width: number; height: number }) => {
    if (!rootNode) return
    if (rootNode.getPropValue('__resolution') !== undefined) {
      rootNode.clearPropValue('__resolution')
    }
    rootNode.updateDashboardRect(value)
    window.requestAnimationFrame(onFitWidth)
  }

  return (
    <div className='grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-border/70 bg-background px-2'>
      <span aria-hidden='true' />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={!rootNode}
            className='h-7 gap-2 rounded-[5px] px-2.5 font-mono text-[11px] tabular-nums text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground'
            aria-label={`设置画布分辨率，当前 ${resolution.width} × ${resolution.height}`}
          >
            <Monitor className='size-3.5' />
            <span>
              {resolution.width} × {resolution.height}
            </span>
            <ChevronUp className='size-3 opacity-60' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side='top'
          align='center'
          sideOffset={8}
          className='w-[300px] rounded-[8px] border-[#2A333D] bg-[#0F1318] p-3 text-[#F1F5F7] shadow-2xl'
        >
          <div className='mb-3 border-b border-[#252D35] pb-3'>
            <p className='text-xs font-medium text-[#E7ECEF]'>画布分辨率</p>
            <p className='mt-1 text-[11px] leading-4 text-[#73808A]'>设置当前大屏的设计尺寸。</p>
          </div>
          <ResolutionSetter value={resolution} onChange={handleResolutionChange} />
        </PopoverContent>
      </Popover>

      <div className='flex items-center justify-self-end gap-2'>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-6 w-6'
                onClick={onFitWidth}
                aria-label='自适应画布'
              >
                <MoveDiagonal className='h-3.5 w-3.5' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='top'>
              <p>自适应画布</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

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
            aria-label='画布缩放比例'
          />
        </div>

        <span className='min-w-10 text-center text-xs tabular-nums text-muted-foreground'>
          {Math.round(scale * 100)}%
        </span>
      </div>
    </div>
  )
})
