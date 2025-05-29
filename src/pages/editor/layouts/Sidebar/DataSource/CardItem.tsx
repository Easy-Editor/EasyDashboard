import { AlertModal } from '@/components/common/AlertModal'
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
        <AlertModal
          title='确定删除吗？'
          description='删除后，该状态将无法恢复。'
          trigger='删除'
          disabled={del}
          onConfirm={onDelete}
        />
        <Separator orientation='vertical' />
        <AlertModal
          title='确定删除吗？'
          description='复制后，该状态将新增一个副本。'
          trigger='复制'
          disabled={copy}
          onConfirm={onCopy}
        />
      </div>
    </div>
  )
}
