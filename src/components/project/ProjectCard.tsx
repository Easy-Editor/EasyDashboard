import type { ProjectSummary } from '@/api/contracts'
import { ProjectThumbnail } from '@/components/project/ProjectThumbnail'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getPublishedProjectUrl } from '@/features/projects/public-viewer'
import { cn } from '@/lib/utils'
import { Copy, CopyPlus, ExternalLink, MoreHorizontal, Pencil, RotateCcw, Star, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'

export type ProjectCardProject = ProjectSummary & {
  coverUrl?: string | null
  thumbnailUrl?: string | null
  isFavorite?: boolean
  deletedAt?: string | null
}

type ProjectCardProps = {
  project: ProjectCardProject
  view?: 'grid' | 'list'
  onToggleFavorite?: (project: ProjectCardProject) => void
  onDuplicate?: (project: ProjectCardProject) => void
  onTrash?: (project: ProjectCardProject) => void
  onRestore?: (project: ProjectCardProject) => void
  onDeletePermanently?: (project: ProjectCardProject) => void
}

export function formatProjectTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const elapsed = Date.now() - date.getTime()
  if (elapsed <= 0) return '刚刚'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)
}

export function formatProjectActivity(project: ProjectCardProject): string {
  const pageLabel = `${project.pageCount} 个页面`
  if (project.deletedAt) {
    return `${pageLabel} · 移入回收站于 ${formatProjectTime(project.deletedAt)}`
  }
  return `${pageLabel} · 草稿保存于 ${formatProjectTime(project.savedAt)}`
}

export function ProjectCard({
  project,
  view = 'grid',
  onToggleFavorite,
  onDuplicate,
  onTrash,
  onRestore,
  onDeletePermanently,
}: ProjectCardProps) {
  const publishedHref = project.slug ? getPublishedProjectUrl(project.slug) : null
  const trashed = Boolean(project.deletedAt)

  async function copyPublishedLink() {
    if (!publishedHref) return
    try {
      await navigator.clipboard.writeText(publishedHref)
      toast.success('发布链接已复制')
    } catch {
      toast.error('复制失败，请打开发布页后复制地址')
    }
  }

  const projectMeta = (
    <div className='min-w-0 flex-1'>
      <div className='flex min-w-0 items-center'>
        <h2 className='min-w-0 flex-1 truncate font-[var(--font-display)] text-[13px] font-semibold text-[var(--ed-ink)]'>
          {trashed ? (
            project.name
          ) : (
            <Link
              to={`/projects/${project.id}/editor`}
              className='rounded-[4px] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            >
              {project.name}
            </Link>
          )}
        </h2>
      </div>
      <p className='mt-1 truncate text-[11px] text-[var(--ed-ink-muted)]'>{project.description || '暂无项目说明'}</p>
      <div className='mt-2 flex min-w-0 items-center gap-2 font-mono text-[11px] tracking-[0.01em] text-[var(--ed-ink-faint)]'>
        <p className='min-w-0 flex-1 truncate'>{formatProjectActivity(project)}</p>
        {trashed ? null : (
          <span className='inline-flex shrink-0 items-center gap-1.5 uppercase tracking-[0.1em]'>
            <span
              className={cn(
                'size-1.5',
                project.state === 'published'
                  ? 'rounded-full bg-[var(--ed-cyan)] shadow-[0_0_7px_var(--ed-cyan)]'
                  : 'border border-[#748695]',
              )}
            />
            {project.state === 'published' ? '已发布' : '草稿'}
          </span>
        )}
      </div>
    </div>
  )

  const actions = (
    <div className='flex shrink-0 items-center'>
      {trashed ? (
        <div className='flex items-center gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={() => onDeletePermanently?.(project)}
            disabled={!onDeletePermanently}
            className='size-8 rounded-[6px] text-[#ff9ca5] hover:bg-[#35161d]/65 hover:text-[#ffc3c8]'
            aria-label={`永久删除 ${project.name}`}
            title='永久删除'
          >
            <Trash2 className='size-3.5' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onRestore?.(project)}
            disabled={!onRestore}
            className='h-8 gap-1.5 rounded-[6px] border border-[var(--ed-line-strong)] px-2.5 text-[11px] text-[var(--ed-cyan)] hover:border-[var(--ed-cyan)]/50 hover:bg-[var(--ed-panel-raised)] hover:text-[#b8f4ff]'
            aria-label={`恢复 ${project.name}`}
          >
            <RotateCcw className='size-3.5' />
            恢复
          </Button>
        </div>
      ) : (
        <>
          {onToggleFavorite ? (
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={() => onToggleFavorite(project)}
              className='size-8 rounded-[6px] text-[var(--ed-ink-faint)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
              aria-label={project.isFavorite ? `取消收藏 ${project.name}` : `收藏 ${project.name}`}
            >
              <Star className={cn('size-3.5', project.isFavorite && 'fill-[var(--ed-blue)] text-[var(--ed-blue)]')} />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-8 rounded-[6px] text-[var(--ed-ink-faint)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
                aria-label={`${project.name}更多操作`}
              >
                <MoreHorizontal className='size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='min-w-44 rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] p-1 text-[var(--ed-ink)] shadow-2xl'
            >
              <DropdownMenuItem asChild>
                <Link to={`/projects/${project.id}/editor`}>
                  <Pencil />
                  编辑项目
                </Link>
              </DropdownMenuItem>
              {onDuplicate ? (
                <DropdownMenuItem onSelect={() => onDuplicate(project)}>
                  <CopyPlus />
                  创建副本
                </DropdownMenuItem>
              ) : null}
              {publishedHref ? (
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
              ) : null}
              {onTrash ? (
                <>
                  <DropdownMenuSeparator className='bg-[var(--ed-line)]' />
                  <DropdownMenuItem
                    onSelect={() => onTrash(project)}
                    className='text-[#ff9ca5] focus:bg-[#35161d] focus:text-[#ffc3c8]'
                  >
                    <Trash2 />
                    移入回收站
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )

  if (view === 'list') {
    return (
      <article className='group/card grid min-h-[92px] grid-cols-[132px_minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--ed-line)] px-2 py-3 transition-colors hover:bg-[var(--ed-panel)]'>
        {trashed ? (
          <ProjectThumbnail project={project} className='rounded-[6px] border border-[var(--ed-line)] opacity-75' />
        ) : (
          <Link
            to={`/projects/${project.id}/editor`}
            className='rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ed-cyan)]'
            aria-label={`打开项目：${project.name}`}
          >
            <ProjectThumbnail project={project} className='rounded-[6px] border border-[var(--ed-line)]' />
          </Link>
        )}
        {projectMeta}
        {actions}
      </article>
    )
  }

  return (
    <article className='group/card overflow-hidden rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)] transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[#39536b] hover:shadow-[0_16px_40px_rgba(0,0,0,.24)] motion-reduce:transition-none'>
      {trashed ? (
        <ProjectThumbnail project={project} className='opacity-75' />
      ) : (
        <Link
          to={`/projects/${project.id}/editor`}
          className='block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ed-cyan)]'
          aria-label={`打开项目：${project.name}`}
        >
          <ProjectThumbnail project={project} />
        </Link>
      )}
      <div className='flex items-start gap-2 border-t border-[var(--ed-line)] px-3.5 py-3'>
        {projectMeta}
        {actions}
      </div>
    </article>
  )
}
