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

type RestorePoint = ProjectRevision<ProjectSchema | undefined>

export function VersionsSidebar() {
  const { createRestorePoint, projectId, restoreRevision } = useEditorSession()
  const [restorePoints, setRestorePoints] = useState<RestorePoint[]>([])
  const [selectedRevision, setSelectedRevision] = useState<RestorePoint | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  const loadRestorePoints = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await listProjectRestorePoints(projectId)
      setRestorePoints(response.restorePoints)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '版本记录加载失败')
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

  return (
    <>
      <div className='flex min-h-0 flex-1 flex-col'>
        <div className='border-b border-[#252D35] p-3'>
          <Button
            type='button'
            size='sm'
            className='h-8 w-full justify-center gap-1.5 bg-[#E7ECEF] text-[11px] font-medium text-[#080A0D] hover:bg-white'
            disabled={isCreating || isRestoring}
            onClick={() => void createVersion()}
          >
            {isCreating ? <Loader2 className='size-3.5 animate-spin' /> : <Plus className='size-3.5' />}
            创建恢复点
          </Button>
          <p className='mt-2 text-[10px] leading-4 text-[#64737E]'>持久保存当前草稿，可跨设备恢复，不影响撤销记录。</p>
        </div>

        <ScrollArea className='min-h-0 flex-1'>
          <div className='px-3 py-3'>
            {isLoading ? (
              <div className='flex h-28 items-center justify-center gap-2 text-[11px] text-[#71808B]'>
                <Loader2 className='size-3.5 animate-spin' />
                正在读取版本记录
              </div>
            ) : restorePoints.length === 0 ? (
              <div className='flex h-36 flex-col items-center justify-center px-4 text-center'>
                <div className='grid size-8 place-items-center rounded-full border border-[#28333D] bg-[#141B22]'>
                  <History className='size-3.5 text-[#67C6D9]' />
                </div>
                <p className='mt-3 text-[11px] font-medium text-[#B7C3CB]'>暂无恢复点</p>
                <p className='mt-1 text-[10px] leading-4 text-[#64737E]'>重要修改前创建一个恢复点。</p>
              </div>
            ) : (
              <ol className='relative space-y-0 before:absolute before:bottom-4 before:left-[5px] before:top-3 before:w-px before:bg-[#26343F]'>
                {restorePoints.map((restorePoint, index) => (
                  <li key={restorePoint.id} className='group relative flex gap-3 pb-3 last:pb-0'>
                    <span
                      className={`relative z-10 mt-3 size-[11px] shrink-0 rounded-full border-2 border-[#0F1318] ${
                        index === 0 ? 'bg-[#67C6D9]' : 'bg-[#40515E]'
                      }`}
                    />
                    <button
                      type='button'
                      className='min-w-0 flex-1 rounded-md border border-[#252D35] bg-[#12181E] px-2.5 py-2 text-left transition-colors hover:border-[#364754] hover:bg-[#161E25] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#67C6D9]'
                      onClick={() => setSelectedRevision(restorePoint)}
                    >
                      <span className='flex items-center justify-between gap-2'>
                        <span className='truncate text-[11px] font-medium text-[#DCE5EA]'>
                          版本 {restorePoint.revision}
                        </span>
                        <RotateCcw className='size-3 shrink-0 text-[#526574] transition-colors group-hover:text-[#8EA0AD]' />
                      </span>
                      <span className='mt-1.5 flex items-center justify-between gap-2 text-[10px]'>
                        <span className='text-[#7E909D]'>{formatRevisionKind(restorePoint.kind)}</span>
                        <span className='flex items-center gap-1 font-mono text-[#5E707D]'>
                          <Clock3 className='size-2.5' />
                          {formatRevisionTime(restorePoint.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </ScrollArea>
      </div>

      <AlertDialog
        open={selectedRevision !== null}
        onOpenChange={open => {
          if (!open && !isRestoring) setSelectedRevision(null)
        }}
      >
        <AlertDialogContent className='border-[#2A333D] bg-[#0F1318] text-[#F1F5F7] sm:max-w-[420px]'>
          <AlertDialogHeader>
            <AlertDialogTitle className='text-base'>恢复这个版本？</AlertDialogTitle>
            <AlertDialogDescription className='leading-6 text-[#8D99A3]'>
              当前草稿会先自动保存为“恢复前备份”，随后恢复到版本 {selectedRevision?.revision}
              。此操作不会删除现有版本记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isRestoring}
              className='border-[#323D47] bg-transparent text-[#DCE5EA] hover:bg-[#171D24] hover:text-white'
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRestoring}
              className='bg-[#E7ECEF] text-[#080A0D] hover:bg-white'
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
