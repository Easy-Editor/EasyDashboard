import { Button } from '@/components/ui/button'
import { Loader2, RotateCcw } from 'lucide-react'

export type RestorePointListState = 'loading' | 'error' | 'empty' | 'content'

export function resolveRestorePointListState({
  isLoading,
  loadError,
  restorePointCount,
}: {
  isLoading: boolean
  loadError: string | null
  restorePointCount: number
}): RestorePointListState {
  if (restorePointCount > 0) return 'content'
  if (loadError) return 'error'
  if (isLoading) return 'loading'
  return 'empty'
}

export function RestorePointsLoadError({
  message,
  retrying,
  onRetry,
}: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <div
      role='alert'
      className='mb-3 rounded-[var(--ed-radius-control)] border border-[color-mix(in_srgb,var(--ed-danger)_45%,var(--ed-line))] bg-[color-mix(in_srgb,var(--ed-danger)_8%,var(--ed-panel))] p-3'
    >
      <p className='text-[11px] font-medium text-[var(--ed-ink)]'>版本记录读取失败</p>
      <p className='mt-1 text-[11px] leading-4 text-[var(--ed-ink-muted)]'>{message}</p>
      <Button
        type='button'
        size='sm'
        variant='outline'
        className='mt-3 h-7 gap-1.5 border-[var(--ed-line-strong)] bg-transparent px-2.5 text-[11px] text-[var(--ed-ink)] hover:bg-[var(--ed-panel-raised)] hover:text-white'
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? <Loader2 className='size-3 animate-spin' /> : <RotateCcw className='size-3' />}
        {retrying ? '正在重试' : '重新读取'}
      </Button>
    </div>
  )
}
