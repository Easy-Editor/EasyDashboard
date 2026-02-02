import { CodeEditor } from '@/components/common/code-editor'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { defaultDataHandler, defaultErrorHandler, defaultShouldFetch, defaultWillFetch } from './constants'
import type { DataSourceFormData } from './types'

interface FunctionConfigSectionProps {
  formData: DataSourceFormData
  updateField: <K extends keyof DataSourceFormData>(field: K, value: DataSourceFormData[K]) => void
}

interface FunctionEditorProps {
  enabled: boolean
  enableKey: keyof DataSourceFormData
  valueKey: keyof DataSourceFormData
  label: string
  defaultValue: string
  height?: string
  formData: DataSourceFormData
  updateField: <K extends keyof DataSourceFormData>(field: K, value: DataSourceFormData[K]) => void
}

const FunctionEditor = ({
  enabled,
  enableKey,
  valueKey,
  label,
  defaultValue,
  height = '120px',
  formData,
  updateField,
}: FunctionEditorProps) => (
  <div className='space-y-2'>
    <div className='flex items-center space-x-2'>
      <Switch
        checked={enabled}
        onCheckedChange={checked => updateField(enableKey, checked as DataSourceFormData[typeof enableKey])}
      />
      <Label className='text-xs'>{label}</Label>
    </div>
    {enabled && (
      <div className='ml-6'>
        <CodeEditor
          language='javascript'
          value={formData[valueKey] as string}
          onChange={value => updateField(valueKey, (value || defaultValue) as DataSourceFormData[typeof valueKey])}
          height={height}
        />
      </div>
    )}
  </div>
)

export const FunctionConfigSection = ({ formData, updateField }: FunctionConfigSectionProps) => {
  return (
    <div className='space-y-4'>
      <div className='text-sm font-medium'>数据处理函数配置</div>

      <FunctionEditor
        enabled={formData.enableShouldFetch}
        enableKey='enableShouldFetch'
        valueKey='shouldFetch'
        label='启用 shouldFetch (请求前置条件判断)'
        defaultValue={defaultShouldFetch}
        formData={formData}
        updateField={updateField}
      />

      <FunctionEditor
        enabled={formData.enableWillFetch}
        enableKey='enableWillFetch'
        valueKey='willFetch'
        label='启用 willFetch (请求参数预处理)'
        defaultValue={defaultWillFetch}
        formData={formData}
        updateField={updateField}
      />

      <FunctionEditor
        enabled={formData.enableDataHandler}
        enableKey='enableDataHandler'
        valueKey='dataHandler'
        label='启用 dataHandler (响应数据处理)'
        defaultValue={defaultDataHandler}
        height='160px'
        formData={formData}
        updateField={updateField}
      />

      <FunctionEditor
        enabled={formData.enableErrorHandler}
        enableKey='enableErrorHandler'
        valueKey='errorHandler'
        label='启用 errorHandler (错误处理)'
        defaultValue={defaultErrorHandler}
        formData={formData}
        updateField={updateField}
      />
    </div>
  )
}
