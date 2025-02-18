import type { Ref } from 'react'
import { Button as UButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  text?: string
  onClick?: () => void
  className?: string
}

const Button = (props: ButtonProps) => {
  const { ref, text, onClick, className } = props

  return (
    <UButton ref={ref} className={cn('w-full h-full', className)} onClick={onClick}>
      {text}
    </UButton>
  )
}

export default Button
