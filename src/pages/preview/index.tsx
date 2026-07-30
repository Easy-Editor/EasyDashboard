import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getProject } from '@/features/projects/project-api'
import { createDataSourceEngine } from '@easy-editor/plugin-datasource'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { PreviewState } from './PreviewState'
import { type PreviewDataSourceEngine, ProjectSchemaRenderer } from './ProjectSchemaRenderer'
import { getPreviewPages, resolvePreviewPage, withPreviewPage } from './preview-page-selector'

function DraftProjectPreview({ projectId }: { projectId: string }) {
  const [projectDetail, setProjectDetail] = useState<Awaited<ReturnType<typeof getProject>> | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedPageId = searchParams.get('page')

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setProjectDetail(null)
      setError(null)

      try {
        const detail = await getProject(projectId)
        if (!cancelled) setProjectDetail(detail)
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error('项目预览加载失败'))
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const pages = projectDetail ? getPreviewPages(projectDetail.schema) : []
  const activePageId = projectDetail ? resolvePreviewPage(projectDetail.schema, requestedPageId) : null

  useEffect(() => {
    if (!activePageId || activePageId === requestedPageId) return
    setSearchParams(withPreviewPage(searchParams, activePageId), { replace: true })
  }, [activePageId, requestedPageId, searchParams, setSearchParams])

  if (error) {
    return <PreviewState title='无法加载预览' detail={error.message} />
  }

  if (!projectDetail) {
    return <PreviewState title='正在读取项目草稿…' />
  }

  const selectPage = (pageId: string) => {
    setSearchParams(withPreviewPage(searchParams, pageId), { replace: true })
  }

  return (
    <div
      data-ed-shell='preview'
      className='relative h-screen w-full overflow-hidden bg-[var(--ed-canvas)] text-[var(--ed-ink)]'
    >
      <div className='absolute left-4 top-4 z-50 flex items-center gap-2'>
        <Button
          asChild
          variant='outline'
          size='sm'
          className='h-8 rounded-[7px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-3 text-xs text-[var(--ed-ink-soft)] shadow-lg hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
        >
          <Link to={`/projects/${projectId}/editor`}>
            <ArrowLeft className='size-3.5' />
            返回编辑器
          </Link>
        </Button>
        <span className='rounded-[7px] border border-[var(--ed-line)] bg-[var(--ed-panel)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ed-ink-faint)] shadow-lg'>
          草稿预览
        </span>
      </div>
      {pages.length > 1 ? (
        <div className='absolute right-4 top-4 z-50 w-48'>
          <Select value={activePageId ?? undefined} onValueChange={selectPage}>
            <SelectTrigger
              aria-label='选择预览页面'
              className='h-8 rounded-[7px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink)] shadow-lg'
            >
              <SelectValue placeholder='选择页面' />
            </SelectTrigger>
            <SelectContent
              data-ed-shell='preview'
              className='border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-[var(--ed-ink)]'
            >
              {pages.map(page => (
                <SelectItem key={page.id} value={page.id}>
                  {page.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <ProjectSchemaRenderer
        project={projectDetail}
        requestedPageId={activePageId}
        createDataSourceEngine={createDataSourceEngine as PreviewDataSourceEngine}
      />
    </div>
  )
}

export default function Preview() {
  const { projectId } = useParams<{ projectId: string }>()

  if (!projectId) {
    return <PreviewState title='项目地址无效' />
  }

  return <DraftProjectPreview projectId={projectId} />
}
