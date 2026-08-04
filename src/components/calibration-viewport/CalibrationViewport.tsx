import { cn } from '@/lib/utils'

type PreviewKind = 'commerce' | 'operations' | 'traffic' | 'blank'

type CalibrationViewportProps = {
  width?: number
  height?: number
  state?: string
  scale?: string
  preview?: PreviewKind
  className?: string
  compact?: boolean
}

const chartBars = [42, 58, 46, 74, 62, 88, 72, 92, 78, 96]

function PreviewArtwork({ preview }: { preview: PreviewKind }) {
  if (preview === 'blank') {
    return (
      <div className='grid h-full place-items-center'>
        <div className='flex flex-col items-center gap-2 text-[#65717D]'>
          <span className='size-8 border border-dashed border-[#3A4652]' />
          <span className='text-[11px]'>等待添加内容</span>
        </div>
      </div>
    )
  }

  return (
    <div className='grid h-full grid-cols-[1.55fr_1fr] gap-[3%] p-[5%]'>
      <div className='flex min-w-0 flex-col gap-[6%]'>
        <div className='grid grid-cols-3 gap-[3%]'>
          {chartBars.slice(0, 3).map((height, index) => (
            <div key={height} className='rounded-[2px] border border-[#29343E] bg-[#111820] p-[8%]'>
              <div className='mb-[14%] h-[3px] w-1/2 rounded-full bg-[#475762]' />
              <div
                className={cn('h-[3px] rounded-full', index === 1 ? 'bg-[#67C6D9]' : 'bg-[#A7B7C2]')}
                style={{ width: `${height}%` }}
              />
            </div>
          ))}
        </div>
        <div className='relative min-h-0 flex-1 overflow-hidden rounded-[2px] border border-[#29343E] bg-[#10171E]'>
          <div className='absolute inset-x-[8%] bottom-[12%] top-[14%] flex items-end justify-between gap-[3%]'>
            {chartBars.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className={cn('w-full rounded-t-[1px]', index > 6 ? 'bg-[#67C6D9]/80' : 'bg-[#344550]')}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className='absolute inset-x-[8%] top-[18%] h-px bg-[#2A333D]' />
          <div className='absolute inset-x-[8%] top-1/2 h-px bg-[#2A333D]' />
        </div>
      </div>
      <div className='flex min-w-0 flex-col gap-[6%]'>
        <div className='relative flex-1 overflow-hidden rounded-[2px] border border-[#29343E] bg-[#10171E]'>
          {preview === 'traffic' ? (
            <>
              <div className='absolute left-[15%] top-[12%] h-[80%] w-px rotate-[22deg] bg-[#415462]' />
              <div className='absolute left-[48%] top-[5%] h-[90%] w-px -rotate-[16deg] bg-[#67C6D9]/80' />
              <div className='absolute right-[17%] top-[8%] h-[86%] w-px rotate-[31deg] bg-[#526876]' />
              <div className='absolute left-[8%] top-1/2 h-px w-[84%] -rotate-[8deg] bg-[#33444F]' />
            </>
          ) : (
            <div className='absolute left-1/2 top-1/2 size-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-[#24313A] border-r-[#67C6D9]' />
          )}
        </div>
        <div className='h-[30%] rounded-[2px] border border-[#29343E] bg-[#10171E] p-[8%]'>
          <div className='mb-[10%] h-[3px] w-[62%] bg-[#475762]' />
          <div className='h-[3px] w-[84%] bg-[#2F3B45]' />
        </div>
      </div>
    </div>
  )
}

export function CalibrationViewport({
  width = 1920,
  height = 1080,
  state = '草稿',
  scale = '100%',
  preview = 'commerce',
  className,
}: CalibrationViewportProps) {
  const stateLabel = state.trim().toUpperCase() === 'DRAFT' ? '草稿' : state

  return (
    <div
      className={cn(
        'group relative aspect-video overflow-hidden rounded-[14px] border border-[#2A333D] bg-[#0C1015]',
        'focus-within:ring-2 focus-within:ring-[#67C6D9] focus-within:ring-offset-2 focus-within:ring-offset-[#080A0D]',
        className,
      )}
    >
      <div className='absolute inset-x-0 top-0 z-10 flex h-7 items-center border-b border-[#202932] bg-[#0F1318]/95 px-3 font-mono text-[11px] tracking-[0.04em] text-[#82909B]'>
        <span>
          {width} × {height} · {stateLabel}
        </span>
      </div>
      <div className='absolute inset-x-0 bottom-0 z-10 flex h-6 items-center justify-between border-t border-[#202932] bg-[#0F1318]/95 px-3 font-mono text-[11px] text-[#65717D]'>
        <span>0,0</span>
        <span>{scale}</span>
      </div>
      <div className='absolute inset-x-0 bottom-0 z-20 h-px origin-left scale-x-0 bg-[#67C6D9] transition-transform duration-180 group-hover:scale-x-100 motion-reduce:transition-none' />
      <div className='absolute inset-x-0 bottom-6 top-7'>
        <PreviewArtwork preview={preview} />
      </div>
      <span className='absolute left-3 top-10 z-20 size-3 border-l border-t border-[#67C6D9]/70 transition-transform duration-180 group-hover:translate-x-1 group-hover:translate-y-1 motion-reduce:transition-none' />
      <span className='absolute right-3 top-10 z-20 size-3 border-r border-t border-[#67C6D9]/70 transition-transform duration-180 group-hover:-translate-x-1 group-hover:translate-y-1 motion-reduce:transition-none' />
      <span className='absolute bottom-9 left-3 z-20 size-3 border-b border-l border-[#67C6D9]/70 transition-transform duration-180 group-hover:translate-x-1 group-hover:-translate-y-1 motion-reduce:transition-none' />
      <span className='absolute bottom-9 right-3 z-20 size-3 border-b border-r border-[#67C6D9]/70 transition-transform duration-180 group-hover:-translate-x-1 group-hover:-translate-y-1 motion-reduce:transition-none' />
      <span className='absolute left-1/2 top-7 z-20 h-1.5 w-px -translate-x-1/2 bg-[#67C6D9]/70' />
    </div>
  )
}
