import { CodeEditor } from '@/components/common/CodeEditor'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { JSFunction } from '@easy-editor/core'
import type { InterpretDataSourceConfig } from '@easy-editor/plugin-datasource'
import { observer } from 'mobx-react'
import { type PropsWithChildren, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface DataSourceEditorModalProps extends PropsWithChildren {
  open: boolean
  onConfirm?: (dataSource: InterpretDataSourceConfig) => void
  onClose?: () => void
  dataSource?: InterpretDataSourceConfig
}

export const DataSourceEditorModal = observer((props: DataSourceEditorModalProps) => {
  const { dataSource, open, onConfirm, onClose, children } = props
  const [id, setId] = useState(dataSource?.id || '')
  const [type, setType] = useState(dataSource?.type || 'fetch')
  const [method, setMethod] = useState((dataSource?.options?.method as string) || 'GET')
  const [uri, setUri] = useState((dataSource?.options?.uri as string) || '')
  const [isSync, setIsSync] = useState((dataSource?.options?.isSync as boolean) ?? true)
  const [timeout, setTimeout] = useState((dataSource?.options?.timeout as number) || 5000)
  const [dataHandlerCode, setDataHandlerCode] = useState(
    (dataSource?.dataHandler as JSFunction)?.value ||
      `function(response) {
  if (response.data.code !== 200){
    throw new Error(response.data.message);
  }
  return response.data.result;
}`,
  )

  const isEdit = !!dataSource?.id

  const handleConfirm = () => {
    if (!id) {
      toast.warning('请输入数据源ID')
      return
    }

    if (!uri && type === 'fetch') {
      toast.warning('请输入请求地址')
      return
    }

    if (!dataHandlerCode) {
      toast.warning('请输入数据处理函数')
      return
    }

    const newDataSource: InterpretDataSourceConfig = {
      id,
      type,
      options: {
        method,
        uri,
        isSync,
        timeout,
      },
      dataHandler: {
        type: 'JSFunction',
        value: dataHandlerCode,
      } as JSFunction,
    }

    onConfirm?.(newDataSource)
    onClose?.()
  }

  const handleClose = () => {
    // Reset form when closing
    if (!isEdit) {
      setId('')
      setType('fetch')
      setMethod('GET')
      setUri('')
      setIsSync(true)
      setTimeout(5000)
      setDataHandlerCode(`function(response) {
  if (response.data.code !== 200){
    throw new Error(response.data.message);
  }
  return response.data.result;
}`)
    }
    onClose?.()
  }

  const handleDataHandlerChange = (value: string | undefined) => {
    setDataHandlerCode(value || '')
  }

  useEffect(() => {
    if (dataSource) {
      setId(dataSource.id)
      setType(dataSource.type || 'fetch')
      setMethod((dataSource.options?.method as string) || 'GET')
      setUri((dataSource.options?.uri as string) || '')
      setIsSync((dataSource.options?.isSync as boolean) ?? true)
      setTimeout((dataSource.options?.timeout as number) || 5000)
      setDataHandlerCode(
        (dataSource.dataHandler as JSFunction)?.value ||
          `function(response) {
  if (response.data.code !== 200){
    throw new Error(response.data.message);
  }
  return response.data.result;
}`,
      )
    }
  }, [dataSource])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {children}
      <DialogContent className='!max-w-[1000px]'>
        <DialogHeader>
          <DialogTitle>数据源{isEdit ? `编辑 - ${id}` : '新增'}</DialogTitle>
          <DialogDescription className='flex flex-col gap-4 h-[600px] mt-2'>
            <div className='flex items-center space-x-2'>
              <Label htmlFor='id' className='text-xs basis-20 text-right'>
                数据源ID:
              </Label>
              <Input
                id='id'
                placeholder='请输入数据源ID'
                className='h-8 !text-xs px-2 py-[5px]'
                value={id}
                onChange={e => setId(e.target.value)}
                disabled={isEdit}
              />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='type' className='text-xs basis-20 text-right'>
                类型:
              </Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className='h-8 !text-xs'>
                  <SelectValue placeholder='选择类型' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='fetch'>fetch</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='isSync' className='text-xs basis-20 text-right'>
                是否自动请求:
              </Label>
              <Switch checked={isSync} onCheckedChange={setIsSync} />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='uri' className='text-xs basis-20 text-right'>
                请求地址:
              </Label>
              <Input
                id='uri'
                placeholder='请输入请求地址'
                className='h-8 !text-xs px-2 py-[5px]'
                value={uri}
                onChange={e => setUri(e.target.value)}
              />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='method' className='text-xs basis-20 text-right'>
                请求方法:
              </Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className='h-8 !text-xs'>
                  <SelectValue placeholder='选择请求方法' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='GET'>GET</SelectItem>
                  <SelectItem value='POST'>POST</SelectItem>
                  <SelectItem value='PUT'>PUT</SelectItem>
                  <SelectItem value='DELETE'>DELETE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='isSync2' className='text-xs basis-20 text-right'>
                是否支持跨域:
              </Label>
              <Switch checked={true} onCheckedChange={() => {}} />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='timeout' className='text-xs basis-20 text-right'>
                超时时间(毫秒):
              </Label>
              <Input
                id='timeout'
                type='number'
                placeholder='请输入超时时间'
                className='h-8 !text-xs px-2 py-[5px]'
                value={timeout}
                onChange={e => setTimeout(Number(e.target.value))}
              />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='params' className='text-xs basis-20 text-right'>
                请求参数:
              </Label>
              <Button variant='outline' className='h-8 text-xs px-4 py-[5px]'>
                + 添加
              </Button>
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='headers' className='text-xs basis-20 text-right'>
                请求头信息:
              </Label>
              <Button variant='outline' className='h-8 text-xs px-4 py-[5px]'>
                + 添加
              </Button>
            </div>

            <div className='flex space-x-2 flex-1'>
              <Label htmlFor='dataHandler' className='text-xs basis-20 text-right'>
                数据处理函数:
              </Label>
              <CodeEditor language='javascript' value={dataHandlerCode} onChange={handleDataHandlerChange} />
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type='submit' onClick={handleConfirm} className='h-8 text-xs px-4 py-[5px]'>
            确定
          </Button>
          <Button variant='outline' onClick={handleClose} className='h-8 text-xs px-4 py-[5px]'>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})
