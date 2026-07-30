import { Button } from '@/components/ui/button'

export function PreviewState({
  title,
  detail,
  action,
  eyebrow = 'PREVIEW STATUS',
  tone = 'neutral',
}: {
  title: string
  detail?: string
  action?: React.ReactNode
  eyebrow?: string
  tone?: 'neutral' | 'error'
}) {
  return (
    <div
      data-ed-shell='preview'
      data-preview-state={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      className='grid h-full min-h-screen w-full place-items-center bg-[var(--ed-canvas)] p-6 text-[var(--ed-ink)]'
    >
      <div className='relative w-full max-w-lg border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-7 py-6 text-left shadow-[0_24px_80px_rgb(0_0_0/0.34)]'>
        <span
          aria-hidden='true'
          className='absolute left-0 top-0 h-8 w-px bg-[var(--ed-cyan)] shadow-[0_0_12px_color-mix(in_srgb,var(--ed-cyan)_58%,transparent)]'
        />
        <p
          className={
            tone === 'error'
              ? 'font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ed-error)]'
              : 'font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--ed-cyan)]'
          }
        >
          {eyebrow}
        </p>
        <p className='mt-3 text-base font-medium text-[var(--ed-ink)]'>{title}</p>
        {detail ? <p className='mt-2 max-w-md text-xs leading-5 text-[var(--ed-ink-muted)]'>{detail}</p> : null}
        {action ? <div className='mt-5 flex flex-wrap items-center gap-2'>{action}</div> : null}
      </div>
    </div>
  )
}

export function PreviewRenderFailure({
  pageLabel,
  error,
  onRetry,
}: {
  pageLabel: string
  error: Error
  onRetry: () => void
}) {
  return (
    <PreviewState
      tone='error'
      eyebrow='RENDER INTERRUPTED'
      title={`页面「${pageLabel}」渲染失败`}
      detail={`${error.message || '页面组件未能完成渲染'}。页面选择与编辑器入口仍可使用。`}
      action={
        <Button
          type='button'
          size='sm'
          className='rounded-[7px] bg-[var(--ed-ink)] text-xs text-[var(--ed-canvas)] hover:bg-white'
          onClick={onRetry}
        >
          重试渲染
        </Button>
      }
    />
  )
}
