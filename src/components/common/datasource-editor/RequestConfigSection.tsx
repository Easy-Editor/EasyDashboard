import { CodeEditor } from '@/components/common/code-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'
import { REQUEST_BODY_TYPES } from './constants'
import type { DataSourceFormData, KeyValuePair } from './types'

interface RequestConfigSectionProps {
  formData: DataSourceFormData
  updateField: <K extends keyof DataSourceFormData>(field: K, value: DataSourceFormData[K]) => void
  updateArrayField: (field: 'params' | 'headers', index: number, key: 'key' | 'value', value: string) => void
  addArrayItem: (field: 'params' | 'headers') => void
  removeArrayItem: (field: 'params' | 'headers', index: number) => void
}

interface KeyValueListProps {
  label: string
  items: KeyValuePair[]
  field: 'params' | 'headers'
  keyPlaceholder: string
  valuePlaceholder: string
  updateArrayField: (field: 'params' | 'headers', index: number, key: 'key' | 'value', value: string) => void
  addArrayItem: (field: 'params' | 'headers') => void
  removeArrayItem: (field: 'params' | 'headers', index: number) => void
}

const KeyValueList = ({
  label,
  items,
  field,
  keyPlaceholder,
  valuePlaceholder,
  updateArrayField,
  addArrayItem,
  removeArrayItem,
}: KeyValueListProps) => (
  <div className='space-y-2'>
    <div className='flex items-center space-x-2'>
      <Label className='text-xs basis-20 text-right'>{label}:</Label>
      <Button variant='outline' className='h-8 text-xs px-4 py-[5px]' onClick={() => addArrayItem(field)}>
        <Plus className='w-3 h-3 mr-1' />
        添加
      </Button>
    </div>
    {items.length > 0 && (
      <div className='ml-[calc(5rem+0.5rem)] space-y-2'>
        {items.map((item, index) => (
          <div key={index} className='flex items-center space-x-2'>
            <Input
              placeholder={keyPlaceholder}
              className='h-8 !text-xs px-2 py-[5px] flex-1'
              value={item.key}
              onChange={e => updateArrayField(field, index, 'key', e.target.value)}
            />
            <Input
              placeholder={valuePlaceholder}
              className='h-8 !text-xs px-2 py-[5px] flex-1'
              value={item.value}
              onChange={e => updateArrayField(field, index, 'value', e.target.value)}
            />
            <Button variant='ghost' size='sm' className='h-8 w-8 p-0' onClick={() => removeArrayItem(field, index)}>
              <Trash2 className='w-3 h-3' />
            </Button>
          </div>
        ))}
      </div>
    )}
  </div>
)

export const RequestConfigSection = ({
  formData,
  updateField,
  updateArrayField,
  addArrayItem,
  removeArrayItem,
}: RequestConfigSectionProps) => {
  const showRequestBody = ['POST', 'PUT', 'PATCH'].includes(formData.method)

  return (
    <>
      <KeyValueList
        label='请求参数'
        items={formData.params}
        field='params'
        keyPlaceholder='参数名'
        valuePlaceholder='参数值'
        updateArrayField={updateArrayField}
        addArrayItem={addArrayItem}
        removeArrayItem={removeArrayItem}
      />

      <KeyValueList
        label='请求头信息'
        items={formData.headers}
        field='headers'
        keyPlaceholder='头信息名'
        valuePlaceholder='头信息值'
        updateArrayField={updateArrayField}
        addArrayItem={addArrayItem}
        removeArrayItem={removeArrayItem}
      />

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
                {REQUEST_BODY_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
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
    </>
  )
}
