import logoUrl from '@/assets/logo.svg'
import { cn } from '@/lib/utils'

type BrandMarkProps = {
  compact?: boolean
  className?: string
}

export function BrandMark({ compact = false, className }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-2.5 text-[var(--ed-ink)]', className)}>
      <span aria-hidden='true' className='relative grid size-8 shrink-0 place-items-center'>
        <span className='absolute inset-0 rounded-[8px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)]' />
        <img src={logoUrl} alt='' className='relative h-[20px] w-[24px] brightness-0 invert' />
      </span>
      {!compact && (
        <span className='font-[var(--font-display)] text-[15px] font-semibold tracking-[-0.01em]'>EasyDashboard</span>
      )}
    </div>
  )
}
