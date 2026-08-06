import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getProject } from '@/features/projects/project-api'
import { subscribeProjectDraftUpdates } from '@/features/projects/project-draft-channel'
import { createDataSourceEngine } from '@easy-editor/plugin-datasource'
import { ArrowLeft, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { Link, useParams, useSearchParams } from 'react-router'
import { PreviewRenderFailure, PreviewState } from './PreviewState'
import { type PreviewDataSourceEngine, ProjectSchemaRenderer } from './ProjectSchemaRenderer'
import { resolvePreviewLoadState } from './preview-load-state'
import {
  type PreviewPageOption,
  getPreviewPages,
  resolvePreviewPageSelection,
  withPreviewPage,
} from './preview-page-selector'

type DraftProjectDetail = Awaited<ReturnType<typeof getProject>>

const compactButtonClass =
  'h-8 rounded-[7px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] px-3 text-xs text-[var(--ed-ink-soft)] shadow-lg hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'

function editorHref(projectId: string, pageId?: string | null) {
  if (!pageId) return `/projects/${projectId}/editor`
  return `/projects/${projectId}/editor?page=${encodeURIComponent(pageId)}`
}

function PagePicker({
  pages,
  activePageId,
  onSelect,
  label = '选择预览页面',
  className = 'w-48',
}: {
  pages: PreviewPageOption[]
  activePageId: string | null
  onSelect: (pageId: string) => void
  label?: string
  className?: string
}) {
  return (
    <Select value={activePageId ?? undefined} onValueChange={onSelect}>
      <SelectTrigger
        aria-label={label}
        className={`${className} h-8 rounded-[7px] border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-xs text-[var(--ed-ink)] shadow-lg`}
      >
        <SelectValue placeholder='选择有效页面' />
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
  )
}

function PreviewRetryButton({ onRetry, label = '重新加载' }: { onRetry: () => void; label?: string }) {
  return (
    <Button
      type='button'
      size='sm'
      className='rounded-[7px] bg-[var(--ed-ink)] text-xs text-[var(--ed-canvas)] hover:bg-white'
      onClick={onRetry}
    >
      <RotateCw className='size-3.5' />
      {label}
    </Button>
  )
}

function DraftPreviewShell({
  projectId,
  editorPageId,
  pages = [],
  activePageId = null,
  onSelectPage,
  children,
}: {
  projectId: string
  editorPageId?: string | null
  pages?: PreviewPageOption[]
  activePageId?: string | null
  onSelectPage?: (pageId: string) => void
  children: React.ReactNode
}) {
  const showPagePicker = Boolean(onSelectPage && (pages.length > 1 || !activePageId))

  return (
    <div
      data-ed-shell='preview'
      className='relative h-screen w-full overflow-hidden bg-[var(--ed-canvas)] text-[var(--ed-ink)]'
    >
      <div className='absolute left-4 top-4 z-50 flex items-center gap-2'>
        <Button asChild variant='outline' size='sm' className={compactButtonClass}>
          <Link to={editorHref(projectId, editorPageId)}>
            <ArrowLeft className='size-3.5' />
            返回编辑器
          </Link>
        </Button>
        <span className='rounded-[7px] border border-[var(--ed-line)] bg-[var(--ed-panel)] px-2.5 py-1.5 text-xs text-[var(--ed-ink-muted)] shadow-lg'>
          草稿预览
        </span>
      </div>
      {showPagePicker && onSelectPage ? (
        <div className='absolute right-4 top-4 z-50'>
          <PagePicker pages={pages} activePageId={activePageId} onSelect={onSelectPage} />
        </div>
      ) : null}
      {children}
    </div>
  )
}

function DraftProjectPreview({ projectId }: { projectId: string }) {
  const [projectDetail, setProjectDetail] = useState<DraftProjectDetail | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [renderedPage, setRenderedPage] = useState<{
    entryPageId: string
    activePageId: string
  } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedPageId = searchParams.get('page')

  // A retry increments loadAttempt to cancel the previous effect and start a fresh request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadAttempt is the explicit retry trigger
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setProjectDetail(current => (current?.id === projectId ? current : null))
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
  }, [loadAttempt, projectId])

  useEffect(() => subscribeProjectDraftUpdates(projectId, () => setLoadAttempt(attempt => attempt + 1)), [projectId])

  const loadState = resolvePreviewLoadState(projectDetail, error)
  const pages = projectDetail ? getPreviewPages(projectDetail.schema) : []
  const pageSelection = projectDetail ? resolvePreviewPageSelection(projectDetail.schema, requestedPageId) : null

  useEffect(() => {
    if (pageSelection?.status !== 'selected' || pageSelection.source !== 'start' || requestedPageId) return
    setSearchParams(current => withPreviewPage(current, pageSelection.activePageId), { replace: true })
  }, [pageSelection, requestedPageId, setSearchParams])

  const retryLoad = () => setLoadAttempt(attempt => attempt + 1)
  const selectPage = (pageId: string) => {
    setSearchParams(current => withPreviewPage(current, pageId), { replace: true })
  }

  if (loadState.status === 'loading') {
    return (
      <DraftPreviewShell projectId={projectId}>
        <PreviewState
          title='正在读取项目草稿…'
          detail='加载时间较长时，可以重新发起一次读取。'
          action={<PreviewRetryButton onRetry={retryLoad} />}
        />
      </DraftPreviewShell>
    )
  }

  if (loadState.status === 'error') {
    return (
      <DraftPreviewShell projectId={projectId}>
        <PreviewState
          tone='error'
          title='无法加载预览'
          detail={loadState.error.message}
          action={<PreviewRetryButton onRetry={retryLoad} />}
        />
      </DraftPreviewShell>
    )
  }

  if (!pageSelection || pageSelection.status === 'empty') {
    return (
      <DraftPreviewShell projectId={projectId}>
        <PreviewState
          title='项目中没有可预览的页面'
          detail='返回编辑器添加页面后，再打开草稿预览。'
          action={
            <Button asChild variant='outline' size='sm' className={compactButtonClass}>
              <Link to={editorHref(projectId)}>
                <ArrowLeft className='size-3.5' />
                返回编辑器
              </Link>
            </Button>
          }
        />
      </DraftPreviewShell>
    )
  }

  if (pageSelection.status === 'invalid') {
    return (
      <DraftPreviewShell
        projectId={projectId}
        editorPageId={pageSelection.startPageId}
        pages={pages}
        activePageId={null}
        onSelectPage={selectPage}
      >
        <PreviewState
          tone='error'
          title={`页面「${pageSelection.requestedPageId}」不存在`}
          detail='地址中的 page 参数已保留，没有自动跳转。你可以打开项目起始页，或选择一个现有页面。'
          action={
            <>
              {pageSelection.startPageId ? (
                <Button
                  type='button'
                  size='sm'
                  className='rounded-[7px] bg-[var(--ed-ink)] text-xs text-[var(--ed-canvas)] hover:bg-white'
                  onClick={() => selectPage(pageSelection.startPageId as string)}
                >
                  打开起始页
                </Button>
              ) : null}
              <PagePicker
                pages={pages}
                activePageId={null}
                onSelect={selectPage}
                label='从有效页面中选择'
                className='w-44'
              />
              <Button asChild variant='outline' size='sm' className={compactButtonClass}>
                <Link to={editorHref(projectId, pageSelection.startPageId)}>
                  <ArrowLeft className='size-3.5' />
                  返回编辑器
                </Link>
              </Button>
            </>
          }
        />
      </DraftPreviewShell>
    )
  }

  const currentRenderedPageId =
    renderedPage?.entryPageId === pageSelection.activePageId ? renderedPage.activePageId : pageSelection.activePageId
  const activePage = pages.find(page => page.id === currentRenderedPageId)
  const activePageLabel = activePage?.label ?? currentRenderedPageId

  return (
    <DraftPreviewShell
      projectId={projectId}
      editorPageId={currentRenderedPageId}
      pages={pages}
      activePageId={currentRenderedPageId}
      onSelectPage={selectPage}
    >
      <ErrorBoundary
        resetKeys={[loadState.project.draftVersion, pageSelection.activePageId]}
        FallbackComponent={({ error: renderError, resetErrorBoundary }) => (
          <PreviewRenderFailure
            pageLabel={activePageLabel}
            error={renderError instanceof Error ? renderError : new Error('页面组件未能完成渲染')}
            onRetry={resetErrorBoundary}
          />
        )}
      >
        <ProjectSchemaRenderer
          project={loadState.project}
          requestedPageId={pageSelection.activePageId}
          createDataSourceEngine={createDataSourceEngine as PreviewDataSourceEngine}
          showPreviewScaleControls
          onActivePageChange={activePageId => {
            setRenderedPage({
              entryPageId: pageSelection.activePageId,
              activePageId,
            })
            selectPage(activePageId)
          }}
        />
      </ErrorBoundary>
    </DraftPreviewShell>
  )
}

export default function Preview() {
  const { projectId } = useParams<{ projectId: string }>()

  if (!projectId) {
    return (
      <PreviewState
        tone='error'
        title='项目地址无效'
        action={
          <Button asChild size='sm'>
            <Link to='/projects'>返回我的项目</Link>
          </Button>
        }
      />
    )
  }

  return <DraftProjectPreview projectId={projectId} />
}
