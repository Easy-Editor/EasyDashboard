import type { ProjectRevision } from '@/api/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEditorSession } from '@/contexts/editor-session-context'
import { listProjectRestorePoints } from '@/features/projects/project-api'
import type { ProjectSchema } from '@easy-editor/core'
import { Clock3, History, Loader2, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { formatRevisionKind, formatRevisionTime } from './version-format'
import { RestorePointsLoadError, resolveRestorePointListState } from './versions-load-state'

type RestorePoint = ProjectRevision<ProjectSchema | undefined>

export function VersionsSidebar() {
  const { createRestorePoint, projectId, projectName, restoreRevision } = useEditorSession()
  const [restorePoints, setRestorePoints] = useState<RestorePoint[]>([])
  const [selectedRevision, setSelectedRevision] = useState<RestorePoint | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  const loadRestorePoints = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await listProjectRestorePoints(projectId)
      setRestorePoints(response.restorePoints)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '版本记录加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadRestorePoints()
  }, [loadRestorePoints])

  const createVersion = async () => {
    setIsCreating(true)
    try {
      const restorePoint = await createRestorePoint()
      setRestorePoints(current => [restorePoint, ...current.filter(item => item.id !== restorePoint.id)])
      toast.success('已创建手动恢复点')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复点创建失败')
    } finally {
      setIsCreating(false)
    }
  }

  const restoreVersion = async () => {
    if (!selectedRevision) return
    setIsRestoring(true)
    try {
      await restoreRevision(selectedRevision.id)
      toast.success(`已恢复到版本 ${selectedRevision.revision}`)
      setSelectedRevision(null)
      await loadRestorePoints()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '版本恢复失败')
    } finally {
      setIsRestoring(false)
    }
  }

  const listState = resolveRestorePointListState({
    isLoading,
    loadError,
    restorePointCount: restorePoints.length,
  })

  return (
    <>
      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='border-b border-[var(--ed-line)] p-3'>
          <Button
            type='button'
            size='sm'
            className='h-8 w-full justify-center gap-1.5 bg-[var(--ed-ink)] text-[11px] font-medium text-[var(--ed-canvas)] hover:bg-white'
            disabled={isCreating || isRestoring}
            onClick={() => void createVersion()}
          >
            {isCreating ? <Loader2 className='size-3.5 animate-spin' /> : <Plus className='size-3.5' />}
            创建恢复点
          </Button>
          <p className='mt-2 text-[10px] leading-4 text-[var(--ed-ink-faint)]'>
            恢复点会持久保存整个项目；撤销与重做仅保留在本次编辑会话中。
          </p>
        </div>

        <ScrollArea className='min-h-0 flex-1'>
          <div className='px-3 py-3'>
            {loadError ? (
              <RestorePointsLoadError
                message={loadError}
                retrying={isLoading}
                onRetry={() => void loadRestorePoints()}
              />
            ) : null}

            {listState === 'loading' ? (
              <div className='flex h-28 items-center justify-center gap-2 text-[11px] text-[var(--ed-ink-muted)]'>
                <Loader2 className='size-3.5 animate-spin' />
                正在读取版本记录
              </div>
            ) : listState === 'empty' ? (
              <div className='flex h-36 flex-col items-center justify-center px-4 text-center'>
                <div className='grid size-8 place-items-center rounded-full border border-[var(--ed-line)] bg-[var(--ed-panel-raised)]'>
                  <History className='size-3.5 text-[var(--ed-cyan)]' />
                </div>
                <p className='mt-3 text-[11px] font-medium text-[var(--ed-ink-soft)]'>暂无恢复点</p>
                <p className='mt-1 text-[10px] leading-4 text-[var(--ed-ink-faint)]'>重要修改前创建一个恢复点。</p>
              </div>
            ) : listState === 'content' ? (
              <ol className='relative space-y-0 before:absolute before:bottom-4 before:left-[5px] before:top-3 before:w-px before:bg-[var(--ed-line)]'>
                {restorePoints.map((restorePoint, index) => (
                  <li key={restorePoint.id} className='group relative flex gap-3 pb-3 last:pb-0'>
                    <span
                      className={`relative z-10 mt-3 size-[11px] shrink-0 rounded-full border-2 border-[var(--ed-panel)] ${
                        index === 0 ? 'bg-[var(--ed-cyan)]' : 'bg-[var(--ed-ink-faint)]'
                      }`}
                    />
                    <button
                      type='button'
                      className='min-w-0 flex-1 rounded-[var(--ed-radius-control)] border border-[var(--ed-line)] bg-[var(--ed-panel)] px-2.5 py-2 text-left transition-colors hover:border-[var(--ed-line-strong)] hover:bg-[var(--ed-panel-raised)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ed-cyan)]'
                      onClick={() => setSelectedRevision(restorePoint)}
                    >
                      <span className='flex items-center justify-between gap-2'>
                        <span className='truncate text-[11px] font-medium text-[var(--ed-ink)]'>
                          版本 {restorePoint.revision}
                        </span>
                        <RotateCcw className='size-3 shrink-0 text-[var(--ed-ink-faint)] transition-colors group-hover:text-[var(--ed-ink-soft)]' />
                      </span>
                      <span className='mt-1.5 flex items-center justify-between gap-2 text-[10px]'>
                        <span className='text-[var(--ed-ink-muted)]'>{formatRevisionKind(restorePoint.kind)}</span>
                        <span className='flex items-center gap-1 font-mono text-[var(--ed-ink-faint)]'>
                          <Clock3 className='size-2.5' />
                          {formatRevisionTime(restorePoint.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      <AlertDialog
        open={selectedRevision !== null}
        onOpenChange={open => {
          if (!open && !isRestoring) setSelectedRevision(null)
        }}
      >
        <AlertDialogContent
          data-ed-shell='editor'
          className='border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-[var(--ed-ink)] sm:max-w-[420px]'
        >
          <AlertDialogHeader>
            <AlertDialogTitle className='text-base'>恢复这个版本？</AlertDialogTitle>
            <AlertDialogDescription className='leading-6 text-[var(--ed-ink-muted)]'>
              项目“{projectName}”的全部页面都会替换为版本 {selectedRevision?.revision}
              。当前草稿会先自动保存为“恢复前备份”，已有恢复点不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isRestoring}
              className='border-[var(--ed-line-strong)] bg-transparent text-[var(--ed-ink)] hover:bg-[var(--ed-panel-raised)] hover:text-white'
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRestoring}
              className='bg-[var(--ed-ink)] text-[var(--ed-canvas)] hover:bg-white'
              onClick={event => {
                event.preventDefault()
                void restoreVersion()
              }}
            >
              {isRestoring ? <Loader2 className='size-4 animate-spin' /> : null}
              {isRestoring ? '正在恢复' : '确认恢复'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
