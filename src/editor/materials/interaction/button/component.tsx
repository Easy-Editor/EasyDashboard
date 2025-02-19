import { Button as UButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Ref } from 'react'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  text?: string
  onClick?: () => void
  className?: string
  textDirection?: 'horizontal' | 'vertical'
}

const Button = (props: ButtonProps) => {
  const { ref, text, onClick, className, textDirection = 'horizontal' } = props

  return (
    <UButton
      ref={ref}
      className={cn('w-full h-full flex items-center justify-center writing-mode', className)}
      style={{
        writingMode: textDirection === 'horizontal' ? 'horizontal-tb' : 'vertical-lr',
      }}
      onClick={onClick}
      aria-label={text}
      tabIndex={0}
    >
      {text}
    </UButton>
  )
}

export default Button
