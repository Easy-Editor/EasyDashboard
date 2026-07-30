import type { ReactNode } from 'react'

type PageFrameProps = {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}

export function PageFrame({ eyebrow, title, description, action, children }: PageFrameProps) {
  return (
    <div className='mx-auto w-full max-w-[1600px] px-10 py-9 xl:px-12'>
      <header className='flex min-h-[76px] items-end justify-between gap-8 border-b border-[var(--ed-line)] pb-6'>
        <div>
          <p className='font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ed-cyan)]'>{eyebrow}</p>
          <h1 className='mt-2 font-[var(--font-display)] text-[28px] leading-none font-medium tracking-[-0.035em] text-[var(--ed-ink)]'>
            {title}
          </h1>
          <p className='mt-2 max-w-2xl text-[13px] leading-5 text-[var(--ed-ink-muted)]'>{description}</p>
        </div>
        {action}
      </header>
      {children}
    </div>
  )
}
