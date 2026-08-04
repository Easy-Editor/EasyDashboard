import { Button } from '@/components/ui/button'
import { useEditorSession } from '@/contexts/editor-session-context'
import { getDraftPreviewHref } from '@/features/projects/project-navigation'
import { cn } from '@/lib/utils'
import { MessageSquareText, PanelRightClose, PanelRightOpen, PencilRuler } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import { EditorModeTabs } from './EditorModeTabs'
import { HistoryButtons } from './HistoryButtons'
import { MainNav } from './Nav'
import { PUBLISH_SHARE_LABEL, PublishShareDialog } from './PublishShareDialog'
import { formatEditorSaveStatus } from './save-status'

export function AppHeader({
  className,
  agentOpen = false,
  onAgentToggle,
}: {
  className?: string
  agentOpen?: boolean
  onAgentToggle?: () => void
}) {
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
    restoreRelease,
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
      const currentPageId = new URLSearchParams(window.location.search).get('page')
      const href = getDraftPreviewHref(projectId, currentPageId)
      previewWindow.location.href = href
    } catch (error) {
      previewWindow.close()
      toast.error(error instanceof Error ? error.message : '保存项目失败，无法预览')
    }
  }

  const saveLabel = formatEditorSaveStatus(saveState)
  const conversationId = new URLSearchParams(window.location.search).get('conversation')
  const agentHref = conversationId
    ? `/projects/${projectId}/agent/${encodeURIComponent(conversationId)}`
    : `/projects/${projectId}/agent`

  return (
    <header
      className={cn(
        'h-[var(--ed-header-height)] w-full',
        'bg-[var(--ed-rail)]/95 backdrop-blur-xl',
        'border-b border-[var(--ed-line)]',
        'sticky top-0 z-50',
        'transition-all duration-200',
        className,
      )}
    >
      <div className='grid h-full w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 sm:gap-3 sm:px-3'>
        <MainNav projectName={projectName} saveStatus={saveLabel} />
        <div className='flex min-w-0 items-center gap-1.5'>
          <nav
            aria-label='工作模式'
            className='flex items-center rounded-[7px] border border-[var(--ed-line)] bg-[var(--ed-panel)] p-0.5'
          >
            <Button
              asChild
              variant='ghost'
              size='sm'
              className='h-7 gap-1.5 rounded-[5px] px-2.5 text-[11px] text-[var(--ed-ink-muted)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
            >
              <Link to={agentHref}>
                <MessageSquareText className='size-3' />
                Agent 创作
              </Link>
            </Button>
            <span
              aria-current='page'
              className='inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-[var(--ed-panel-raised)] px-2.5 text-[11px] font-medium text-[var(--ed-ink)] shadow-[inset_0_0_0_1px_var(--ed-line)]'
            >
              <PencilRuler className='size-3' />
              手动编辑
            </span>
          </nav>
          <EditorModeTabs />
        </div>
        <div className='flex min-w-0 items-center justify-end gap-1.5'>
          <div className='hidden xl:block'>
            <HistoryButtons />
          </div>
          <div className='hidden h-4 w-px bg-[var(--ed-line)] xl:block' />
          {onAgentToggle ? (
            <Button
              type='button'
              variant={agentOpen ? 'secondary' : 'ghost'}
              size='sm'
              className='h-7 gap-1.5 px-2 text-[11px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)]'
              aria-expanded={agentOpen}
              aria-controls='editor-agent-dock'
              onClick={onAgentToggle}
            >
              {agentOpen ? <PanelRightClose className='size-3.5' /> : <PanelRightOpen className='size-3.5' />}
              <span className='hidden xl:inline'>Agent 面板</span>
            </Button>
          ) : null}
          <Button
            variant='ghost'
            size='sm'
            className='hidden h-7 gap-2 text-[12px] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel-raised)] hover:text-[var(--ed-ink)] lg:inline-flex'
            onClick={() => void preview()}
          >
            预览
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
              className='h-[var(--ed-control-compact)] border-[var(--ed-conflict)] bg-[color-mix(in_srgb,var(--ed-conflict)_12%,var(--ed-panel))] text-[12px] text-[var(--ed-conflict)] hover:bg-[color-mix(in_srgb,var(--ed-conflict)_18%,var(--ed-panel))]'
              onClick={openConflictResolution}
            >
              解决冲突
            </Button>
          ) : null}
          <Button
            size='sm'
            className='h-7 gap-2 bg-[var(--ed-ink-soft)] px-3 text-[12px] text-[var(--ed-canvas)] hover:bg-[var(--ed-ink)]'
            disabled={saveState.status === 'saving' || saveState.status === 'conflict'}
            onClick={() => setPublishDialogOpen(true)}
          >
            {PUBLISH_SHARE_LABEL}
          </Button>
        </div>
      </div>
      <PublishShareDialog
        key={projectId}
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        projectId={projectId}
        projectName={projectName}
        initiallyPublished={publicationActive}
        publish={publishProject}
        restoreRelease={restoreRelease}
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
