import type { TemplateSummary } from '@/api/contracts'
import { Button } from '@/components/ui/button'
import { listTemplates } from '@/features/projects/project-api'
import { PageFrame } from '@/layouts/PageFrame'
import type { ProjectSchema } from '@easy-editor/core'
import { ArrowUpRight, LayoutTemplate } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

export function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary<ProjectSchema>[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listTemplates()
      .then(response => setTemplates(response.templates))
      .catch(() => setError('模板加载失败，请稍后重试'))
  }, [])

  return (
    <PageFrame
      eyebrow='模板中心'
      title='从模板开始'
      description='从经过整理的画布结构开始，再替换为自己的数据和视觉规范。'
    >
      <div className='mt-10 flex items-center justify-between border-y border-[#222B34] py-4'>
        <p className='text-sm text-[#9AA6AF]'>全部模板</p>
        <p className='font-mono text-[10px] text-[#65717D]'>{templates.length} TEMPLATES</p>
      </div>
      <div className='mt-7 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5'>
        {error ? (
          <p role='alert' className='text-sm text-[#E98D8D]'>
            {error}
          </p>
        ) : null}
        {templates.map(template => (
          <article key={template.id} className='overflow-hidden rounded-[10px] border border-[#2A333D] bg-[#0F1318]'>
            <div className='relative grid aspect-video place-items-center border-b border-[#2A333D] bg-[#0A0D11]'>
              <div className='grid size-12 place-items-center rounded-[8px] border border-[#26313A] bg-[#11171D] text-[#71808B]'>
                <LayoutTemplate className='size-5' aria-hidden='true' />
              </div>
              <span className='absolute bottom-3 left-3 font-mono text-[10px] text-[#65717D]'>
                {template.resolution.width} × {template.resolution.height}
              </span>
            </div>
            <div className='p-4'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <p className='font-mono text-[9px] uppercase tracking-[0.1em] text-[#67C6D9]'>{template.category}</p>
                  <h2 className='mt-2 font-[Alibaba_PuHuiTi] text-[15px] font-semibold text-[#F1F5F7]'>
                    {template.name}
                  </h2>
                </div>
                <Button
                  asChild
                  variant='ghost'
                  size='icon'
                  className='min-h-11 min-w-11 text-[#7F8B95] hover:bg-[#171D24] hover:text-white'
                >
                  <Link to={`/projects?template=${template.id}`} aria-label={`使用模板：${template.name}`}>
                    <ArrowUpRight />
                  </Link>
                </Button>
              </div>
              <p className='mt-2 text-xs leading-5 text-[#7F8B95]'>{template.description}</p>
              <p className='mt-4 font-mono text-[10px] text-[#65717D]'>
                {template.resolution.width} × {template.resolution.height}
              </p>
            </div>
          </article>
        ))}
      </div>
    </PageFrame>
  )
}
