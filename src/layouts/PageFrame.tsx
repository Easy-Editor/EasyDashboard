import type { ReactNode } from 'react'

type PageFrameProps = {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}

export function PageFrame({ eyebrow, title, description, action, children }: PageFrameProps) {
  return (
    <div className='mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 md:px-10 md:py-10 xl:px-12'>
      <header className='flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <p className='font-mono text-[10px] uppercase tracking-[0.16em] text-[#67C6D9]'>{eyebrow}</p>
          <h1 className='mt-3 font-[Alibaba_PuHuiTi] text-2xl font-medium tracking-[-0.02em] text-[#F1F5F7] sm:text-[30px]'>
            {title}
          </h1>
          <p className='mt-2 max-w-2xl text-sm leading-6 text-[#7F8B95]'>{description}</p>
        </div>
        {action}
      </header>
      {children}
    </div>
  )
}
