import { cn } from '@/lib/utils'

type BrandMarkProps = {
  compact?: boolean
  className?: string
}

export function BrandMark({ compact = false, className }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-2.5 text-[#F1F5F7]', className)}>
      <span
        aria-hidden='true'
        className='relative grid size-7 shrink-0 place-items-center rounded-[6px] border border-[#2A333D] bg-[#171D24]'
      >
        <span className='size-2.5 rotate-45 border border-[#67C6D9]' />
      </span>
      {!compact && (
        <span className='font-[Alibaba_PuHuiTi] text-[15px] font-semibold tracking-[0.01em]'>EasyDashboard</span>
      )}
    </div>
  )
}
