import type { Ref } from 'react'
import { Button as UButton } from '@/components/ui/button'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  text?: string
  onClick?: () => void
}

const Button = (props: ButtonProps) => {
  const { ref, text, onClick, ...rest } = props

  return (
    <UButton ref={ref} className='w-full h-full' onClick={onClick} {...rest}>
      {text}
    </UButton>
  )
}

export default Button
