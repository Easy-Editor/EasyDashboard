import { BrandMark } from '@/components/brand/BrandMark'
import { FolderKanban, Maximize2, Send } from 'lucide-react'
import { Outlet } from 'react-router'

const productHighlights = [
  {
    icon: FolderKanban,
    title: '集中管理项目',
    description: '从个人空间进入每一个数据大屏，草稿和发布状态一目了然。',
  },
  {
    icon: Maximize2,
    title: '按目标分辨率设计',
    description: '自由设置画布尺寸，预览与发布页面自动保持等比例展示。',
  },
  {
    icon: Send,
    title: '发布并分享',
    description: '确认效果后生成独立访问地址，直接查看或分享已发布大屏。',
  },
]

export function AuthLayout() {
  return (
    <main className='min-h-screen bg-[#080A0D] text-[#F1F5F7]'>
      <div className='grid min-h-screen lg:grid-cols-[58fr_42fr]'>
        <section className='relative hidden min-h-screen overflow-hidden border-r border-[#2A333D] p-12 lg:flex lg:flex-col xl:p-16'>
          <BrandMark />
          <div className='my-auto w-full max-w-3xl'>
            <p className='mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[#67C6D9]'>
              Visual dashboard workspace
            </p>
            <h2 className='max-w-2xl font-[Alibaba_PuHuiTi] text-4xl leading-tight font-medium tracking-[-0.025em] text-[#F1F5F7] xl:text-5xl'>
              从画布到发布，
              <br />
              完成你的数据大屏。
            </h2>
            <p className='mt-5 max-w-lg text-sm leading-6 text-[#84919B]'>
              在一个清晰的工作流里管理项目、编辑内容、预览效果，并把最终结果发布成可访问的页面。
            </p>
            <div className='mt-10 grid max-w-2xl gap-px overflow-hidden rounded-[10px] border border-[#2A333D] bg-[#2A333D] sm:grid-cols-3'>
              {productHighlights.map(({ icon: Icon, title, description }) => (
                <div key={title} className='bg-[#0F1318] p-5'>
                  <span className='grid size-9 place-items-center rounded-[7px] bg-[#171D24] text-[#67C6D9]'>
                    <Icon className='size-4' aria-hidden='true' />
                  </span>
                  <h3 className='mt-5 text-sm font-medium text-[#E7EDF1]'>{title}</h3>
                  <p className='mt-2 text-xs leading-5 text-[#71808B]'>{description}</p>
                </div>
              ))}
            </div>
          </div>
          <p className='font-mono text-[10px] tracking-[0.12em] text-[#53606B]'>EASYDASHBOARD</p>
        </section>
        <section className='flex min-h-screen items-center justify-center px-6 py-10 sm:px-10 lg:px-12'>
          <div className='w-full max-w-[380px]'>
            <div className='mb-10 lg:hidden'>
              <BrandMark />
            </div>
            <Outlet />
          </div>
        </section>
      </div>
    </main>
  )
}
