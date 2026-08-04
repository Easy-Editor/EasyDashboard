import type { ReactNode } from 'react'

type ViewerStateProps = {
  code?: string
  title: string
  detail?: string
  actionLabel?: string
  onAction?: () => void
  tone?: 'status' | 'error'
  children?: ReactNode
}

export function ViewerState({ title, detail, actionLabel, onAction, tone = 'status', children }: ViewerStateProps) {
  return (
    <main
      data-ed-shell='viewer'
      className='grid min-h-screen w-full place-items-center bg-[var(--ed-canvas)] p-6 text-[var(--ed-ink)]'
    >
      <section
        role={tone === 'error' ? 'alert' : 'status'}
        className='w-full max-w-lg border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-7 py-6 text-left shadow-[0_24px_80px_rgb(0_0_0/0.34)]'
      >
        <h1 className='text-base font-medium text-[var(--ed-ink)]'>{title}</h1>
        {detail ? <p className='mt-2 max-w-md text-xs leading-5 text-[var(--ed-ink-muted)]'>{detail}</p> : null}
        {children}
        {actionLabel && onAction ? (
          <button
            type='button'
            onClick={onAction}
            className='mt-5 h-8 rounded-[7px] bg-[var(--ed-ink)] px-3 text-xs font-medium text-[var(--ed-canvas)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ed-panel)]'
          >
            {actionLabel}
          </button>
        ) : null}
      </section>
    </main>
  )
}
