import { Button } from '@/components/ui/button'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  MAX_PREVIEW_SCALE,
  MIN_PREVIEW_SCALE,
  PREVIEW_FIT_GUTTER,
  type PreviewScaleState,
  calculatePreviewFitScale,
  resolvePreviewScale,
  stepPreviewScale,
} from './preview-scale'

type ViewportSize = {
  width: number
  height: number
}

function controlClass(active = false) {
  return [
    'h-7 rounded-[6px] border px-2.5 text-[11px] shadow-none',
    active
      ? 'border-[color-mix(in_srgb,var(--ed-cyan)_42%,var(--ed-line-strong))] bg-[color-mix(in_srgb,var(--ed-cyan)_11%,var(--ed-panel-raised))] text-[var(--ed-ink)]'
      : 'border-transparent bg-transparent text-[var(--ed-ink-muted)] hover:border-[var(--ed-line)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]',
  ].join(' ')
}

export function PreviewScaleViewport({
  viewport,
  children,
}: {
  viewport: ViewportSize
  children: ReactNode
}) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState<ViewportSize>({ width: 0, height: 0 })
  const [scaleState, setScaleState] = useState<PreviewScaleState>({
    mode: 'fit',
    manualScale: 1,
  })

  useEffect(() => {
    const element = scrollViewportRef.current
    if (!element) return

    const updateSize = () => {
      setContainerSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitScale = calculatePreviewFitScale(containerSize, viewport)
  const scale = resolvePreviewScale(scaleState, fitScale)
  const scaledWidth = viewport.width * scale
  const scaledHeight = viewport.height * scale
  const contentWidth = Math.max(containerSize.width, scaledWidth + PREVIEW_FIT_GUTTER)
  const contentHeight = Math.max(containerSize.height, scaledHeight + PREVIEW_FIT_GUTTER)
  const canvasLeft = Math.max(PREVIEW_FIT_GUTTER / 2, (contentWidth - scaledWidth) / 2)
  const canvasTop = Math.max(PREVIEW_FIT_GUTTER / 2, (contentHeight - scaledHeight) / 2)
  const scalePercent = Math.round(scale * 100)

  // The effect intentionally re-centers after either the scale or authored viewport changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these values are the effect trigger
  useEffect(() => {
    const element = scrollViewportRef.current
    if (!element) return

    const frame = window.requestAnimationFrame(() => {
      element.scrollTo({
        left: Math.max(0, (element.scrollWidth - element.clientWidth) / 2),
        top: Math.max(0, (element.scrollHeight - element.clientHeight) / 2),
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [scale, viewport.height, viewport.width])

  const setManualScale = (manualScale: number) => {
    setScaleState({
      mode: 'manual',
      manualScale,
    })
  }

  return (
    <div data-preview-scale-mode={scaleState.mode} className='relative h-full w-full overflow-hidden'>
      <div className='absolute inset-0 px-5 pb-14 pt-14'>
        <div
          ref={scrollViewportRef}
          data-preview-stage=''
          className='ed-preview-stage-grid relative h-full w-full overflow-auto border border-[var(--ed-line)] bg-[var(--ed-canvas)]'
        >
          <div
            className='relative'
            style={{
              width: contentWidth,
              height: contentHeight,
            }}
          >
            <div
              data-preview-canvas=''
              data-preview-scale={scale.toFixed(4)}
              className='absolute overflow-hidden bg-black shadow-[0_24px_80px_rgb(0_0_0/0.48)] outline outline-1 outline-[var(--ed-line-strong)]'
              style={{
                left: canvasLeft,
                top: canvasTop,
                width: viewport.width,
                height: viewport.height,
                transform: `scale(${scale})`,
                transformOrigin: 'left top',
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>

      <div
        data-preview-scale-controls=''
        className='absolute bottom-4 left-1/2 z-40 flex h-9 -translate-x-1/2 items-center gap-1 rounded-[8px] border border-[var(--ed-line-strong)] bg-[color-mix(in_srgb,var(--ed-panel)_94%,transparent)] px-1.5 shadow-[0_10px_32px_rgb(0_0_0/0.42)] backdrop-blur'
      >
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-pressed={scaleState.mode === 'fit'}
          className={controlClass(scaleState.mode === 'fit')}
          onClick={() => setScaleState(current => ({ ...current, mode: 'fit' }))}
        >
          <Maximize2 className='size-3.5' />
          适合窗口
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          aria-pressed={scaleState.mode === 'manual' && scaleState.manualScale === 1}
          className={controlClass(scaleState.mode === 'manual' && scaleState.manualScale === 1)}
          onClick={() => setManualScale(1)}
        >
          100%
        </Button>
        <span aria-hidden='true' className='mx-1 h-4 w-px bg-[var(--ed-line)]' />
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label='缩小预览'
          disabled={scale <= MIN_PREVIEW_SCALE}
          className='size-7 rounded-[6px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
          onClick={() => setManualScale(stepPreviewScale(scale, -1))}
        >
          <Minus className='size-3.5' />
        </Button>
        <output
          aria-label='当前预览缩放'
          aria-live='polite'
          className='min-w-12 text-center font-mono text-[11px] tabular-nums text-[var(--ed-ink-soft)]'
        >
          {scalePercent}%
        </output>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label='放大预览'
          disabled={scale >= MAX_PREVIEW_SCALE}
          className='size-7 rounded-[6px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
          onClick={() => setManualScale(stepPreviewScale(scale, 1))}
        >
          <Plus className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}
