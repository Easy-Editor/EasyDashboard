import { Button } from '@/components/ui/button'
import { useEditorSession } from '@/contexts/editor-session-context'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import { EditorModeTabs } from './EditorModeTabs'
import { HistoryButtons } from './HistoryButtons'
import { MainNav } from './Nav'
import { PublishShareDialog } from './PublishShareDialog'
import { formatEditorSaveStatus } from './save-status'

export function AppHeader({ className }: { className?: string }) {
  const {
    closeConflictResolution,
    conflictResolutionOpen,
    downloadLocalDraft,
    flush,
    isPublished,
    openConflictResolution,
    projectId,
    projectName,
    publish: publishProject,
    reloadServerDraft,
    saveState,
  } = useEditorSession()
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [publicationActive, setPublicationActive] = useState(isPublished)

  useEffect(() => {
    setPublicationActive(isPublished)
  }, [isPublished])

  const save = async () => {
    if (saveState.status === 'conflict') {
      openConflictResolution()
      return
    }
    try {
      await flush()
      toast.success('草稿已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存项目失败')
    }
  }

  const preview = async () => {
    if (saveState.status === 'conflict') {
      openConflictResolution()
      return
    }
    const previewWindow = window.open('', '_blank')
    if (!previewWindow) {
      toast.error('浏览器阻止了新标签页，请允许弹出窗口后重试')
      return
    }
    previewWindow.opener = null

    try {
      await flush()
      const href = `/projects/${encodeURIComponent(projectId)}/preview`
      previewWindow.location.href = href
    } catch (error) {
      previewWindow.close()
      toast.error(error instanceof Error ? error.message : '保存项目失败，无法预览')
    }
  }

  const saveLabel = formatEditorSaveStatus(saveState)

  return (
    <header
      className={cn(
        'h-12 w-full',
        'bg-[var(--ed-rail)]/95 backdrop-blur-xl',
        'border-b border-[var(--ed-line)]',
        'sticky top-0 z-50',
        'transition-all duration-200',
        className,
      )}
    >
      <div className='grid h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 sm:gap-3 sm:px-3'>
        <MainNav projectName={projectName} saveStatus={saveLabel} />
        <div className='min-w-0'>
          <EditorModeTabs />
        </div>
        <div className='flex min-w-0 items-center justify-end gap-1.5'>
          <div className='hidden xl:block'>
            <HistoryButtons />
          </div>
          <div className='hidden h-4 w-px bg-border/60 xl:block' />
          <Button
            variant='ghost'
            size='sm'
            className='hidden h-7 gap-2 text-[12px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] lg:inline-flex'
            onClick={() => void preview()}
          >
            预览草稿
          </Button>
          <Button
            size='sm'
            variant='outline'
            className='hidden h-7 gap-2 border-[var(--ed-line-strong)] bg-transparent text-[12px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] xl:inline-flex'
            disabled={saveState.status === 'saving'}
            onClick={() => void save()}
          >
            保存
          </Button>
          {saveState.status === 'conflict' ? (
            <Button
              size='sm'
              variant='outline'
              className='h-7 border-[#D99A4E] bg-[#2A1E12] text-[12px] text-[#FFD39A] hover:bg-[#382718]'
              onClick={openConflictResolution}
            >
              解决冲突
            </Button>
          ) : null}
          <Button
            size='sm'
            className='h-7 gap-2 bg-[var(--ed-ink)] px-3 text-[12px] text-[var(--ed-canvas)] hover:bg-white'
            disabled={saveState.status === 'saving' || saveState.status === 'conflict'}
            onClick={() => setPublishDialogOpen(true)}
          >
            {publicationActive ? '发布与分享' : '发布'}
          </Button>
        </div>
      </div>
      <PublishShareDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        projectId={projectId}
        projectName={projectName}
        initiallyPublished={publicationActive}
        publish={publishProject}
        onPublicationChange={release => setPublicationActive(release !== null)}
      />
      <ConflictResolutionDialog
        open={conflictResolutionOpen}
        onOpenChange={open => (open ? openConflictResolution() : closeConflictResolution())}
        onDownloadLocal={downloadLocalDraft}
        onReloadServer={reloadServerDraft}
      />
    </header>
  )
}
