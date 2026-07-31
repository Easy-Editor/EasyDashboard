import { ApiError } from '@/api/client'
import { useAuth } from '@/auth/useAuth'
import { ProjectCard, type ProjectCardProject, formatProjectTime } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import { listProjects } from '@/features/projects/project-api'
import { getHomePreviewLink } from '@/features/projects/project-navigation'
import { getSettings } from '@/features/settings/settings-api'
import { PageFrame } from '@/layouts/PageFrame'
import { cn } from '@/lib/utils'
import { ArrowUpRight, Clock3, Plus, Radio } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

export function selectRecentDesigns(projects: ProjectCardProject[], limit = 4): ProjectCardProject[] {
  return [...projects].sort((first, second) => timestamp(second.savedAt) - timestamp(first.savedAt)).slice(0, limit)
}

export function selectRecentPublications(projects: ProjectCardProject[], limit = 4): ProjectCardProject[] {
  return [...projects]
    .filter(project => project.state === 'published')
    .sort((first, second) => timestamp(second.publishedAt) - timestamp(first.publishedAt))
    .slice(0, limit)
}

export function formatPublishedProjectActivity(project: ProjectCardProject): string {
  const releaseLabel = project.currentReleaseNumber === null ? '发布版本待同步' : `版本 ${project.currentReleaseNumber}`
  const timeLabel = project.publishedAt ? `发布于 ${formatProjectTime(project.publishedAt)}` : '发布时间待同步'
  return `${releaseLabel} · ${timeLabel}`
}

export function HomePage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<ProjectCardProject[]>([])
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null)
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setProjectLoadError(null)
    try {
      const response = await listProjects()
      setProjects(response.projects)
    } catch (reason) {
      setProjectLoadError(reason instanceof ApiError ? reason.message : '工作区项目加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    setSettingsLoadError(null)
    try {
      const settings = await getSettings()
      setDisplayName(settings.displayName?.trim() ?? '')
    } catch {
      setDisplayName('')
      setSettingsLoadError('个人称呼读取失败，当前使用账号称呼。')
    }
  }, [])

  useEffect(() => {
    void loadProjects()
    void loadSettings()
  }, [loadProjects, loadSettings])

  const recentDesigns = useMemo(() => selectRecentDesigns(projects), [projects])
  const recentPublications = useMemo(() => selectRecentPublications(projects), [projects])
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
      {settingsLoadError ? (
        <div className='mt-5 flex items-center justify-between gap-4 border-l-2 border-[#d9a441] bg-[#332814]/45 px-4 py-2.5'>
          <output className='text-xs text-[#e8c477]'>{settingsLoadError}</output>
          <Button
            type='button'
            variant='ghost'
            onClick={() => void loadSettings()}
            className='h-7 rounded-[6px] px-2.5 text-[11px] text-[#e8c477] hover:bg-[#4a3819]/55 hover:text-[#ffe0a0]'
          >
            重试
          </Button>
        </div>
      ) : null}

      {projectLoadError ? (
        <div
          className={cn(
            'flex items-center justify-between gap-4 border-l-2 border-[#ff7f8a] bg-[#35161d]/45 px-4 py-3',
            settingsLoadError ? 'mt-3' : 'mt-8',
          )}
        >
          <div>
            <p role='alert' className='text-xs text-[#ffabb2]'>
              {projectLoadError}
            </p>
            <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>
              最近设计和发布记录尚未更新，现有项目数据没有被清空。
            </p>
          </div>
          <Button
            type='button'
            variant='outline'
            onClick={() => void loadProjects()}
            className='h-8 rounded-[6px] border-[#67404a] bg-transparent text-xs text-[#ffc3c8]'
          >
            重试
          </Button>
        </div>
      ) : (
        <>
          <section className='mt-8' aria-labelledby='recent-designs-title'>
            <div className='flex items-end justify-between border-b border-[var(--ed-line)] pb-3'>
              <div>
                <div className='flex items-center gap-2'>
                  <Clock3 className='size-3.5 text-[var(--ed-blue)]' />
                  <h2 id='recent-designs-title' className='text-[13px] font-semibold text-[var(--ed-ink)]'>
                    最近设计
                  </h2>
                </div>
                <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>按草稿保存时间排列</p>
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
                <Button
                  asChild
                  variant='outline'
                  className='rounded-[8px] border-[var(--ed-line-strong)] bg-transparent'
                >
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
                <p className='mt-1 text-[11px] text-[var(--ed-ink-faint)]'>正在对外展示的页面</p>
              </div>
            </div>

            <div className='divide-y divide-[var(--ed-line)]'>
              {recentPublications.length > 0 ? (
                recentPublications.map(project => {
                  const previewLink = getHomePreviewLink(project)
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
                      <span className='font-mono text-[11px] text-[var(--ed-ink-faint)]'>
                        {formatPublishedProjectActivity(project)}
                      </span>
                      <Button
                        asChild
                        variant='ghost'
                        className='h-7 rounded-[6px] px-2 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel)] hover:text-[var(--ed-ink)]'
                      >
                        <a href={previewLink.href} target={previewLink.target} rel={previewLink.rel}>
                          {previewLink.label}
                          <ArrowUpRight className='size-3' />
                        </a>
                      </Button>
                    </div>
                  )
                })
              ) : (
                <div className='flex h-24 items-center text-xs text-[var(--ed-ink-faint)]'>还没有已发布的项目。</div>
              )}
            </div>
          </section>
        </>
      )}
    </PageFrame>
  )
}
