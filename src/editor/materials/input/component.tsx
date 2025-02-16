import { Input as UInput } from '@/components/ui/input'
import type { Ref } from 'react'

interface InputProps {
  ref: Ref<HTMLInputElement>
}

const Input = (props: InputProps) => {
  const { ref } = props

  return <UInput ref={ref} className='w-full h-full' placeholder='Input...' />
}

export default Input
