/**
 * DataMappingTable - 字段映射表
 * 用于配置组件字段与数据源字段的映射关系
 * 三列结构：字段 | 映射 | 说明
 */
import { useCallback, useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ExpectedField, FieldMapping } from './types'
import { extractFieldsFromData } from './utils'
import styles from './styles.module.css'

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
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.label}>字段映射</span>
      </div>
      <div className={styles.mappingTable}>
        <div className={styles.mappingHeader}>
          <span className={styles.mappingColField}>字段</span>
          <span className={styles.mappingColMapping}>映射</span>
          <span className={styles.mappingColDesc}>说明</span>
        </div>
        {expectedFields.map(field => (
          <div key={field.name} className={styles.mappingRow}>
            <span className={styles.mappingColField}>
              {field.label || field.name}
              {field.required && <span className={styles.required}>*</span>}
            </span>
            <div className={styles.mappingColMapping}>
              <Select value={getMappingValue(field.name)} onValueChange={v => updateMapping(field.name, v)}>
                <SelectTrigger className={styles.mappingSelect}>
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
            <span className={styles.mappingColDesc}>{field.description || '-'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
