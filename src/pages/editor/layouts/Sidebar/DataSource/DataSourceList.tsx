import { DataSourceEditorModal, type DataSourceEditorModalProps } from '@/components/common/DataSourceEditorModal'
import { type DataSource, type DataSourceItem, type Node, project } from '@easy-editor/core'
import type { InterpretDataSourceConfig } from '@easy-editor/plugin-datasource'
import { Plus } from 'lucide-react'
import { observer } from 'mobx-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { genId } from '.'
import { CardItem } from './CardItem'

export const DataSourceList: React.FC<{ rootNode: Node }> = observer(({ rootNode }) => {
  const dataSource = rootNode.getExtraPropValue('dataSource') as DataSource
  const dataSourceList = dataSource?.list || []
  const [open, setOpen] = useState(false)
  const [currentDataSource, setCurrentDataSource] = useState<DataSourceItem | InterpretDataSourceConfig>()

  const updateDataSourceList = (list: (DataSourceItem | InterpretDataSourceConfig)[]) => {
    project.set('dataSource', {
      ...dataSourceList,
      list,
    })
  }

  const handleAdd = () => {
    setCurrentDataSource(undefined)
    setOpen(true)
  }

  const handleEdit = (dataSourceConfig: InterpretDataSourceConfig) => () => {
    setCurrentDataSource(dataSourceConfig)
    setOpen(true)
  }

  const handleEditConfirm: DataSourceEditorModalProps['onConfirm'] = newDataSource => {
    const isEdit = !!currentDataSource

    if (isEdit) {
      // Update existing data source
      const updatedList = dataSourceList.map(item => (item.id === currentDataSource.id ? newDataSource : item))
      updateDataSourceList(updatedList)
    } else {
      // Check if ID already exists
      const existingDataSource = dataSourceList.find(item => item.id === newDataSource.id)
      if (existingDataSource) {
        toast.warning('数据源ID已存在')
        return
      }

      // Add new data source
      const updatedList = [...dataSourceList, newDataSource]
      updateDataSourceList(updatedList)
    }

    setCurrentDataSource(undefined)
    setOpen(false)
  }

  const handleDelete = (id: string) => {
    const updatedList = dataSourceList.filter(item => item.id !== id)
    updateDataSourceList(updatedList)
  }

  const handleCopy = (id: string) => {
    const sourceDataSource = dataSourceList.find(item => item.id === id)
    if (!sourceDataSource) return

    const newId = `${id}-${genId()}`
    const copiedDataSource = {
      ...sourceDataSource,
      id: newId,
    }

    // Insert after the original
    const index = dataSourceList.findIndex(item => item.id === id)
    const updatedList = [...dataSourceList.slice(0, index + 1), copiedDataSource, ...dataSourceList.slice(index + 1)]
    updateDataSourceList(updatedList)
  }

  return (
    <DataSourceEditorModal
      open={open}
      dataSource={currentDataSource}
      onClose={() => setOpen(false)}
      onConfirm={handleEditConfirm}
    >
      <div className='space-y-4'>
        <h3 className='text-xs font-medium text-muted-foreground tracking-wide uppercase flex justify-end items-center m-0'>
          <Plus className='w-4 h-4 cursor-pointer' onClick={handleAdd} />
        </h3>
        {dataSourceList.length > 0 ? (
          dataSourceList.map(dataSourceConfig => (
            <CardItem
              key={dataSourceConfig.id}
              name={dataSourceConfig.id}
              description={dataSourceConfig.type || ''}
              onEdit={handleEdit(dataSourceConfig)}
              onDelete={() => handleDelete(dataSourceConfig.id)}
              onCopy={() => handleCopy(dataSourceConfig.id)}
            />
          ))
        ) : (
          <div className='text-xs text-muted-foreground text-center py-4'>暂无数据源</div>
        )}
      </div>
    </DataSourceEditorModal>
  )
})
