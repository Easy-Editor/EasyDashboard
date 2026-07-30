export function PreviewState({
  title,
  detail,
  action,
}: {
  title: string
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div
      data-ed-shell='preview'
      className='grid h-full min-h-screen w-full place-items-center bg-[var(--ed-canvas)] p-6 text-[var(--ed-ink)]'
    >
      <div className='border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-6 py-5 text-center'>
        <p className='text-sm font-medium text-[var(--ed-ink)]'>{title}</p>
        {detail ? <p className='mt-2 max-w-md text-xs text-[var(--ed-ink-muted)]'>{detail}</p> : null}
        {action ? <div className='mt-4'>{action}</div> : null}
      </div>
    </div>
  )
}
