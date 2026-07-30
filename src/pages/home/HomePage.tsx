import { useAuth } from '@/auth/useAuth'
import { ProjectCard, type ProjectCardProject, formatProjectTime } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import { listProjects } from '@/features/projects/project-api'
import { getPublishedProjectUrl } from '@/features/projects/public-viewer'
import { getSettings } from '@/features/settings/settings-api'
import { PageFrame } from '@/layouts/PageFrame'
import { ArrowUpRight, Clock3, Plus, Radio } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

export function HomePage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<ProjectCardProject[]>([])
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void listProjects()
      .then(response => setProjects(response.projects))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
    void getSettings()
      .then(settings => setDisplayName(settings.displayName?.trim() ?? ''))
      .catch(() => setDisplayName(''))
  }, [])

  const recentDesigns = useMemo(
    () =>
      [...projects]
        .sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime())
        .slice(0, 4),
    [projects],
  )
  const recentPublications = useMemo(
    () =>
      [...projects]
        .filter(project => project.state === 'published')
        .sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime())
        .slice(0, 4),
    [projects],
  )
  const greetingName = displayName || user?.email?.split('@')[0] || '设计者'

  return (
    <PageFrame
      eyebrow='Workspace / Home'
      title={`你好，${greetingName}`}
      description='继续最近的设计，或检查已经发布的页面。'
      action={
        <Button
          asChild
          className='h-10 rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] px-4 text-[#07111d] hover:bg-white'
        >
          <Link to='/projects?create=1'>
            <Plus />
            新建项目
          </Link>
        </Button>
      }
    >
      <section className='mt-8' aria-labelledby='recent-designs-title'>
        <div className='flex items-end justify-between border-b border-[var(--ed-line)] pb-3'>
          <div>
            <div className='flex items-center gap-2'>
              <Clock3 className='size-3.5 text-[var(--ed-blue)]' />
              <h2 id='recent-designs-title' className='text-[13px] font-semibold text-[var(--ed-ink)]'>
                最近设计
              </h2>
            </div>
            <p className='mt-1 text-[10px] text-[var(--ed-ink-faint)]'>按最近编辑时间排列</p>
          </div>
          <Button
            asChild
            variant='ghost'
            className='h-8 rounded-[6px] px-2.5 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel)] hover:text-[var(--ed-ink)]'
          >
            <Link to='/projects'>
              查看全部
              <ArrowUpRight className='size-3.5' />
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className='mt-5 grid grid-cols-[repeat(auto-fill,minmax(260px,304px))] gap-5'>
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className='aspect-[1.15] animate-pulse rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)]'
              />
            ))}
          </div>
        ) : recentDesigns.length > 0 ? (
          <div className='mt-5 grid grid-cols-[repeat(auto-fill,minmax(260px,304px))] gap-5'>
            {recentDesigns.map(project => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <div className='mt-5 flex min-h-32 items-center justify-between border border-dashed border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-6'>
            <div>
              <p className='text-sm font-medium text-[var(--ed-ink)]'>还没有最近设计</p>
              <p className='mt-1 text-xs text-[var(--ed-ink-muted)]'>创建项目后，它会出现在这里。</p>
            </div>
            <Button asChild variant='outline' className='rounded-[8px] border-[var(--ed-line-strong)] bg-transparent'>
              <Link to='/projects?create=1'>创建项目</Link>
            </Button>
          </div>
        )}
      </section>

      <section className='mt-11' aria-labelledby='recent-publications-title'>
        <div className='flex items-end justify-between border-b border-[var(--ed-line)] pb-3'>
          <div>
            <div className='flex items-center gap-2'>
              <Radio className='size-3.5 text-[var(--ed-cyan)]' />
              <h2 id='recent-publications-title' className='text-[13px] font-semibold text-[var(--ed-ink)]'>
                最近发布
              </h2>
            </div>
            <p className='mt-1 text-[10px] text-[var(--ed-ink-faint)]'>正在对外展示的页面</p>
          </div>
        </div>

        <div className='divide-y divide-[var(--ed-line)]'>
          {recentPublications.length > 0 ? (
            recentPublications.map(project => {
              const publishedHref = project.slug ? getPublishedProjectUrl(project.slug) : null
              return (
                <div
                  key={project.id}
                  className='grid h-14 grid-cols-[minmax(0,1fr)_160px_auto] items-center gap-6 px-2'
                >
                  <Link
                    to={`/projects/${project.id}/editor`}
                    className='min-w-0 truncate text-xs font-medium text-[var(--ed-ink-soft)] hover:text-[var(--ed-cyan)]'
                  >
                    {project.name}
                  </Link>
                  <span className='font-mono text-[9px] text-[var(--ed-ink-faint)]'>
                    更新于 {formatProjectTime(project.updatedAt)}
                  </span>
                  <Button
                    asChild
                    variant='ghost'
                    className='h-7 rounded-[6px] px-2 text-[10px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel)] hover:text-[var(--ed-ink)]'
                  >
                    {publishedHref ? (
                      <a href={publishedHref} target='_blank' rel='noreferrer'>
                        查看发布页
                        <ArrowUpRight className='size-3' />
                      </a>
                    ) : (
                      <Link to={`/projects/${project.id}/preview`}>
                        打开预览
                        <ArrowUpRight className='size-3' />
                      </Link>
                    )}
                  </Button>
                </div>
              )
            })
          ) : (
            <div className='flex h-24 items-center text-xs text-[var(--ed-ink-faint)]'>还没有已发布的项目。</div>
          )}
        </div>
      </section>
    </PageFrame>
  )
}
