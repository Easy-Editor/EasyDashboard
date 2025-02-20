import { Button as UButton, type buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { Ref } from 'react'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  text?: string
  onClick?: () => void
  className?: string
  textDirection?: 'horizontal' | 'vertical'
  variant?: VariantProps<typeof buttonVariants>['variant']
  loading?: boolean
}

const Button = (props: ButtonProps) => {
  const { ref, text, onClick, className, textDirection = 'horizontal', variant = 'default', loading = false } = props

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
      variant={variant}
      disabled={loading}
    >
      {loading && <Loader2 className='w-4 h-4 animate-spin' />}
      {text}
    </UButton>
  )
}

export default Button
