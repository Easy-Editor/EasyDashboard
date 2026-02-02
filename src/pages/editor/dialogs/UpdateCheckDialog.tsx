import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { project } from '@easy-editor/core'
import { RefreshCw } from 'lucide-react'
import { observer } from 'mobx-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { type VersionCheckResult, versionManager } from '../../../editor/remote/managers'

interface UpdateCheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const UpdateCheckDialog = observer(({ open, onOpenChange }: UpdateCheckDialogProps) => {
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateResults, setUpdateResults] = useState<VersionCheckResult[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [updateProgress, setUpdateProgress] = useState(0)

  // 检查所有组件更新
  const handleCheckAll = async () => {
    const currentDoc = project.currentDocument
    if (!currentDoc || !currentDoc.rootNode) {
      setError('未找到当前文档')
      return
    }

    setChecking(true)
    setError(null)
    setUpdateResults([])
    setSelectedIds(new Set())

    try {
      const results = await versionManager.checkAllNodesUpdate(currentDoc.rootNode)
      const updatableResults = results.filter(r => r.hasUpdate)
      setUpdateResults(updatableResults)

      // 默认全选
      setSelectedIds(new Set(updatableResults.map(r => r.nodeId)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '检查更新失败')
    } finally {
      setChecking(false)
    }
  }

  // 打开对话框时自动检查
  useEffect(() => {
    if (open) {
      handleCheckAll()
    }
  }, [open])

  // 切换选择
  const toggleSelection = (nodeId: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(nodeId)) {
      newSelected.delete(nodeId)
    } else {
      newSelected.add(nodeId)
    }
    setSelectedIds(newSelected)
  }

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedIds.size === updateResults.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(updateResults.map(r => r.nodeId)))
    }
  }

  // 批量更新
  const handleBatchUpdate = async () => {
    if (selectedIds.size === 0) {
      return
    }

    setUpdating(true)
    setError(null)
    setUpdateProgress(0)

    const updates = updateResults
      .filter(r => selectedIds.has(r.nodeId))
      .map(r => ({
        nodeId: r.nodeId,
        componentName: r.componentName,
        targetVersion: r.latestVersion,
      }))

    try {
      await toast.promise(
        async () => {
          // 逐个更新并更新进度
          for (let i = 0; i < updates.length; i++) {
            await versionManager.updateNode(
              project.currentDocument!.getNode(updates[i].nodeId)!,
              updates[i].targetVersion,
            )
            setUpdateProgress(((i + 1) / updates.length) * 100)
          }

          // 更新成功后重新检查
          await handleCheckAll()
        },
        {
          loading: `正在更新 ${updates.length} 个组件...`,
          success: `成功更新 ${updates.length} 个组件到最新版本`,
          error: err => {
            const errorMessage = err instanceof Error ? err.message : '更新失败'
            setError(errorMessage)
            return `更新失败：${errorMessage}`
          },
        },
      )
    } finally {
      setUpdating(false)
      setUpdateProgress(0)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-2xl max-h-[80vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle>检查组件更新</DialogTitle>
          <DialogDescription>检查并更新画布中的远程组件到最新版本</DialogDescription>
        </DialogHeader>

        <div className='flex-1 overflow-y-auto'>
          {checking && (
            <div className='flex items-center justify-center py-8'>
              <RefreshCw className='w-6 h-6 animate-spin mr-2' />
              <span className='text-sm text-muted-foreground'>正在检查更新...</span>
            </div>
          )}

          {!checking && updateResults.length === 0 && !error && (
            <div className='flex items-center justify-center py-8'>
              <span className='text-sm text-muted-foreground'>所有组件都是最新版本</span>
            </div>
          )}

          {!checking && updateResults.length > 0 && (
            <div className='space-y-4'>
              {/* 全选 */}
              <div className='flex items-center gap-2 pb-2 border-b'>
                <Checkbox checked={selectedIds.size === updateResults.length} onCheckedChange={toggleSelectAll} />
                <span className='text-sm font-medium'>
                  全选 ({selectedIds.size}/{updateResults.length})
                </span>
              </div>

              {/* 更新列表 */}
              <div className='space-y-2'>
                {updateResults.map(result => (
                  <div
                    key={result.nodeId}
                    className='flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors'
                  >
                    <Checkbox
                      checked={selectedIds.has(result.nodeId)}
                      onCheckedChange={() => toggleSelection(result.nodeId)}
                    />
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2'>
                        <span className='font-medium text-sm'>{result.componentName}</span>
                        <span className='text-xs text-muted-foreground'>({result.nodeId})</span>
                      </div>
                      <div className='text-xs text-muted-foreground mt-1'>
                        <span className='font-mono'>{result.packageName}</span>
                      </div>
                      <div className='flex items-center gap-2 mt-2'>
                        <span className='text-xs px-2 py-0.5 bg-muted rounded'>{result.currentVersion}</span>
                        <span className='text-xs text-muted-foreground'>→</span>
                        <span className='text-xs px-2 py-0.5 bg-primary/10 text-primary rounded font-medium'>
                          {result.latestVersion}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className='p-4 bg-destructive/10 border border-destructive rounded-lg'>
              <p className='text-sm text-destructive'>{error}</p>
            </div>
          )}

          {updating && (
            <div className='mt-4 space-y-2'>
              <div className='flex items-center justify-between text-sm'>
                <span className='text-muted-foreground'>更新进度</span>
                <span className='font-medium'>{Math.round(updateProgress)}%</span>
              </div>
              <Progress value={updateProgress} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={updating}>
            取消
          </Button>
          <Button onClick={handleCheckAll} disabled={checking || updating} variant='outline'>
            <RefreshCw className='w-4 h-4 mr-2' />
            重新检查
          </Button>
          <Button onClick={handleBatchUpdate} disabled={checking || updating || selectedIds.size === 0}>
            更新选中 ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
