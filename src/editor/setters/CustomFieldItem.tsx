import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { SettingField } from '@easy-editor/core'
import type { ReactNode } from 'react'
import { VariableBind } from './VariableBind'

export const customFieldItem = (field: SettingField, setter: ReactNode) => {
  const { label = true, wrap = false, supportVariable = false } = field.config.extraProps || {}

  if (typeof label === 'boolean' && !label) {
    return <div className='flex w-full min-w-0 items-center'>{setter}</div>
  }

  return (
    <div className={cn('flex w-full min-w-0 max-w-full text-xs', wrap ? 'flex-col' : 'items-center')}>
      <Label
        className={cn('shrink-0 grow-0 text-xs text-[var(--ed-ink-muted)]', wrap ? 'basis-[26px]' : 'basis-[100px]')}
        htmlFor={field.id}
      >
        {field.title}
      </Label>
      <div className='flex min-w-0 w-full flex-1 items-center justify-between'>
        <div className='min-w-0 max-w-full flex-1'>{setter}</div>
        {supportVariable && <VariableBind field={field} />}
      </div>
    </div>
  )
}
