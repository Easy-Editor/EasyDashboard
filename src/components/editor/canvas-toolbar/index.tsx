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
    <div className='absolute bottom-3 left-1/2 z-20 flex h-8 -translate-x-1/2 items-center gap-1 rounded-[7px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)]/95 px-1 shadow-[0_8px_28px_rgba(0,0,0,0.38)] backdrop-blur'>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={!rootNode}
            className='h-6 gap-1.5 rounded-[4px] px-2 font-mono text-[10px] tabular-nums text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] data-[state=open]:bg-[var(--ed-panel-raised)] data-[state=open]:text-[var(--ed-ink)]'
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
          data-ed-shell='editor'
          side='top'
          align='center'
          sideOffset={8}
          className='w-[300px] rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] p-3 text-[var(--ed-ink)] shadow-2xl'
        >
          <div className='mb-3 border-b border-[var(--ed-line)] pb-3'>
            <p className='text-xs font-medium text-[var(--ed-ink)]'>画布分辨率</p>
            <p className='mt-1 text-[11px] leading-4 text-[var(--ed-ink-faint)]'>设置当前大屏的设计尺寸。</p>
          </div>
          <ResolutionSetter value={resolution} onChange={handleResolutionChange} />
        </PopoverContent>
      </Popover>

      <div className='h-4 w-px bg-[var(--ed-line-strong)]' />
      <div className='flex items-center gap-1.5'>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-6 text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
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
          className='w-20'
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

        <span className='min-w-9 text-center font-mono text-[10px] tabular-nums text-[var(--ed-ink-muted)]'>
          {Math.round(scale * 100)}%
        </span>
      </div>
    </div>
  )
})
