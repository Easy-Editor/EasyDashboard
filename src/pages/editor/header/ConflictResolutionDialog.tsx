import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'

type ConflictResolutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownloadLocal: () => void
  onReloadServer: () => Promise<void>
}

export function ConflictResolutionDialog({
  open,
  onOpenChange,
  onDownloadLocal,
  onReloadServer,
}: ConflictResolutionDialogProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) return
    setConfirmDiscard(false)
    setError(null)
  }, [open])

  const reload = async () => {
    setReloading(true)
    setError(null)
    try {
      await onReloadServer()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取服务端草稿失败，请稍后重试')
    } finally {
      setReloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !reloading && onOpenChange(nextOpen)}>
      <DialogContent
        data-ed-shell='editor'
        className='border-[var(--ed-line-strong)] bg-[var(--ed-panel)] text-[var(--ed-ink)]'
      >
        {confirmDiscard ? (
          <>
            <DialogHeader>
              <DialogTitle>丢弃当前内存改动？</DialogTitle>
              <DialogDescription className='leading-6 text-[#98A6AF]'>
                重新加载会用服务端最新草稿替换当前编辑器内容，本地冲突修改无法从工作台恢复。建议先下载本地副本。
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <p role='alert' className='border-l-2 border-[#FF8F98] bg-[#35161D]/50 px-3 py-2 text-sm text-[#FFB3BA]'>
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant='outline' disabled={reloading} onClick={() => setConfirmDiscard(false)}>
                返回
              </Button>
              <Button variant='outline' disabled={reloading} onClick={onDownloadLocal}>
                <Download />
                先下载本地副本
              </Button>
              <Button disabled={reloading} onClick={() => void reload()}>
                {reloading ? <Loader2 className='animate-spin' /> : <RefreshCw />}
                {reloading ? '正在重新加载…' : '确认丢弃并重新加载'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>草稿版本冲突</DialogTitle>
              <DialogDescription className='leading-6 text-[#98A6AF]'>
                服务端已有更新。当前内存中的本地修改仍保留，解决冲突前不会继续自动保存或发布。
              </DialogDescription>
            </DialogHeader>
            <div className='rounded-md border border-[#2D3943] bg-[#0B1015] p-3 text-sm leading-6 text-[#B8C3CA]'>
              你可以先下载本地 JSON 副本，或明确丢弃当前内存修改并重新加载服务端版本。
            </div>
            <DialogFooter>
              <Button variant='ghost' onClick={() => onOpenChange(false)}>
                继续留在编辑器
              </Button>
              <Button variant='outline' onClick={onDownloadLocal}>
                <Download />
                下载本地副本
              </Button>
              <Button onClick={() => setConfirmDiscard(true)}>
                <RefreshCw />
                重新加载服务端版本
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
