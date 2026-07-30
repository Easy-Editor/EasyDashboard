import { ApiError } from '@/api/client'
import { ProjectCard, type ProjectCardProject } from '@/components/project/ProjectCard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { defaultProjectSchema } from '@/editor/const'
import {
  createProject,
  duplicateProject,
  listProjects,
  restoreProject,
  setProjectFavorite,
  trashProject,
} from '@/features/projects/project-api'
import {
  CANVAS_RESOLUTION_PRESETS,
  type CanvasResolutionPreset,
  createProjectSchemaWithResolution,
  resolveCanvasResolution,
} from '@/features/projects/project-creation'
import { PageFrame } from '@/layouts/PageFrame'
import { cn } from '@/lib/utils'
import { Grid2X2, LayoutDashboard, List, Plus, Search, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'

type ProjectView = 'grid' | 'list'
export type ProjectStatusFilter = 'all' | 'draft' | 'published'

function loadPreferredView(): ProjectView {
  return window.localStorage.getItem('easy-dashboard-project-view') === 'list' ? 'list' : 'grid'
}

export function normalizeProjectSearchTerm(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

export function filterAndSortProjects(
  projects: ProjectCardProject[],
  query: string,
  status: ProjectStatusFilter,
): ProjectCardProject[] {
  const normalizedQuery = normalizeProjectSearchTerm(query).toLocaleLowerCase()
  return projects
    .filter(project => {
      const matchesQuery =
        !normalizedQuery ||
        project.name.toLocaleLowerCase().includes(normalizedQuery) ||
        project.description.toLocaleLowerCase().includes(normalizedQuery)
      return matchesQuery && (status === 'all' || project.state === status)
    })
    .sort((first, second) => {
      if (first.isFavorite !== second.isFavorite) return first.isFavorite ? -1 : 1
      return new Date(second.savedAt).getTime() - new Date(first.savedAt).getTime()
    })
}

export function describeEmptyProjectFilter(query: string, status: ProjectStatusFilter): string {
  const normalizedQuery = normalizeProjectSearchTerm(query)
  const statusLabel = status === 'published' ? '已发布' : status === 'draft' ? '草稿' : ''
  if (normalizedQuery && statusLabel) {
    return `未找到名称或说明中包含“${normalizedQuery}”的${statusLabel}项目。`
  }
  if (normalizedQuery) return `未找到名称或说明中包含“${normalizedQuery}”的项目。`
  if (statusLabel) return `当前没有${statusLabel}项目。`
  return '调整关键词或清除当前筛选。'
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<ProjectCardProject[] | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ProjectStatusFilter>('all')
  const [view, setView] = useState<ProjectView>(loadPreferredView)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [resolutionPreset, setResolutionPreset] = useState<CanvasResolutionPreset>('fhd')
  const [customWidth, setCustomWidth] = useState('1920')
  const [customHeight, setCustomHeight] = useState('1080')

  const createOpen = searchParams.get('create') === '1'

  const load = useCallback(async () => {
    setLoadError(null)
    setProjects(null)
    try {
      const response = await listProjects()
      setProjects(response.projects)
    } catch (reason) {
      setLoadError(reason instanceof ApiError ? reason.message : '项目列表加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    return filterAndSortProjects(projects, query, status)
  }, [projects, query, status])

  function setPreferredView(nextView: ProjectView) {
    setView(nextView)
    window.localStorage.setItem('easy-dashboard-project-view', nextView)
  }

  function clearFilters() {
    setQuery('')
    setStatus('all')
  }

  function closeCreateDialog() {
    setCreateError(null)
    setResolutionPreset('fhd')
    setCustomWidth('1920')
    setCustomHeight('1080')
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.delete('create')
      return next
    })
  }

  async function handleToggleFavorite(project: ProjectCardProject) {
    const nextFavorite = !project.isFavorite
    setProjects(
      current => current?.map(item => (item.id === project.id ? { ...item, isFavorite: nextFavorite } : item)) ?? null,
    )
    try {
      await setProjectFavorite(project.id, nextFavorite)
    } catch {
      setProjects(
        current =>
          current?.map(item => (item.id === project.id ? { ...item, isFavorite: project.isFavorite } : item)) ?? null,
      )
      toast.error('收藏状态更新失败')
    }
  }

  async function handleDuplicate(project: ProjectCardProject) {
    try {
      const duplicate = await duplicateProject(project.id)
      setProjects(current => (current ? [duplicate, ...current] : [duplicate]))
      toast.success(`已创建“${duplicate.name}”`)
    } catch {
      toast.error('创建副本失败')
    }
  }

  async function handleTrash(project: ProjectCardProject) {
    try {
      await trashProject(project.id)
      setProjects(current => current?.filter(item => item.id !== project.id) ?? null)
      toast.success(`“${project.name}”已移入回收站`, {
        action: {
          label: '撤销',
          onClick: () => {
            void restoreProject(project.id).then(load)
          },
        },
      })
    } catch {
      toast.error('移入回收站失败')
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    let schema: typeof defaultProjectSchema
    try {
      const resolution = resolveCanvasResolution(resolutionPreset, customWidth, customHeight)
      schema = createProjectSchemaWithResolution(defaultProjectSchema, resolution)
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : '画布分辨率无效')
      return
    }

    setCreating(true)
    setCreateError(null)
    try {
      const project = await createProject({
        name: String(form.get('name') ?? '').trim(),
        description: String(form.get('description') ?? '').trim(),
        schema,
      })
      closeCreateDialog()
      navigate(`/projects/${project.id}/editor`)
    } catch (reason) {
      setCreateError(reason instanceof ApiError ? reason.message : '项目创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <PageFrame
        eyebrow='Workspace / Projects'
        title='所有项目'
        description='集中查看草稿与已发布的大屏。'
        action={
          <Button
            type='button'
            onClick={() => setSearchParams({ create: '1' })}
            className='h-10 rounded-[8px] border border-[#d9e7f2] bg-[#eef7ff] px-4 text-[#07111d] hover:bg-white'
          >
            <Plus />
            新建项目
          </Button>
        }
      >
        <div className='mt-5 flex h-12 items-center gap-3 border-b border-[var(--ed-line)]'>
          <div className='relative w-[280px]'>
            <Search className='pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ed-ink-faint)]' />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder='搜索名称或说明'
              aria-label='搜索项目'
              className='h-8 rounded-[6px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] pl-8 text-xs text-[var(--ed-ink)] placeholder:text-[var(--ed-ink-faint)] focus-visible:border-[var(--ed-cyan)] focus-visible:ring-[var(--ed-cyan)]/25'
            />
          </div>
          <Select value={status} onValueChange={value => setStatus(value as ProjectStatusFilter)}>
            <SelectTrigger
              className='h-8 w-[120px] rounded-[6px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink-soft)]'
              aria-label='按发布状态筛选'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] text-[var(--ed-ink)]'>
              <SelectItem value='all'>全部状态</SelectItem>
              <SelectItem value='draft'>草稿</SelectItem>
              <SelectItem value='published'>已发布</SelectItem>
            </SelectContent>
          </Select>
          <p className='text-[11px] text-[var(--ed-ink-faint)]'>
            {projects ? `${filteredProjects.length} / ${projects.length}` : '加载中'}
          </p>
          <div className='ml-auto flex items-center rounded-[6px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)] p-0.5'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={() => setPreferredView('grid')}
              className={cn(
                'size-7 rounded-[4px] text-[var(--ed-ink-faint)]',
                view === 'grid' && 'bg-[var(--ed-panel-raised)] text-[var(--ed-cyan)]',
              )}
              aria-label='网格视图'
              aria-pressed={view === 'grid'}
            >
              <Grid2X2 className='size-3.5' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={() => setPreferredView('list')}
              className={cn(
                'size-7 rounded-[4px] text-[var(--ed-ink-faint)]',
                view === 'list' && 'bg-[var(--ed-panel-raised)] text-[var(--ed-cyan)]',
              )}
              aria-label='列表视图'
              aria-pressed={view === 'list'}
            >
              <List className='size-3.5' />
            </Button>
          </div>
        </div>

        {loadError ? (
          <div className='mt-6 flex items-center justify-between gap-4 border-l-2 border-[#ff7f8a] bg-[#35161d]/45 px-4 py-3'>
            <p role='alert' className='text-xs text-[#ffabb2]'>
              {loadError}
            </p>
            <Button
              type='button'
              variant='outline'
              onClick={() => void load()}
              className='h-8 rounded-[6px] border-[#67404a] bg-transparent text-xs text-[#ffc3c8]'
            >
              重试
            </Button>
          </div>
        ) : null}

        {loadError ? null : projects ? (
          projects.length === 0 && !loadError ? (
            <div className='mx-auto mt-20 max-w-[420px] text-center'>
              <div className='ed-empty-canvas mx-auto grid aspect-video w-[340px] place-items-center rounded-[8px] border border-[var(--ed-line-strong)] bg-[#080d15]'>
                <LayoutDashboard className='size-6 text-[#61778c]' />
              </div>
              <h2 className='mt-6 font-[var(--font-display)] text-lg font-medium text-[var(--ed-ink)]'>
                创建第一块画布
              </h2>
              <p className='mt-2 text-xs leading-5 text-[var(--ed-ink-muted)]'>从空白项目开始，直接进入编辑器。</p>
              <Button
                type='button'
                onClick={() => setSearchParams({ create: '1' })}
                className='mt-5 h-9 rounded-[8px] bg-[#eef7ff] text-[#07111d]'
              >
                <Plus />
                新建项目
              </Button>
            </div>
          ) : filteredProjects.length > 0 ? (
            <div
              className={cn(
                'mt-6',
                view === 'grid'
                  ? 'grid grid-cols-[repeat(auto-fill,minmax(260px,304px))] items-start gap-5'
                  : 'border-t border-[var(--ed-line)]',
              )}
            >
              {filteredProjects.map((project, index) => (
                <div
                  key={project.id}
                  className='animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none'
                  style={{ animationDelay: `${index * 30}ms`, animationFillMode: 'both' }}
                >
                  <ProjectCard
                    project={project}
                    view={view}
                    onToggleFavorite={item => void handleToggleFavorite(item)}
                    onDuplicate={item => void handleDuplicate(item)}
                    onTrash={item => void handleTrash(item)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className='mx-auto mt-20 max-w-md text-center'>
              <div className='mx-auto grid size-11 place-items-center rounded-[8px] border border-[var(--ed-line-strong)] bg-[var(--ed-panel)]'>
                <X className='size-4 text-[var(--ed-ink-faint)]' />
              </div>
              <h2 className='mt-4 font-[var(--font-display)] text-base font-medium text-[var(--ed-ink)]'>
                没有匹配的项目
              </h2>
              <p className='mt-2 text-xs text-[var(--ed-ink-muted)]'>{describeEmptyProjectFilter(query, status)}</p>
              <Button
                type='button'
                variant='outline'
                onClick={clearFilters}
                className='mt-5 h-8 rounded-[6px] border-[var(--ed-line-strong)] bg-transparent text-xs text-[var(--ed-ink-soft)]'
              >
                清除筛选
              </Button>
            </div>
          )
        ) : (
          <div className='mt-6 grid grid-cols-[repeat(auto-fill,minmax(260px,304px))] gap-5'>
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className='aspect-[1.15] animate-pulse rounded-[8px] border border-[var(--ed-line)] bg-[var(--ed-panel)]'
              />
            ))}
          </div>
        )}
      </PageFrame>

      <Dialog open={createOpen} onOpenChange={open => !open && closeCreateDialog()}>
        <DialogContent className='rounded-[12px] border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] text-[var(--ed-ink)] shadow-2xl'>
          <DialogHeader>
            <DialogTitle className='font-[var(--font-display)] text-lg'>新建项目</DialogTitle>
            <DialogDescription className='text-xs leading-5 text-[var(--ed-ink-muted)]'>
              创建后将直接进入编辑器。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='project-name' className='text-xs text-[var(--ed-ink-soft)]'>
                项目名称
              </Label>
              <Input
                id='project-name'
                name='name'
                required
                maxLength={120}
                autoFocus
                placeholder='例如：城市运营驾驶舱'
                className='rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)]'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='project-description' className='text-xs text-[var(--ed-ink-soft)]'>
                说明
              </Label>
              <Input
                id='project-description'
                name='description'
                maxLength={1000}
                placeholder='可选'
                className='rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)]'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='project-resolution' className='text-xs text-[var(--ed-ink-soft)]'>
                初始页面分辨率
              </Label>
              <Select
                value={resolutionPreset}
                onValueChange={value => setResolutionPreset(value as CanvasResolutionPreset)}
              >
                <SelectTrigger
                  id='project-resolution'
                  className='w-full rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)]'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className='rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel-raised)] text-[var(--ed-ink)]'>
                  {CANVAS_RESOLUTION_PRESETS.map(preset => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label} · {preset.width} × {preset.height}
                    </SelectItem>
                  ))}
                  <SelectItem value='custom'>自定义</SelectItem>
                </SelectContent>
              </Select>
              <p className='text-[11px] leading-5 text-[var(--ed-ink-faint)]'>
                创建后可在编辑器底部为每个页面独立调整。
              </p>
            </div>
            {resolutionPreset === 'custom' ? (
              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-2'>
                  <Label htmlFor='project-canvas-width' className='text-xs text-[var(--ed-ink-soft)]'>
                    宽度
                  </Label>
                  <Input
                    id='project-canvas-width'
                    type='number'
                    inputMode='numeric'
                    min={1}
                    max={16384}
                    step={1}
                    required
                    value={customWidth}
                    onChange={event => setCustomWidth(event.target.value)}
                    className='rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)]'
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='project-canvas-height' className='text-xs text-[var(--ed-ink-soft)]'>
                    高度
                  </Label>
                  <Input
                    id='project-canvas-height'
                    type='number'
                    inputMode='numeric'
                    min={1}
                    max={16384}
                    step={1}
                    required
                    value={customHeight}
                    onChange={event => setCustomHeight(event.target.value)}
                    className='rounded-[8px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)]'
                  />
                </div>
              </div>
            ) : null}
            {createError ? (
              <p role='alert' className='text-xs text-[#ffabb2]'>
                {createError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={closeCreateDialog}
                className='rounded-[8px] border-[var(--ed-line-strong)] bg-transparent'
              >
                取消
              </Button>
              <Button type='submit' disabled={creating} className='rounded-[8px] bg-[#eef7ff] text-[#07111d]'>
                {creating ? '正在创建…' : '创建并打开'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
