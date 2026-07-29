import { ApiError } from '@/api/client'
import type { ProjectSummary, TemplateSummary } from '@/api/contracts'
import { ProjectCard } from '@/components/project/ProjectCard'
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
import { getViewportFromSchema } from '@/editor/persistence/schema-viewport'
import { createProject, listProjects, listTemplates } from '@/features/projects/project-api'
import { PageFrame } from '@/layouts/PageFrame'
import type { ProjectSchema } from '@easy-editor/core'
import { LayoutDashboard, Plus, Search, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

const projectGridClassName = 'grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
const defaultViewport = getViewportFromSchema(defaultProjectSchema)
const defaultViewportLabel = `${defaultViewport.width} × ${defaultViewport.height}`

export function ProjectsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary<ProjectSchema>[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const templateId = searchParams.get('template')
  const createOpen = searchParams.get('create') === '1' || Boolean(templateId)
  const selectedTemplate = templates.find(template => template.id === templateId)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [{ projects: nextProjects }, { templates: nextTemplates }] = await Promise.all([
        listProjects(),
        listTemplates(),
      ])
      setProjects(nextProjects)
      setTemplates(nextTemplates)
    } catch (reason) {
      setLoadError(reason instanceof ApiError ? reason.message : '项目列表加载失败')
      setProjects([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredProjects = useMemo(() => {
    if (!projects) return []
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return projects.filter(project => {
      const matchesQuery =
        !normalizedQuery ||
        project.name.toLocaleLowerCase().includes(normalizedQuery) ||
        project.description.toLocaleLowerCase().includes(normalizedQuery)
      const matchesStatus = status === 'all' || project.state === status
      return matchesQuery && matchesStatus
    })
  }, [projects, query, status])

  function clearFilters() {
    setQuery('')
    setStatus('all')
  }

  function closeCreateDialog() {
    setCreateError(null)
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.delete('create')
      next.delete('template')
      return next
    })
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setCreating(true)
    setCreateError(null)
    try {
      const schema = structuredClone(selectedTemplate?.schema ?? defaultProjectSchema)
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
        eyebrow='项目管理'
        title='我的项目'
        description='创建和管理你的数据大屏。'
        action={
          <Button
            type='button'
            onClick={() => setSearchParams({ create: '1' })}
            className='h-11 rounded-[6px] bg-[#F1F5F7] px-5 text-[#080A0D] hover:bg-white'
          >
            <Plus />
            新建项目
          </Button>
        }
      >
        <div className='mt-10 flex flex-col gap-3 border-y border-[#222B34] py-4 sm:flex-row sm:items-center'>
          <div className='relative w-full sm:max-w-sm'>
            <Search className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5E6B76]' />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder='搜索项目'
              aria-label='搜索项目'
              className='h-9 rounded-[6px] border-[#2A333D] bg-[#0F1318] pl-9 text-sm text-[#F1F5F7] placeholder:text-[#596671] focus-visible:border-[#67C6D9] focus-visible:ring-[#67C6D9]/30'
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              className='w-full rounded-[6px] border-[#2A333D] bg-[#0F1318] text-[#D6DDE2] sm:w-[136px]'
              aria-label='按发布状态筛选'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='border-[#2A333D] bg-[#0F1318] text-[#F1F5F7]'>
              <SelectItem value='all'>全部状态</SelectItem>
              <SelectItem value='draft'>草稿</SelectItem>
              <SelectItem value='published'>已发布</SelectItem>
            </SelectContent>
          </Select>
          <p className='text-xs text-[#65717D] sm:ml-auto'>
            {projects
              ? query || status !== 'all'
                ? `显示 ${filteredProjects.length} 个，共 ${projects.length} 个项目`
                : `共 ${projects.length} 个项目`
              : '正在加载项目…'}
          </p>
        </div>

        {loadError ? (
          <div className='mt-7 flex items-center justify-between gap-4 border border-[#4B3030] bg-[#171112] px-4 py-3'>
            <p role='alert' className='text-sm text-[#E6A0A0]'>
              {loadError}
            </p>
            <Button type='button' variant='outline' onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : null}

        {projects ? (
          projects.length === 0 && !loadError ? (
            <div className='mx-auto mt-14 max-w-[560px] text-center'>
              <div className='mx-auto grid aspect-video max-w-[420px] place-items-center rounded-[10px] border border-[#2A333D] bg-[#0A0D11]'>
                <div className='grid size-14 place-items-center rounded-[8px] border border-[#26313A] bg-[#11171D]'>
                  <LayoutDashboard className='size-6 text-[#71808B]' />
                </div>
              </div>
              <h2 className='mt-6 font-[Alibaba_PuHuiTi] text-xl font-medium text-[#F1F5F7]'>还没有项目</h2>
              <p className='mt-2 text-sm text-[#71808B]'>新建空白项目，或先从一个模板开始。</p>
              <div className='mt-6 flex justify-center gap-3'>
                <Button type='button' onClick={() => setSearchParams({ create: '1' })}>
                  新建空白项目
                </Button>
                <Button type='button' variant='outline' onClick={() => navigate('/templates')}>
                  从模板开始
                </Button>
              </div>
            </div>
          ) : filteredProjects.length > 0 ? (
            <div className={`mt-7 ${projectGridClassName}`}>
              {filteredProjects.map((project, index) => (
                <div
                  key={project.id}
                  className='animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none'
                  style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
                >
                  <ProjectCard project={project} />
                </div>
              ))}
            </div>
          ) : (
            <div className='mx-auto mt-16 max-w-lg text-center'>
              <div className='mx-auto grid size-12 place-items-center rounded-[6px] border border-[#2A333D] bg-[#0F1318]'>
                <X className='size-4 text-[#65717D]' />
              </div>
              <h2 className='mt-5 font-[Alibaba_PuHuiTi] text-lg font-medium text-[#F1F5F7]'>
                没有匹配“{query || '当前筛选'}”的项目
              </h2>
              <p className='mt-2 text-sm text-[#71808B]'>项目仍然保留，清除筛选即可重新查看。</p>
              <Button
                type='button'
                variant='outline'
                onClick={clearFilters}
                className='mt-5 rounded-[6px] border-[#2A333D] bg-transparent text-[#D6DDE2] hover:bg-[#171D24] hover:text-white'
              >
                清除筛选
              </Button>
            </div>
          )
        ) : (
          <div className={`mt-7 ${projectGridClassName}`}>
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className='aspect-[1.25] animate-pulse rounded-[10px] border border-[#222B34] bg-[#0F1318]'
              />
            ))}
          </div>
        )}
      </PageFrame>

      <Dialog open={createOpen} onOpenChange={open => !open && closeCreateDialog()}>
        <DialogContent className='border-[#2A333D] bg-[#0F1318] text-[#F1F5F7]'>
          <DialogHeader>
            <DialogTitle>{selectedTemplate ? `使用“${selectedTemplate.name}”` : '新建项目'}</DialogTitle>
            <DialogDescription className='text-[#7F8B95]'>
              {selectedTemplate
                ? '模板会复制为一份可独立编辑的草稿。'
                : `空白项目默认使用 ${defaultViewportLabel} 画布，可在编辑器底部调整。`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='project-name'>项目名称</Label>
              <Input
                id='project-name'
                name='name'
                required
                maxLength={120}
                autoFocus
                defaultValue={selectedTemplate ? `${selectedTemplate.name} 副本` : ''}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='project-description'>说明</Label>
              <Input
                id='project-description'
                name='description'
                maxLength={1000}
                defaultValue={selectedTemplate?.description ?? ''}
              />
            </div>
            {createError ? (
              <p role='alert' className='text-sm text-[#E98D8D]'>
                {createError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type='button' variant='outline' onClick={closeCreateDialog}>
                取消
              </Button>
              <Button type='submit' disabled={creating}>
                {creating ? '正在创建…' : '创建并打开'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
