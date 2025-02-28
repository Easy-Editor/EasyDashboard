import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { SettingField } from '@easy-editor/core'
import type { ReactNode } from 'react'

declare module '@easy-editor/core' {
  interface FieldExtraProps {
    /**
     * 是否显示 label
     * @default true
     */
    label?: boolean

    /**
     * 是否换行
     * @default false
     */
    wrap?: boolean
  }
}

export const customFieldItem = (field: SettingField, setter: ReactNode) => {
  if (typeof field.config.extraProps?.label === 'boolean' && !field.config.extraProps?.label) {
    return <div className='flex w-full items-center'>{setter}</div>
  }

  return (
    <div className={cn('flex w-full text-xs', field.config.extraProps?.wrap ? 'flex-col' : 'items-center ')}>
      <Label
        className={cn('text-xs shrink-0 grow-0', field.config.extraProps?.wrap ? 'basis-[26px]' : 'basis-[100px]')}
        htmlFor={field.id}
      >
        {field.title}
      </Label>
      {setter}
    </div>
  )
}
