import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export const CardItem = ({
  name,
  description,
  onEdit,
  onDelete,
  onCopy,
  disabled,
}: {
  name: string
  description?: string
  onEdit?: () => void
  onDelete?: () => void
  onCopy?: () => void
  disabled?:
    | boolean
    | {
        edit?: boolean
        del?: boolean
        copy?: boolean
      }
}) => {
  const {
    edit = false,
    del = false,
    copy = false,
  } = typeof disabled === 'boolean' ? { edit: disabled, del: disabled, copy: disabled } : (disabled ?? {})

  return (
    <div>
      <div className='space-y-1'>
        <h4 className='text-sm font-medium leading-none mb-2'>{name}</h4>
        <p className='text-xs text-muted-foreground'>{description ?? '-'}</p>
      </div>
      <Separator className='my-3' />
      <div className='flex h-4 items-center space-x-4 text-xs'>
        <Button
          variant='link'
          className='hover:text-primary transition-colors cursor-pointer text-xs px-0 py-0'
          onClick={onEdit}
          disabled={edit}
        >
          编辑
        </Button>
        <Separator orientation='vertical' />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant='link'
              className='hover:text-primary transition-colors cursor-pointer text-xs px-0 py-0'
              disabled={del}
            >
              删除
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定删除吗？</AlertDialogTitle>
              <AlertDialogDescription>删除后，该状态将无法恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className='h-8 text-xs px-4 py-[5px]'>取消</AlertDialogCancel>
              <AlertDialogAction className='h-8 text-xs px-4 py-[5px]' onClick={onDelete}>
                确定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Separator orientation='vertical' />

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant='link'
              className='hover:text-primary transition-colors cursor-pointer text-xs px-0 py-0'
              disabled={copy}
            >
              复制
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定复制吗？</AlertDialogTitle>
              <AlertDialogDescription>复制后，该状态将新增一个副本。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className='h-8 text-xs px-4 py-[5px]'>取消</AlertDialogCancel>
              <AlertDialogAction className='h-8 text-xs px-4 py-[5px]' onClick={onCopy}>
                确定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
