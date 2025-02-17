import { Select as USelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Ref } from 'react'

interface SelectProps {
  ref: Ref<HTMLDivElement>
}

const Select = (props: SelectProps) => {
  const { ref } = props

  return (
    <USelect>
      <SelectTrigger className='w-full h-full'>
        <SelectValue ref={ref} placeholder='Theme' />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='light'>Light</SelectItem>
        <SelectItem value='dark'>Dark</SelectItem>
        <SelectItem value='system'>System</SelectItem>
      </SelectContent>
    </USelect>
  )
}

export default Select
