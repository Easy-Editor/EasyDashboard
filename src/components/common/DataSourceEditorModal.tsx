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
import type { JSFunction, JSONObject } from '@easy-editor/core'
import type { InterpretDataSourceConfig } from '@easy-editor/plugin-datasource'
import { Plus, Trash2 } from 'lucide-react'
import { observer } from 'mobx-react'
import { type PropsWithChildren, useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface DataSourceEditorModalProps extends PropsWithChildren {
  open: boolean
  onConfirm?: (dataSource: InterpretDataSourceConfig) => void
  onClose?: () => void
  dataSource?: InterpretDataSourceConfig
}

interface KeyValuePair {
  key: string
  value: string
}

export const DataSourceEditorModal = observer((props: DataSourceEditorModalProps) => {
  const { dataSource, open, onConfirm, onClose, children } = props
  const [id, setId] = useState(dataSource?.id || '')
  const [type, setType] = useState(dataSource?.type || 'fetch')
  const [method, setMethod] = useState((dataSource?.options?.method as string) || 'GET')
  const [uri, setUri] = useState((dataSource?.options?.uri as string) || '')
  const [isSync, setIsSync] = useState((dataSource?.options?.isSync as boolean) ?? true)
  const [timeout, setTimeout] = useState((dataSource?.options?.timeout as number) || 5000)
  const [isCors, setIsCors] = useState((dataSource?.options?.isCors as boolean) ?? true)

  // 请求参数
  const [params, setParams] = useState<KeyValuePair[]>([])

  // 请求头信息
  const [headers, setHeaders] = useState<KeyValuePair[]>([])

  // 请求体内容 (用于POST等请求)
  const [requestBody, setRequestBody] = useState('')
  const [requestBodyType, setRequestBodyType] = useState<'json' | 'form' | 'text'>('json')

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

  // 初始化参数和头信息
  useEffect(() => {
    if (dataSource) {
      setId(dataSource.id)
      setType(dataSource.type || 'fetch')
      setMethod((dataSource.options?.method as string) || 'GET')
      setUri((dataSource.options?.uri as string) || '')
      setIsSync((dataSource.options?.isSync as boolean) ?? true)
      setTimeout((dataSource.options?.timeout as number) || 5000)
      setIsCors((dataSource.options?.isCors as boolean) ?? true)

      // 解析参数
      const paramsObj = dataSource.options?.params as JSONObject
      if (paramsObj && typeof paramsObj === 'object') {
        const paramsList = Object.entries(paramsObj).map(([key, value]) => ({
          key,
          value: String(value),
        }))
        setParams(paramsList)
      } else {
        setParams([])
      }

      // 解析头信息
      const headersObj = dataSource.options?.headers as JSONObject
      if (headersObj && typeof headersObj === 'object') {
        const headersList = Object.entries(headersObj).map(([key, value]) => ({
          key,
          value: String(value),
        }))
        setHeaders(headersList)
      } else {
        setHeaders([])
      }

      // 解析请求体
      const body = (dataSource.options as any)?.body
      if (body) {
        if (typeof body === 'string') {
          setRequestBody(body)
          setRequestBodyType('text')
        } else {
          setRequestBody(JSON.stringify(body, null, 2))
          setRequestBodyType('json')
        }
      } else {
        setRequestBody('')
        setRequestBodyType('json')
      }

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

    // 构建参数对象
    const paramsObj: JSONObject = {}
    params.forEach(param => {
      if (param.key.trim()) {
        paramsObj[param.key] = param.value
      }
    })

    // 构建头信息对象
    const headersObj: JSONObject = {}
    headers.forEach(header => {
      if (header.key.trim()) {
        headersObj[header.key] = header.value
      }
    })

    // 构建请求体
    let bodyData: any = undefined
    if (requestBody.trim() && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (requestBodyType === 'json') {
        try {
          bodyData = JSON.parse(requestBody)
        } catch (e) {
          toast.warning('请求体JSON格式错误')
          return
        }
      } else {
        bodyData = requestBody
      }
    }

    const options: any = {
      method,
      uri,
      isSync,
      timeout,
      isCors,
      params: paramsObj,
      headers: headersObj,
    }

    if (bodyData !== undefined) {
      options.body = bodyData
    }

    const newDataSource: InterpretDataSourceConfig = {
      id,
      type,
      options,
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
      setIsCors(true)
      setParams([])
      setHeaders([])
      setRequestBody('')
      setRequestBodyType('json')
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

  // 添加参数
  const handleAddParam = () => {
    setParams([...params, { key: '', value: '' }])
  }

  // 删除参数
  const handleRemoveParam = (index: number) => {
    setParams(params.filter((_, i) => i !== index))
  }

  // 更新参数
  const handleUpdateParam = (index: number, field: 'key' | 'value', value: string) => {
    const newParams = [...params]
    newParams[index][field] = value
    setParams(newParams)
  }

  // 添加头信息
  const handleAddHeader = () => {
    setHeaders([...headers, { key: '', value: '' }])
  }

  // 删除头信息
  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index))
  }

  // 更新头信息
  const handleUpdateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaders = [...headers]
    newHeaders[index][field] = value
    setHeaders(newHeaders)
  }

  const showRequestBody = ['POST', 'PUT', 'PATCH'].includes(method)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {children}
      <DialogContent className='!max-w-[1200px] max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>数据源{isEdit ? `编辑 - ${id}` : '新增'}</DialogTitle>
          <DialogDescription className='flex flex-col gap-4 mt-2'>
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
                  <SelectItem value='PATCH'>PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='isCors' className='text-xs basis-20 text-right'>
                是否支持跨域:
              </Label>
              <Switch checked={isCors} onCheckedChange={setIsCors} />
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

            {/* 请求参数 */}
            <div className='space-y-2'>
              <div className='flex items-center space-x-2'>
                <Label className='text-xs basis-20 text-right'>请求参数:</Label>
                <Button variant='outline' className='h-8 text-xs px-4 py-[5px]' onClick={handleAddParam}>
                  <Plus className='w-3 h-3 mr-1' />
                  添加
                </Button>
              </div>
              {params.length > 0 && (
                <div className='ml-[calc(5rem+0.5rem)] space-y-2'>
                  {params.map((param, index) => (
                    <div key={index} className='flex items-center space-x-2'>
                      <Input
                        placeholder='参数名'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={param.key}
                        onChange={e => handleUpdateParam(index, 'key', e.target.value)}
                      />
                      <Input
                        placeholder='参数值'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={param.value}
                        onChange={e => handleUpdateParam(index, 'value', e.target.value)}
                      />
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-8 w-8 p-0'
                        onClick={() => handleRemoveParam(index)}
                      >
                        <Trash2 className='w-3 h-3' />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 请求头信息 */}
            <div className='space-y-2'>
              <div className='flex items-center space-x-2'>
                <Label className='text-xs basis-20 text-right'>请求头信息:</Label>
                <Button variant='outline' className='h-8 text-xs px-4 py-[5px]' onClick={handleAddHeader}>
                  <Plus className='w-3 h-3 mr-1' />
                  添加
                </Button>
              </div>
              {headers.length > 0 && (
                <div className='ml-[calc(5rem+0.5rem)] space-y-2'>
                  {headers.map((header, index) => (
                    <div key={index} className='flex items-center space-x-2'>
                      <Input
                        placeholder='头信息名'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={header.key}
                        onChange={e => handleUpdateHeader(index, 'key', e.target.value)}
                      />
                      <Input
                        placeholder='头信息值'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={header.value}
                        onChange={e => handleUpdateHeader(index, 'value', e.target.value)}
                      />
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-8 w-8 p-0'
                        onClick={() => handleRemoveHeader(index)}
                      >
                        <Trash2 className='w-3 h-3' />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 请求体内容 (仅在POST/PUT/PATCH时显示) */}
            {showRequestBody && (
              <div className='space-y-2'>
                <div className='flex items-center space-x-2'>
                  <Label className='text-xs basis-20 text-right'>请求体类型:</Label>
                  <Select
                    value={requestBodyType}
                    onValueChange={(value: 'json' | 'form' | 'text') => setRequestBodyType(value)}
                  >
                    <SelectTrigger className='h-8 !text-xs w-32'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='json'>JSON</SelectItem>
                      <SelectItem value='form'>Form Data</SelectItem>
                      <SelectItem value='text'>Text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='flex space-x-2'>
                  <Label className='text-xs basis-20 text-right'>请求体内容:</Label>
                  <div className='flex-1'>
                    {requestBodyType === 'json' ? (
                      <CodeEditor
                        language='json'
                        value={requestBody}
                        onChange={value => setRequestBody(value || '')}
                        height='120px'
                      />
                    ) : (
                      <textarea
                        placeholder={requestBodyType === 'form' ? '请输入表单数据' : '请输入文本内容'}
                        className='flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                        value={requestBody}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRequestBody(e.target.value)}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className='flex space-x-2 flex-1'>
              <Label htmlFor='dataHandler' className='text-xs basis-20 text-right'>
                数据处理函数:
              </Label>
              <div className='flex-1'>
                <CodeEditor
                  language='javascript'
                  value={dataHandlerCode}
                  onChange={handleDataHandlerChange}
                  height='200px'
                />
              </div>
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
