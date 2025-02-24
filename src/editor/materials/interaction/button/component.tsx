import { Button as UButton, type buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { Ref } from 'react'

interface ButtonProps {
  ref: Ref<HTMLButtonElement>
  content?: string
  onClick?: () => void
  className?: string
  textDirection?: 'horizontal' | 'vertical'
  variant?: VariantProps<typeof buttonVariants>['variant']
  loading?: boolean
  horizontalAlign?: 'flex-start' | 'center' | 'flex-end'
  verticalAlign?: 'flex-start' | 'center' | 'flex-end'
  radius?: number
  text?: {
    fontFamily?: string
    fontSize?: number
    color?: string
    fontWeight?: boolean
    fontStyle?: boolean
    letterSpacing?: number
    lineHeight?: number
  }
}

const Button = (props: ButtonProps) => {
  const {
    ref,
    content,
    onClick,
    className,
    textDirection = 'horizontal',
    variant = 'default',
    loading = false,
    horizontalAlign = 'center',
    verticalAlign = 'center',
    radius = 6,
    text,
  } = props
  const {
    fontFamily = 'Arial',
    fontSize = 16,
    color = '#000000',
    fontWeight = false,
    fontStyle = false,
    letterSpacing = 0,
    lineHeight = 18,
  } = text || {}

  return (
    <UButton
      ref={ref}
      className={cn('w-full h-full flex writing-mode', className)}
      style={{
        borderRadius: radius,
        writingMode: textDirection === 'horizontal' ? 'horizontal-tb' : 'vertical-lr',
        justifyContent: horizontalAlign,
        alignItems: verticalAlign,
        fontFamily,
        fontSize,
        color,
        fontWeight: fontWeight ? 'bold' : 'normal',
        fontStyle: fontStyle ? 'italic' : 'normal',
        letterSpacing,
        lineHeight,
      }}
      onClick={onClick}
      aria-label={content}
      tabIndex={0}
      variant={variant}
      disabled={loading}
    >
      {loading && <Loader2 className='w-4 h-4 animate-spin' />}
      {content}
    </UButton>
  )
}

export default Button
