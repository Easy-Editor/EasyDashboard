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

interface DataSourceFormData {
  id: string
  type: string
  method: string
  uri: string
  isSync: boolean
  timeout: number
  isCors: boolean
  params: KeyValuePair[]
  headers: KeyValuePair[]
  requestBody: string
  requestBodyType: 'json' | 'form' | 'text'
  dataHandler: string
  shouldFetch: string
  willFetch: string
  errorHandler: string
  enableShouldFetch: boolean
  enableWillFetch: boolean
  enableDataHandler: boolean
  enableErrorHandler: boolean
}

const defaultShouldFetch = `function shouldFetch(options) {
  return true
}`

const defaultWillFetch = `function willFetch(options) {
  return options
}`

const defaultDataHandler = `function dataHandler(response) {
  return response.data
}`

const defaultErrorHandler = `function errorHandler(error) {
  console.error('Data source error:', error)
  throw error
}`

const createDefaultFormData = (): DataSourceFormData => ({
  id: '',
  type: 'fetch',
  method: 'GET',
  uri: '',
  isSync: false,
  timeout: 5000,
  isCors: true,
  params: [],
  headers: [],
  requestBody: '',
  requestBodyType: 'json',
  shouldFetch: defaultShouldFetch,
  willFetch: defaultWillFetch,
  dataHandler: defaultDataHandler,
  errorHandler: defaultErrorHandler,
  enableShouldFetch: false,
  enableWillFetch: false,
  enableDataHandler: true,
  enableErrorHandler: false,
})

const parseDataSourceToFormData = (dataSource: InterpretDataSourceConfig): DataSourceFormData => {
  // 解析参数
  const paramsObj = dataSource.options?.params as JSONObject
  const params: KeyValuePair[] =
    paramsObj && typeof paramsObj === 'object'
      ? Object.entries(paramsObj).map(([key, value]) => ({ key, value: String(value) }))
      : []

  // 解析头信息
  const headersObj = dataSource.options?.headers as JSONObject
  const headers: KeyValuePair[] =
    headersObj && typeof headersObj === 'object'
      ? Object.entries(headersObj).map(([key, value]) => ({ key, value: String(value) }))
      : []

  // 解析请求体
  const body = (dataSource.options as any)?.body
  let requestBody = ''
  let requestBodyType: 'json' | 'form' | 'text' = 'json'

  if (body) {
    if (typeof body === 'string') {
      requestBody = body
      requestBodyType = 'text'
    } else {
      requestBody = JSON.stringify(body, null, 2)
      requestBodyType = 'json'
    }
  }

  return {
    id: dataSource.id,
    type: dataSource.type || 'fetch',
    method: (dataSource.options?.method as string) || 'GET',
    uri: (dataSource.options?.uri as string) || '',
    isSync: (dataSource.options?.isSync as boolean) ?? true,
    timeout: (dataSource.options?.timeout as number) || 5000,
    isCors: (dataSource.options?.isCors as boolean) ?? true,
    params,
    headers,
    requestBody,
    requestBodyType,
    shouldFetch: (dataSource.shouldFetch as JSFunction)?.value || defaultShouldFetch,
    willFetch: (dataSource.willFetch as JSFunction)?.value || defaultWillFetch,
    dataHandler: (dataSource.dataHandler as JSFunction)?.value || defaultDataHandler,
    errorHandler: (dataSource.errorHandler as JSFunction)?.value || defaultErrorHandler,
    enableShouldFetch: !!(dataSource.shouldFetch as JSFunction)?.value,
    enableWillFetch: !!(dataSource.willFetch as JSFunction)?.value,
    enableDataHandler: !!(dataSource.dataHandler as JSFunction)?.value,
    enableErrorHandler: !!(dataSource.errorHandler as JSFunction)?.value,
  }
}

