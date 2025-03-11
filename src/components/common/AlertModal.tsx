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

interface AlertModalProps {
  onCancel?: () => void
  onConfirm?: () => void
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  trigger: React.ReactNode | string
  disabled?: boolean
}

export const AlertModal = ({
  disabled,
  onCancel,
  onConfirm,
  description,
  trigger,
  title = '提示',
  confirmText = '确定',
  cancelText = '取消',
}: AlertModalProps) => {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {typeof trigger === 'string' ? (
          <Button
            variant='link'
            className='hover:text-primary transition-colors cursor-pointer text-xs px-0 py-0'
            disabled={disabled}
          >
            {trigger}
          </Button>
        ) : (
          trigger
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className='h-8 text-xs px-4 py-[5px]' onClick={onCancel}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction className='h-8 text-xs px-4 py-[5px]' onClick={onConfirm}>
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
