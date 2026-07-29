import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
/**
 * DataTableView - 表格视图
 * 使用 react-data-grid 实现 Excel 风格的数据表格
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { type Column, DataGrid, type RenderEditCellProps } from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import type { ExpectedField } from './types'

interface DataTableViewProps {
  data: unknown[]
  editable?: boolean
  limit?: number
  expectedFields?: ExpectedField[]
  onChange?: (data: unknown[]) => void
}

// 自定义文本编辑器
function TextEditor<TRow, TSummaryRow>({ row, column, onRowChange, onClose }: RenderEditCellProps<TRow, TSummaryRow>) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <input
      ref={inputRef}
      className='w-full h-full px-2 border-none outline-none bg-background text-foreground text-xs'
      value={(row as any)[column.key] ?? ''}
      onChange={e => onRowChange({ ...row, [column.key]: e.target.value })}
      onBlur={() => onClose(true)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          onClose(true)
        } else if (e.key === 'Escape') {
          onClose(false)
        }
      }}
    />
  )
}

export const DataTableView = (props: DataTableViewProps) => {
  const { data, editable = false, limit = 10, expectedFields = [], onChange } = props

  // 从数据中提取字段列表（优先使用实际数据的字段）
  const fieldKeys = useMemo(() => {
    // 优先从数据中提取字段
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      return Object.keys(data[0] as object).map(k => ({ key: k, name: k }))
    }
    // 如果数据为空，使用 expectedFields
    if (expectedFields.length > 0) {
      return expectedFields.map(f => ({ key: f.name, name: f.label || f.name }))
    }
    return [
      { key: 'name', name: '名称' },
      { key: 'value', name: '数值' },
    ]
  }, [expectedFields, data])

  // 将数据转换为数组格式
  const rows = useMemo(() => {
    if (!Array.isArray(data)) return []
    return data.slice(0, limit).map((item, index) => ({
      __index: index,
      ...(typeof item === 'object' && item !== null ? item : { value: item }),
    }))
  }, [data, limit])

  // 从数据中提取列定义
  const columns: Column<any>[] = useMemo(() => {
    // 序号列
    const indexColumn: Column<any> = {
      key: '__rowIndex',
      name: '#',
      width: 40,
      minWidth: 40,
      maxWidth: 40,
      frozen: true,
      resizable: false,
      renderCell: ({ row }: { row: any }) => row.__index + 1,
    }

    // 数据列
    const dataColumns = fieldKeys.map(field => ({
      key: field.key,
      name: field.name,
      resizable: true,
      editable,
      renderEditCell: editable ? TextEditor : undefined,
      // 处理对象类型的单元格值
      renderCell: ({ row }: { row: any }) => {
        const value = row[field.key]
        if (value === null || value === undefined) {
          return ''
        }
        if (typeof value === 'object') {
          return JSON.stringify(value)
        }
        return String(value)
      },
      width: 100,
      minWidth: 80,
    }))

    return [indexColumn, ...dataColumns]
  }, [fieldKeys, editable])

  // 处理行数据变更
  const handleRowsChange = useCallback(
    (newRows: any[]) => {
      if (!onChange) return
      // 移除 __index 字段并更新原数据
      const updatedData = [...(data as any[])]
      newRows.forEach(row => {
        const { __index, ...rest } = row
        if (__index !== undefined && __index < updatedData.length) {
          updatedData[__index] = rest
        }
      })
      onChange(updatedData)
    },
    [data, onChange],
  )

  // 添加新行
  const handleAddRow = useCallback(() => {
    if (!onChange) return
    const newRow: Record<string, unknown> = {}
    fieldKeys.forEach(field => {
      newRow[field.key] = ''
    })
    onChange([...(data as any[]), newRow])
  }, [data, onChange, fieldKeys])

  if (rows.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center py-8 px-4 text-muted-foreground text-xs'>
        <span>暂无数据</span>
        {editable && (
          <Button variant='outline' size='sm' className='mt-3 text-xs' onClick={handleAddRow}>
            <Plus className='h-3 w-3 mr-1' />
            添加数据
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className='w-full overflow-x-auto'>
      <DataGrid
        columns={columns}
        rows={rows}
        onRowsChange={handleRowsChange}
        className='text-xs !border-none w-full !h-[300px]'
        rowKeyGetter={(row: { __index: number }) => row.__index}
        enableVirtualization={rows.length > 50}
      />
      <div className='flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground bg-muted border-t border-border'>
        {data.length > limit ? (
          <span>
            显示前 {limit} 条，共 {data.length} 条数据
          </span>
        ) : (
          <span>共 {data.length} 条数据</span>
        )}
        {editable && (
          <Button variant='ghost' size='sm' className='text-[11px] h-[22px] px-2' onClick={handleAddRow}>
            <Plus className='h-3 w-3 mr-1' />
            添加行
          </Button>
        )}
      </div>
    </div>
  )
}
