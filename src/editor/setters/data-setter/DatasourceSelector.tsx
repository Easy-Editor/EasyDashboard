/**
 * DatasourceSelector - 数据源选择器
 * 统一处理数据源模式和全局数据源模式的选择
 */

import { DataSourceEditorModal } from '@/components/common/DataSourceEditorModal'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DataSource, Node } from '@easy-editor/core'
import type { InterpretDataSourceConfig } from '@easy-editor/plugin-datasource'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import styles from './styles.module.css'
import type { DataSourceType } from './types'

interface DatasourceSelectorProps {
  node?: Node
  sourceType: DataSourceType
  datasourceId?: string
  onChange: (datasourceId: string) => void
  onRefresh?: () => void
}

export const DatasourceSelector = (props: DatasourceSelectorProps) => {
  const { node, sourceType, datasourceId, onChange, onRefresh } = props
  // 获取全局数据源列表
  const globalDataSourceList = (node?.document?.rootNode?.getExtraPropValue('dataSource') as DataSource)?.list || []
  // 获取组件数据源列表
  const componentDataSourceList = (node?.getExtraPropValue('dataSource') as DataSource)?.list || []
  // 根据模式选择数据源列表
  const dataSourceList = sourceType === 'global' ? globalDataSourceList : componentDataSourceList

  const [modalOpen, setModalOpen] = useState(false)
  const [editingDataSource, setEditingDataSource] = useState<InterpretDataSourceConfig | undefined>()

  // 处理数据源选择变更
  const handleDatasourceChange = useCallback(
    (id: string) => {
      onChange(id)
    },
    [onChange],
  )

  // 删除数据源
  const handleDelete = useCallback(() => {
    if (!datasourceId || !node) return
    const dataSource = node.getExtraPropValue('dataSource') || { list: [] }
    const newList = dataSource.list.filter((d: any) => d.id !== datasourceId)
    node.setExtraPropValue('dataSource', { ...dataSource, list: newList })
    onChange('')
  }, [datasourceId, node, onChange])

  // 确认创建/编辑数据源
  const handleConfirm = useCallback(
    (ds: InterpretDataSourceConfig) => {
      if (!node) return

      const dataSource = node.getExtraPropValue('dataSource') || { list: [] }
      const existingIndex = dataSource.list.findIndex((d: any) => d.id === ds.id)

      let newList: InterpretDataSourceConfig[]
      if (existingIndex >= 0) {
        // 编辑现有数据源
        newList = [...dataSource.list]
        newList[existingIndex] = ds
      } else {
        // 新建数据源
        newList = [...dataSource.list, ds]
      }

      node.setExtraPropValue('dataSource', { ...dataSource, list: newList })

      if (existingIndex >= 0) {
        // 编辑现有数据源 - 触发刷新
        onRefresh?.()
      } else {
        // 新建数据源 - 选中新数据源
        onChange(ds.id)
      }
      setModalOpen(false)
    },
    [node, onChange, onRefresh],
  )

  // 打开新建弹窗
  const handleOpenCreate = useCallback(() => {
    setEditingDataSource(undefined)
    setModalOpen(true)
  }, [])

  // 打开编辑弹窗
  const handleOpenEdit = useCallback(() => {
    if (!datasourceId) return
    const ds = componentDataSourceList.find((d: any) => d.id === datasourceId)
    if (ds) {
      setEditingDataSource(ds)
      setModalOpen(true)
    }
  }, [datasourceId, componentDataSourceList])

  const isComponentMode = sourceType === 'datasource'

  return (
    <div className={styles.section}>
      {/* 数据源选择 */}
      <div className={styles.row}>
        <span className={styles.label}>数据源</span>
        <div className={styles.dsSelectRow}>
          {isComponentMode && (
            <Button variant='outline' size='sm' className={styles.dsAddBtn} onClick={handleOpenCreate}>
              <Plus className='w-3 h-3' />
            </Button>
          )}
          <Select value={datasourceId || ''} onValueChange={handleDatasourceChange}>
            <SelectTrigger className={styles.select}>
              <SelectValue placeholder='选择数据源' />
            </SelectTrigger>
            <SelectContent>
              {dataSourceList.length === 0 ? (
                <div className={styles.emptyOption}>暂无数据源</div>
              ) : (
                dataSourceList.map((ds: any) => (
                  <SelectItem key={ds.id} value={ds.id}>
                    {ds.id}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {isComponentMode && datasourceId && (
            <>
              <Button variant='ghost' size='sm' className={styles.dsActionBtn} onClick={handleOpenEdit}>
                <Pencil className='w-3 h-3' />
              </Button>
              <Button variant='ghost' size='sm' className={styles.dsActionBtn} onClick={handleDelete}>
                <Trash2 className='w-3 h-3' />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 数据源编辑弹窗 */}
      {isComponentMode && (
        <DataSourceEditorModal
          open={modalOpen}
          dataSource={editingDataSource}
          onConfirm={handleConfirm}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}
