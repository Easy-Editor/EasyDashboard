import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { SetterProps } from '@easy-editor/core'
import { useEffect, useId, useRef, useState } from 'react'
import { toNativeColorValue } from './color-value'

export interface ColorSetterProps extends SetterProps<string> {
  disableAlpha?: boolean
}

const ColorSetter = ({ value, initialValue, onChange }: ColorSetterProps) => {
  const currentValue = value ?? initialValue ?? ''
  const [draftValue, setDraftValue] = useState(currentValue)
  const colorInputId = useId()
  const cssValueInputId = useId()
  const skipNextBlurCommit = useRef(false)

  useEffect(() => {
    setDraftValue(currentValue)
  }, [currentValue])

  const commitValue = (nextValue: string) => {
    const normalized = nextValue.trim()
    if (!normalized || normalized === currentValue) return
    onChange(normalized)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          className='h-8 w-full min-w-0 justify-start gap-2 px-2 font-normal'
          aria-label={`选择颜色，当前值 ${currentValue || '未设置'}`}
        >
          <span
            aria-hidden='true'
            className='size-4 shrink-0 rounded-sm border border-border-strong shadow-inner'
            style={{ backgroundColor: currentValue || 'transparent' }}
          />
          <span className='min-w-0 truncate font-mono text-xs' title={currentValue || '未设置'}>
            {currentValue || '未设置'}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        data-ed-shell='editor'
        side='left'
        align='start'
        className='w-64 space-y-3 border-[var(--ed-line-strong)] bg-[var(--ed-panel)] p-3 text-[var(--ed-ink)]'
      >
        <div>
          <div className='text-sm font-medium'>颜色</div>
          <p className='mt-0.5 text-xs text-muted-foreground'>可选取纯色，也可直接填写 CSS 颜色值。</p>
        </div>

        <div className='flex items-center gap-3'>
          <label htmlFor={colorInputId} className='text-xs text-muted-foreground'>
            取色
          </label>
          <input
            id={colorInputId}
            type='color'
            value={toNativeColorValue(currentValue)}
            onChange={event => {
              const nextValue = event.currentTarget.value
              setDraftValue(nextValue)
              commitValue(nextValue)
            }}
            className='h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent p-1'
          />
          <span className='font-mono text-xs uppercase text-muted-foreground'>{toNativeColorValue(currentValue)}</span>
        </div>

        <div className='space-y-1.5'>
          <label htmlFor={cssValueInputId} className='text-xs text-muted-foreground'>
            CSS 颜色值
          </label>
          <Input
            id={cssValueInputId}
            value={draftValue}
            placeholder='#67C6D9、rgba(...) 或 var(...)'
            className='h-8 font-mono text-xs'
            onChange={event => setDraftValue(event.currentTarget.value)}
            onBlur={event => {
              if (skipNextBlurCommit.current) {
                skipNextBlurCommit.current = false
                return
              }
              commitValue(event.currentTarget.value)
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                skipNextBlurCommit.current = true
                setDraftValue(currentValue)
                event.currentTarget.blur()
              }
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ColorSetter
