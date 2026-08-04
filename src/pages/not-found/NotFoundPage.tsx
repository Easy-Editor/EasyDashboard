import { BrandMark } from '@/components/brand/BrandMark'
import { Button } from '@/components/ui/button'
import { ArrowLeft, FolderKanban } from 'lucide-react'
import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <main
      data-ed-shell='app'
      className='relative grid min-h-screen min-w-[1024px] place-items-center overflow-hidden bg-[var(--ed-canvas)] px-10 text-[var(--ed-ink)]'
      aria-labelledby='not-found-title'
    >
      <div className='ed-auth-grid pointer-events-none absolute inset-0 opacity-70' />
      <div className='pointer-events-none absolute left-10 top-8'>
        <BrandMark />
      </div>

      <section className='relative w-full max-w-[720px] border-y border-[var(--ed-line)] py-14 text-center'>
        <h1
          id='not-found-title'
          className='font-[var(--font-display)] text-[clamp(76px,10vw,132px)] font-medium leading-[0.8] tracking-[-0.04em] text-[var(--ed-ink)]'
        >
          404
        </h1>
        <p className='mt-8 text-[22px] font-medium tracking-[-0.025em] text-[var(--ed-ink-soft)]'>这个页面不在画布上</p>
        <p className='mx-auto mt-3 max-w-md text-[13px] leading-6 text-[var(--ed-ink-muted)]'>
          地址可能已经失效，或页面已被移动。你的项目和已保存内容不会受到影响。
        </p>

        <div className='mt-8 flex items-center justify-center gap-3'>
          <Button
            asChild
            className='h-10 rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] px-5 text-[#07111d] hover:bg-white'
          >
            <Link to='/'>
              <ArrowLeft className='size-4' />
              返回工作台
            </Link>
          </Button>
          <Button
            asChild
            variant='outline'
            className='h-10 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-5 text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
          >
            <Link to='/projects'>
              <FolderKanban className='size-4' />
              查看项目
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
