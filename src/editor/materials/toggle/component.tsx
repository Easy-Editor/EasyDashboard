import { Toggle as UToggle } from '@/components/ui/toggle'
import { Bold } from 'lucide-react'
import type { Ref } from 'react'

interface ToggleProps {
  ref: Ref<HTMLButtonElement>
}

const Toggle = (props: ToggleProps) => {
  const { ref } = props

  return (
    <UToggle ref={ref} className='w-full h-full' aria-label='Toggle italic'>
      <Bold className='h-4 w-4' />
    </UToggle>
  )
}

export default Toggle
