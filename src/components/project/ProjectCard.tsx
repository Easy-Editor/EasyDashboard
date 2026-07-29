import type { ProjectSummary } from '@/api/contracts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { getPublishedProjectUrl } from '@/features/projects/public-viewer'
import { Copy, ExternalLink, LayoutDashboard, MoreHorizontal, Pencil } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const publishedHref = project.slug ? getPublishedProjectUrl(project.slug) : null

  async function copyPublishedLink() {
    if (!publishedHref) return
    try {
      await navigator.clipboard.writeText(publishedHref)
      toast.success('发布链接已复制')
    } catch {
      toast.error('复制失败，请打开发布页后复制地址')
    }
  }

  return (
    <article className='group/card overflow-hidden rounded-[10px] border border-[#2A333D] bg-[#0F1318] transition-[transform,border-color] duration-180 hover:-translate-y-0.5 hover:border-[#3A4855] motion-reduce:transition-none'>
      <Link
        to={`/projects/${project.id}/editor`}
        className='block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67C6D9] focus-visible:ring-inset'
        aria-label={`打开项目：${project.name}`}
      >
        <div className='relative grid aspect-video place-items-center overflow-hidden border-b border-[#2A333D] bg-[#0A0D11] transition-colors group-hover/card:bg-[#0C1015]'>
          <div className='grid size-12 place-items-center rounded-[8px] border border-[#26313A] bg-[#11171D] text-[#71808B] transition-colors group-hover/card:border-[#354552] group-hover/card:text-[#9AABB6]'>
            <LayoutDashboard className='size-5' />
          </div>
          <span className='absolute bottom-3 left-3 font-mono text-[10px] text-[#65717D]'>
            {project.resolution.width} × {project.resolution.height}
          </span>
        </div>
      </Link>
      <div className='flex items-start gap-3 p-4'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <h2 className='min-w-0 truncate font-[Alibaba_PuHuiTi] text-[15px] font-semibold text-[#F1F5F7]'>
              <Link
                to={`/projects/${project.id}/editor`}
                className='rounded-sm hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#67C6D9]'
              >
                {project.name}
              </Link>
            </h2>
            <span className='inline-flex shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[#94A2AC]'>
              <span
                className={project.state === 'published' ? 'size-1.5 bg-[#67C6D9]' : 'size-1.5 border border-[#7B8994]'}
              />
              {project.state === 'published' ? '已发布' : '草稿'}
            </span>
          </div>
          <p className='mt-1 truncate text-xs text-[#7F8B95]'>{project.description}</p>
          <div className='mt-3 flex min-h-8 items-center justify-between gap-3'>
            <p className='truncate font-mono text-[10px] text-[#65717D]'>更新于 {formatUpdatedAt(project.updatedAt)}</p>
            {publishedHref ? (
              <Button
                asChild
                variant='ghost'
                size='sm'
                className='h-8 shrink-0 gap-1.5 px-2 text-xs text-[#9CB0BB] hover:bg-[#171D24] hover:text-white'
              >
                <a href={publishedHref} target='_blank' rel='noreferrer'>
                  查看发布页
                  <ExternalLink className='size-3.5' />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='-mr-2 min-h-11 min-w-11 text-[#7F8B95] hover:bg-[#171D24] hover:text-[#F1F5F7]'
              aria-label={`${project.name}更多操作`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='border-[#2A333D] bg-[#0F1318] text-[#F1F5F7]'>
            <DropdownMenuItem asChild>
              <Link to={`/projects/${project.id}/editor`}>
                <Pencil />
                编辑项目
              </Link>
            </DropdownMenuItem>
            {project.state === 'published' && project.slug ? (
              publishedHref ? (
                <>
                  <DropdownMenuItem asChild>
                    <a href={publishedHref} target='_blank' rel='noreferrer'>
                      <ExternalLink />
                      查看发布页
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyPublishedLink()}>
                    <Copy />
                    复制发布链接
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem disabled>
                  <ExternalLink />
                  暂时无法打开发布页
                </DropdownMenuItem>
              )
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}
