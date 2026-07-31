import type { ReactNode } from 'react'

type ViewerStateProps = {
  code: string
  title: string
  detail?: string
  actionLabel?: string
  onAction?: () => void
  tone?: 'status' | 'error'
  children?: ReactNode
}

export function ViewerState({
  code,
  title,
  detail,
  actionLabel,
  onAction,
  tone = 'status',
  children,
}: ViewerStateProps) {
  return (
    <main
      data-ed-shell='viewer'
      className='relative grid min-h-screen place-items-center overflow-hidden bg-[var(--ed-canvas)] p-6 text-[var(--ed-ink)]'
    >
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 opacity-45 [background-image:linear-gradient(var(--ed-line)_1px,transparent_1px),linear-gradient(90deg,var(--ed-line)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(circle_at_center,black,transparent_76%)]'
      />
      <section
        role={tone === 'error' ? 'alert' : 'status'}
        className='relative w-full max-w-[460px] border border-[var(--ed-line-strong)] bg-[color-mix(in_srgb,var(--ed-panel)_94%,transparent)] p-7 shadow-2xl backdrop-blur'
      >
        <div className='flex items-center justify-between gap-6 border-b border-[var(--ed-line)] pb-4'>
          <span className='font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ed-cyan)]'>{code}</span>
          <span className='size-2 rotate-45 border border-[var(--ed-cyan)]' aria-hidden='true' />
        </div>
        <h1 className='mt-6 font-[var(--font-display)] text-[24px] leading-tight font-medium tracking-[-0.025em]'>
          {title}
        </h1>
        {detail ? <p className='mt-3 text-[13px] leading-6 text-[var(--ed-ink-muted)]'>{detail}</p> : null}
        {children}
        {actionLabel && onAction ? (
          <button
            type='button'
            onClick={onAction}
            className='mt-6 h-9 border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] px-4 text-[12px] text-[var(--ed-ink-soft)] transition-colors hover:border-[var(--ed-cyan)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
          >
            {actionLabel}
          </button>
        ) : null}
      </section>
    </main>
  )
}
