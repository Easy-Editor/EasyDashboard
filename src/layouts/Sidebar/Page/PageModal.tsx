import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { observer } from 'mobx-react'
import { type PropsWithChildren, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface PageModalProps extends PropsWithChildren {
  open: boolean
  onConfirm?: (formData: {
    fileName: string
    fileDesc: string
  }) => void
  onClose?: () => void
  data?: {
    fileName: string
    fileDesc: string
  }
}

export const PageModal = observer((props: PageModalProps) => {
  const { data, open, onConfirm, onClose, children } = props
  const isEdit = !!data
  const [fileName, setFileName] = useState(data?.fileName)
  const [fileDesc, setFileDesc] = useState(data?.fileDesc)

  const handleConfirm = () => {
    if (!fileName) {
      toast.error('请输入页面名称')
      return
    }

    if (!fileDesc) {
      toast.error('请输入页面描述')
      return
    }

    onConfirm?.({
      fileName,
      fileDesc,
    })
    onClose?.()
  }

  useEffect(() => {
    setFileName(data?.fileName)
    setFileDesc(data?.fileDesc)
  }, [data])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      {children}
      <DialogContent className='!max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>页面{isEdit ? `编辑 - ${data.fileName}` : '新增'}</DialogTitle>
          <DialogDescription className='flex flex-col gap-4 h-[1test00px] mt-2'>
            <div className='flex items-center space-x-2'>
              <Label htmlFor='fileDesc' className='text-xs basis-15 text-right'>
                页面名称:
              </Label>
              <Input
                id='fileDesc'
                placeholder='请输入页面名称'
                className='h-8 !text-xs px-2 py-[5px]'
                value={fileDesc}
                onChange={e => setFileDesc(e.target.value)}
              />
            </div>
            <div className='flex items-center space-x-2'>
              <Label htmlFor='fileName' className='text-xs basis-15 text-right'>
                页面标识:
              </Label>
              <Input
                id='fileName'
                placeholder='请输入页面标识'
                className='h-8 !text-xs px-2 py-[5px]'
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                disabled={isEdit}
              />
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type='submit' onClick={handleConfirm} className='h-8 text-xs px-4 py-[5px]'>
            确定
          </Button>
          <Button variant='outline' onClick={onClose} className='h-8 text-xs px-4 py-[5px]'>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
