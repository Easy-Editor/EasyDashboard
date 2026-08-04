import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

type PageFrameProps = {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
  size?: 'standard' | 'wide'
}

export function PageFrame({ title, description, action, children, size = 'wide' }: PageFrameProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-8 py-10 xl:py-12',
        size === 'standard' ? 'max-w-[1240px]' : 'max-w-[1600px] xl:px-12',
      )}
    >
      <header className='flex min-h-[72px] items-end justify-between gap-6 border-b border-[var(--ed-line)] pb-5'>
        <div className='min-w-0'>
          <h1 className='font-[var(--font-display)] text-[28px] leading-none font-medium tracking-[-0.025em] text-[var(--ed-ink)]'>
            {title}
          </h1>
          <p className='mt-2 max-w-2xl text-[13px] leading-5 text-[var(--ed-ink-muted)]'>{description}</p>
        </div>
        {action ? <div className='shrink-0'>{action}</div> : null}
      </header>
      {children}
    </div>
  )
}
