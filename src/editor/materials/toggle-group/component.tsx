import { ToggleGroup as UToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Bold, Italic, Underline } from 'lucide-react'
import type { Ref } from 'react'

interface ToggleGroupProps {
  ref: Ref<HTMLDivElement>
}

const ToggleGroup = (props: ToggleGroupProps) => {
  const { ref } = props

  return (
    <UToggleGroup ref={ref} className='w-full h-full' type='single'>
      <ToggleGroupItem value='bold' aria-label='Toggle bold'>
        <Bold className='h-4 w-4' />
      </ToggleGroupItem>
      <ToggleGroupItem value='italic' aria-label='Toggle italic'>
        <Italic className='h-4 w-4' />
      </ToggleGroupItem>
      <ToggleGroupItem value='strikethrough' aria-label='Toggle strikethrough'>
        <Underline className='h-4 w-4' />
      </ToggleGroupItem>
    </UToggleGroup>
  )
}

export default ToggleGroup
