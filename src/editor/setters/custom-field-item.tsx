import { Label } from '@/components/ui/label'
import type { SettingField } from '@easy-editor/core'
import type { ReactNode } from 'react'

export const customFieldItem = (field: SettingField, setter: ReactNode) => {
  if (typeof field.config.extraProps?.label === 'boolean' && !field.config.extraProps?.label) {
    return <div className='flex w-full items-center'>{setter}</div>
  }

  return (
    <div className='flex w-full items-center text-xs'>
      <Label className='basis-[100px] text-xs' htmlFor={field.id}>
        {field.title}
      </Label>
      {setter}
    </div>
  )
}
