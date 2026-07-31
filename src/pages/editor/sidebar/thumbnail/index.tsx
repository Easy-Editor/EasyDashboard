import { Button } from '@/components/ui/button'
import { useEditorThumbnail } from '@/features/thumbnails/EditorThumbnailProvider'
import { ImagePlus, RefreshCw } from 'lucide-react'
import { useRef } from 'react'

const statusLabel = {
  queued: '等待生成',
  rendering: '正在生成',
  ready: '封面已就绪',
  failed: '生成失败',
} as const

export function ThumbnailSidebar() {
  const { retry, state, uploadCustomThumbnail, useCanvasThumbnail } = useEditorThumbnail()
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = state.status === 'queued' || state.status === 'rendering'

  return (
    <div className='flex flex-col gap-4 p-3 text-[#DCE5EA]'>
      <div className='overflow-hidden rounded-md border border-[#252D35] bg-[#080A0D]'>
        {state.imageUrl ? (
          <img className='aspect-video w-full object-cover' src={state.imageUrl} alt='当前项目封面' />
        ) : (
          <div className='grid aspect-video place-items-center text-xs text-[#71808B]'>暂无封面</div>
        )}
      </div>

      <div aria-live={state.status === 'failed' ? 'assertive' : 'polite'} className='space-y-1'>
        <div className='flex items-center justify-between text-xs'>
          <span className='text-[#8D99A3]'>状态</span>
          <span className={state.status === 'failed' ? 'text-[#F18F8F]' : 'text-[#B8C4CB]'}>
            {statusLabel[state.status]}
          </span>
        </div>
        {state.error ? <p className='text-xs leading-5 text-[#F18F8F]'>{state.error}</p> : null}
      </div>

      <input
        ref={inputRef}
        className='sr-only'
        type='file'
        accept='image/jpeg,image/png,image/webp'
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void uploadCustomThumbnail(file).catch(() => undefined)
        }}
      />
      <Button
        type='button'
        variant='outline'
        disabled={busy}
        className='justify-start border-[#303A44] bg-[#151A20] text-[#DCE5EA] hover:bg-[#1C232B]'
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus className='size-4' />
        上传自定义封面
      </Button>

      <Button
        type='button'
        variant='ghost'
        disabled={busy}
        className='justify-start text-[#8FBFCA] hover:bg-[#17222C] hover:text-[#BEE7EF]'
        onClick={() => void useCanvasThumbnail().catch(() => undefined)}
      >
        <RefreshCw className='size-4' />
        {state.mode === 'custom' ? '使用画布缩略图' : '重新生成'}
      </Button>

      {state.status === 'failed' ? (
        <Button
          type='button'
          variant='ghost'
          className='justify-start text-[#DCE5EA] hover:bg-[#171D24]'
          onClick={() => {
            if (state.mode === 'custom') {
              inputRef.current?.click()
              return
            }
            void retry().catch(() => undefined)
          }}
        >
          {state.mode === 'custom' ? '重新选择图片' : '重试'}
        </Button>
      ) : null}
    </div>
  )
}
