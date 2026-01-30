/**
 * DataMappingTable - 字段映射表
 * 用于配置组件字段与数据源字段的映射关系
 * 三列结构：字段 | 映射 | 说明
 */
import { useCallback, useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ExpectedField, FieldMapping } from './types'
import { extractFieldsFromData } from './utils'

interface DataMappingTableProps {
  expectedFields: ExpectedField[]
  fieldMappings: FieldMapping[]
  previewData: unknown[]
  onChange: (mappings: FieldMapping[]) => void
}

export const DataMappingTable = (props: DataMappingTableProps) => {
  const { expectedFields, fieldMappings, previewData, onChange } = props

  // 从预览数据中提取可用字段
  const availableFields = useMemo(() => {
    return extractFieldsFromData(previewData)
  }, [previewData])

  // 更新映射
  const updateMapping = useCallback(
    (componentField: string, sourceField: string) => {
      const existing = fieldMappings.find(m => m.componentField === componentField)
      if (existing) {
        onChange(fieldMappings.map(m => (m.componentField === componentField ? { ...m, sourceField } : m)))
      } else {
        onChange([
          ...fieldMappings,
          {
            componentField,
            sourceField,
          },
        ])
      }
    },
    [fieldMappings, onChange],
  )

  // 获取字段的当前映射值
  const getMappingValue = (componentField: string) => {
    return fieldMappings.find(m => m.componentField === componentField)?.sourceField || ''
  }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <span className='text-xs font-medium text-foreground min-w-[70px] shrink-0'>字段映射</span>
      </div>
      <div className='border border-border rounded-md overflow-hidden'>
        <div className='flex items-center px-3 py-2 bg-muted text-[11px] font-medium text-muted-foreground'>
          <span className='w-[70px] shrink-0 text-xs'>字段</span>
          <span className='flex-1 min-w-0 px-2'>映射</span>
          <span className='w-[100px] shrink-0 text-[11px] text-muted-foreground text-right overflow-hidden text-ellipsis whitespace-nowrap'>
            说明
          </span>
        </div>
        {expectedFields.map(field => (
          <div key={field.name} className='flex items-center px-3 py-1.5 border-t border-border'>
            <span className='w-[70px] shrink-0 text-xs'>
              {field.label || field.name}
              {field.required && <span className='text-destructive ml-0.5'>*</span>}
            </span>
            <div className='flex-1 min-w-0 px-2'>
              <Select value={getMappingValue(field.name)} onValueChange={v => updateMapping(field.name, v)}>
                <SelectTrigger className='h-[26px] text-xs'>
                  <SelectValue placeholder='选择字段' />
                </SelectTrigger>
                <SelectContent>
                  {availableFields.map(f => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className='w-[100px] shrink-0 text-[11px] text-muted-foreground text-right overflow-hidden text-ellipsis whitespace-nowrap'>
              {field.description || '-'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
