import type * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot='input'
      className={cn(
        'flex h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-all duration-200 [transition-timing-function:var(--ease-out)]',
        'placeholder:text-muted-foreground',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'selection:bg-primary selection:text-primary-foreground',
        'hover:border-border-strong',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-foreground',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive/60 aria-invalid:ring-destructive/20 aria-invalid:focus-visible:ring-destructive/20',
        'dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/40 dark:aria-invalid:focus-visible:ring-destructive/40',
        'md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
