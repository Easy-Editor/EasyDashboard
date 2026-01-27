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
import { Spinner } from '@/components/ui/spinner'
import type { NpmInfo, SetterProps } from '@easy-editor/core'
import { CircleFadingArrowUp } from 'lucide-react'
import { observer } from 'mobx-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { VersionCheckResult } from '../../../remote/managers'
import { versionManager } from '../../../remote/managers'

interface NodeInfoSetterProps extends SetterProps<unknown> {}

const NodeInfoSetter = observer((props: NodeInfoSetterProps) => {
  const { selected } = props
  const isRemote = selected.isRemote

  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [versionInfo, setVersionInfo] = useState<VersionCheckResult | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // 判断是否有更新
  const hasUpdate = versionInfo?.hasUpdate ?? false
  // 获取节点的 npm 信息
  const npm = selected.getExtraPropValue('npm') as NpmInfo | undefined

  // 检查更新
  const handleCheckUpdate = async () => {
    setChecking(true)

    try {
      const result = await versionManager.checkNodeUpdate(selected)
      setVersionInfo(result)
    } catch (err) {
      console.log('检查更新失败', err)
    } finally {
      setChecking(false)
    }
  }

  // 打开确认对话框
  const handleClickUpdate = () => {
    setShowConfirmDialog(true)
  }

  // 确认后执行更新
  const handleConfirmUpdate = async () => {
    if (!versionInfo) return

    setShowConfirmDialog(false)
    setUpdating(true)

    try {
      toast.promise(
        async () => {
          await versionManager.updateNode(selected, versionInfo.latestVersion)
          // 更新成功后重新检查
          await handleCheckUpdate()
        },
        {
          loading: `正在更新到 v${versionInfo.latestVersion}...`,
          success: `成功更新到 v${versionInfo.latestVersion}`,
          error: err => {
            const errorMessage = err instanceof Error ? err.message : '更新失败'
            return `更新失败：${errorMessage}`
          },
        },
      )
    } finally {
      setUpdating(false)
    }
  }

  // 组件挂载时自动检查更新
  useEffect(() => {
    if (isRemote && npm) {
      handleCheckUpdate()
    }
  }, [selected.id])

  return (
    <>
      <div className='w-full flex justify-between'>
        <div className='flex flex-col gap-1'>
          <p className='leading-7'>
            {selected.title || selected.componentMeta.title} | {selected.id}
          </p>
          <p className='text-xs text-muted-foreground'>
            {isRemote ? `v${npm?.version} | ${selected.componentName}` : selected.componentName}
          </p>
        </div>
        {isRemote && hasUpdate && (
          <Button
            className='w-7 h-7 relative'
            variant='ghost'
            size='icon'
            onClick={handleClickUpdate}
            disabled={updating || checking}
            title={`更新到最新版本： v${versionInfo?.latestVersion}`}
          >
            {updating ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <>
                <CircleFadingArrowUp className='w-4 h-4' />
                {/* 蓝色小圆点指示器 */}
                <span className='absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-blue-500 rounded-full' />
              </>
            )}
          </Button>
        )}
      </div>

      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认更新组件</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要将组件从 <span className='font-semibold'>v{npm?.version}</span> 更新到{' '}
              <span className='font-semibold'>v{versionInfo?.latestVersion}</span> 吗？
              <br />
              <br />
              更新可能会改变组件的行为或属性配置，请确保您已经保存了当前的工作内容。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUpdate}>确认更新</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})

export default NodeInfoSetter
