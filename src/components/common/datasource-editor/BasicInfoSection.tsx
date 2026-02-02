import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { HTTP_METHODS } from './constants'
import type { DataSourceFormData } from './types'

interface BasicInfoSectionProps {
  formData: DataSourceFormData
  isEdit: boolean
  updateField: <K extends keyof DataSourceFormData>(field: K, value: DataSourceFormData[K]) => void
}

export const BasicInfoSection = ({ formData, isEdit, updateField }: BasicInfoSectionProps) => {
  return (
    <>
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
            {HTTP_METHODS.map(method => (
              <SelectItem key={method} value={method}>
                {method}
              </SelectItem>
            ))}
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
    </>
  )
}