export const DataSourceEditorModal = observer((props: DataSourceEditorModalProps) => {
  const { dataSource, open, onConfirm, onClose, children } = props
  const isEdit = !!dataSource?.id

  const [formData, setFormData] = useState<DataSourceFormData>(createDefaultFormData)

  useEffect(() => {
    if (dataSource) {
      setFormData(parseDataSourceToFormData(dataSource))
    } else {
      setFormData(createDefaultFormData())
    }
  }, [dataSource])

  const updateField = <K extends keyof DataSourceFormData>(field: K, value: DataSourceFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const updateArrayField = (field: 'params' | 'headers', index: number, key: 'key' | 'value', value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }))
  }

  const addArrayItem = (field: 'params' | 'headers') => {
    setFormData(prev => ({
      ...prev,
      [field]: [...prev[field], { key: '', value: '' }],
    }))
  }

  const removeArrayItem = (field: 'params' | 'headers', index: number) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index),
    }))
  }

  const handleConfirm = () => {
    if (!formData.id) {
      toast.warning('请输入数据源ID')
      return
    }

    if (!formData.uri && formData.type === 'fetch') {
      toast.warning('请输入请求地址')
      return
    }

    const paramsObj: JSONObject = {}
    formData.params.forEach(param => {
      if (param.key.trim()) {
        paramsObj[param.key] = param.value
      }
    })

    const headersObj: JSONObject = {}
    formData.headers.forEach(header => {
      if (header.key.trim()) {
        headersObj[header.key] = header.value
      }
    })

    let bodyData: any = undefined
    if (formData.requestBody.trim() && ['POST', 'PUT', 'PATCH'].includes(formData.method)) {
      if (formData.requestBodyType === 'json') {
        try {
          bodyData = JSON.parse(formData.requestBody)
        } catch (e) {
          toast.warning('请求体JSON格式错误')
          return
        }
      } else {
        bodyData = formData.requestBody
      }
    }

    const options: any = {
      method: formData.method,
      uri: formData.uri,
      isSync: formData.isSync,
      timeout: formData.timeout,
      isCors: formData.isCors,
      params: paramsObj,
      headers: headersObj,
    }

    if (bodyData !== undefined) {
      options.body = bodyData
    }

    const newDataSource: InterpretDataSourceConfig = {
      id: formData.id,
      type: formData.type,
      options,
      shouldFetch:
        formData.enableShouldFetch && formData.shouldFetch
          ? {
              type: 'JSFunction',
              value: formData.shouldFetch,
            }
          : undefined,
      willFetch:
        formData.enableWillFetch && formData.willFetch
          ? {
              type: 'JSFunction',
              value: formData.willFetch,
            }
          : undefined,
      dataHandler:
        formData.enableDataHandler && formData.dataHandler
          ? {
              type: 'JSFunction',
              value: formData.dataHandler,
            }
          : undefined,
      errorHandler:
        formData.enableErrorHandler && formData.errorHandler
          ? {
              type: 'JSFunction',
              value: formData.errorHandler,
            }
          : undefined,
    }

    onConfirm?.(newDataSource)
    onClose?.()
  }

  const handleClose = () => {
    if (!isEdit) {
      setFormData(createDefaultFormData())
    }
    onClose?.()
  }

  const showRequestBody = ['POST', 'PUT', 'PATCH'].includes(formData.method)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {children}
      <DialogContent className='!max-w-[1200px] max-h-[90vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>数据源{isEdit ? `编辑 - ${formData.id}` : '新增'}</DialogTitle>
          <DialogDescription className='flex flex-col gap-4 mt-2'>
            <div className='flex items-center space-x-2'>
              <Label htmlFor='id' className='text-xs basis-20 text-right'>
                数据源ID:
              </Label>
              <Input
                id='id'
                placeholder='请输入数据源ID'
                className='h-8 !text-xs px-2 py-[5px]'
                value={formData.id}
                onChange={e => updateField('id', e.target.value)}
                disabled={isEdit}
              />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='type' className='text-xs basis-20 text-right'>
                类型:
              </Label>
              <Select value={formData.type} onValueChange={value => updateField('type', value)}>
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
              <Switch checked={formData.isSync} onCheckedChange={checked => updateField('isSync', checked)} />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='uri' className='text-xs basis-20 text-right'>
                请求地址:
              </Label>
              <Input
                id='uri'
                placeholder='请输入请求地址'
                className='h-8 !text-xs px-2 py-[5px]'
                value={formData.uri}
                onChange={e => updateField('uri', e.target.value)}
              />
            </div>

            <div className='flex items-center space-x-2'>
              <Label htmlFor='method' className='text-xs basis-20 text-right'>
                请求方法:
              </Label>
              <Select value={formData.method} onValueChange={value => updateField('method', value)}>
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
              <Switch checked={formData.isCors} onCheckedChange={checked => updateField('isCors', checked)} />
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
                value={formData.timeout}
                onChange={e => updateField('timeout', Number(e.target.value))}
              />
            </div>

            {/* 请求参数 */}
            <div className='space-y-2'>
              <div className='flex items-center space-x-2'>
                <Label className='text-xs basis-20 text-right'>请求参数:</Label>
                <Button variant='outline' className='h-8 text-xs px-4 py-[5px]' onClick={() => addArrayItem('params')}>
                  <Plus className='w-3 h-3 mr-1' />
                  添加
                </Button>
              </div>
              {formData.params.length > 0 && (
                <div className='ml-[calc(5rem+0.5rem)] space-y-2'>
                  {formData.params.map((param, index) => (
                    <div key={index} className='flex items-center space-x-2'>
                      <Input
                        placeholder='参数名'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={param.key}
                        onChange={e => updateArrayField('params', index, 'key', e.target.value)}
                      />
                      <Input
                        placeholder='参数值'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={param.value}
                        onChange={e => updateArrayField('params', index, 'value', e.target.value)}
                      />
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-8 w-8 p-0'
                        onClick={() => removeArrayItem('params', index)}
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
                <Button variant='outline' className='h-8 text-xs px-4 py-[5px]' onClick={() => addArrayItem('headers')}>
                  <Plus className='w-3 h-3 mr-1' />
                  添加
                </Button>
              </div>
              {formData.headers.length > 0 && (
                <div className='ml-[calc(5rem+0.5rem)] space-y-2'>
                  {formData.headers.map((header, index) => (
                    <div key={index} className='flex items-center space-x-2'>
                      <Input
                        placeholder='头信息名'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={header.key}
                        onChange={e => updateArrayField('headers', index, 'key', e.target.value)}
                      />
                      <Input
                        placeholder='头信息值'
                        className='h-8 !text-xs px-2 py-[5px] flex-1'
                        value={header.value}
                        onChange={e => updateArrayField('headers', index, 'value', e.target.value)}
                      />
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-8 w-8 p-0'
                        onClick={() => removeArrayItem('headers', index)}
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
                    value={formData.requestBodyType}
                    onValueChange={(value: 'json' | 'form' | 'text') => updateField('requestBodyType', value)}
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
                    {formData.requestBodyType === 'json' ? (
                      <CodeEditor
                        language='json'
                        value={formData.requestBody}
                        onChange={value => updateField('requestBody', value || '')}
                        height='120px'
                      />
                    ) : (
                      <textarea
                        placeholder={formData.requestBodyType === 'form' ? '请输入表单数据' : '请输入文本内容'}
                        className='flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                        value={formData.requestBody}
                        onChange={e => updateField('requestBody', e.target.value)}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 数据处理函数配置 */}
            <div className='space-y-4'>
              <div className='text-sm font-medium'>数据处理函数配置</div>

              {/* shouldFetch 函数 */}
              <div className='space-y-2'>
                <div className='flex items-center space-x-2'>
                  <Switch
                    checked={formData.enableShouldFetch}
                    onCheckedChange={checked => updateField('enableShouldFetch', checked)}
                  />
                  <Label className='text-xs'>启用 shouldFetch (请求前置条件判断)</Label>
                </div>
                {formData.enableShouldFetch && (
                  <div className='ml-6'>
                    <CodeEditor
                      language='javascript'
                      value={formData.shouldFetch}
                      onChange={value => updateField('shouldFetch', value || defaultShouldFetch)}
                      height='120px'
                    />
                  </div>
                )}
              </div>

              {/* willFetch 函数 */}
              <div className='space-y-2'>
                <div className='flex items-center space-x-2'>
                  <Switch
                    checked={formData.enableWillFetch}
                    onCheckedChange={checked => updateField('enableWillFetch', checked)}
                  />
                  <Label className='text-xs'>启用 willFetch (请求参数预处理)</Label>
                </div>
                {formData.enableWillFetch && (
                  <div className='ml-6'>
                    <CodeEditor
                      language='javascript'
                      value={formData.willFetch}
                      onChange={value => updateField('willFetch', value || defaultWillFetch)}
                      height='120px'
                    />
                  </div>
                )}
              </div>

              {/* dataHandler 函数 */}
              <div className='space-y-2'>
                <div className='flex items-center space-x-2'>
                  <Switch
                    checked={formData.enableDataHandler}
                    onCheckedChange={checked => updateField('enableDataHandler', checked)}
                  />
                  <Label className='text-xs'>启用 dataHandler (响应数据处理)</Label>
                </div>
                {formData.enableDataHandler && (
                  <div className='ml-6'>
                    <CodeEditor
                      language='javascript'
                      value={formData.dataHandler}
                      onChange={value => updateField('dataHandler', value || defaultDataHandler)}
                      height='160px'
                    />
                  </div>
                )}
              </div>

              {/* errorHandler 函数 */}
              <div className='space-y-2'>
                <div className='flex items-center space-x-2'>
                  <Switch
                    checked={formData.enableErrorHandler}
                    onCheckedChange={checked => updateField('enableErrorHandler', checked)}
                  />
                  <Label className='text-xs'>启用 errorHandler (错误处理)</Label>
                </div>
                {formData.enableErrorHandler && (
                  <div className='ml-6'>
                    <CodeEditor
                      language='javascript'
                      value={formData.errorHandler || defaultErrorHandler}
                      onChange={value => updateField('errorHandler', value || defaultErrorHandler)}
                      height='120px'
                    />
                  </div>
                )}
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
