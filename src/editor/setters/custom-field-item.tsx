import { Label } from '@/components/ui/label'
import type { SettingField } from '@easy-editor/core'
import type { ReactNode } from 'react'

export const customFieldItem = (field: SettingField, setter: ReactNode) => {
  return (
    <div className='flex w-full items-center'>
      <Label className='basis-[100px]' htmlFor={field.id}>
        {field.title}
      </Label>
      {setter}
    </div>
  )
}
