import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
/**
 * DataSetter - 数据配置设置器
 * 支持静态数据、数据源、全局数据源三种模式
 *
 * 层级结构：
 * 1. 数据源类型
 * 2. 数据源选择（仅数据源/全局数据源模式）
 * 3. 字段映射
 * 4. 数据预览
 */
import { createDataSourceEngine } from '@easy-editor/plugin-datasource'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DataCodeView } from './DataCodeView'
import { DataMappingTable } from './DataMappingTable'
import { DataTableView } from './DataTableView'
import { DatasourceSelector } from './DatasourceSelector'
import styles from './styles.module.css'
import type { DataSetterProps, DataSetterValue, DataSourceType, PreviewViewType } from './types'

const SOURCE_TYPE_OPTIONS = [
  { value: 'static', label: '静态数据' },
  { value: 'datasource', label: '数据源' },
  { value: 'global', label: '全局数据源' },
]

const DEFAULT_VALUE: DataSetterValue = {
  sourceType: 'static',
  staticData: [],
  fieldMappings: [],
}

const DataSetter = (props: DataSetterProps) => {
  const { value, onChange, selected, expectedFields = [], previewLimit = 10 } = props

  const currentValue = useMemo(() => ({ ...DEFAULT_VALUE, ...value }), [value])
  const [previewView, setPreviewView] = useState<PreviewViewType>('table')
  const [refreshKey, setRefreshKey] = useState(0)

  // 判断是否为静态数据模式
  const isStaticMode = currentValue.sourceType === 'static'

  // 数据源请求数据状态
  const [fetchedData, setFetchedData] = useState<unknown[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // 创建简单的 runtime context
  const runtimeContext = useMemo(
    () => ({
      state: {},
      setState: () => {},
    }),
    [],
  )

  // 获取数据源配置
  const dataSourceConfig = useMemo(() => {
    if (!selected || !currentValue.datasourceId) return null

    let dataSourceList: any[] = []

    if (currentValue.sourceType === 'datasource') {
      // 组件级数据源
      const dataSource = selected.getExtraPropValue('dataSource')
      dataSourceList = dataSource?.list || []
    } else if (currentValue.sourceType === 'global') {
      // 全局数据源
      const rootNode = selected.document?.rootNode
      const dataSource = rootNode?.getExtraPropValue('dataSource')
      dataSourceList = dataSource?.list || []
    }

    return dataSourceList.find((d: any) => d.id === currentValue.datasourceId) || null
  }, [selected, currentValue.sourceType, currentValue.datasourceId, refreshKey])

  // 执行数据源请求
  useEffect(() => {
    if (isStaticMode || !dataSourceConfig) {
      setFetchedData([])
      return
    }

    const fetchData = async () => {
      setIsLoading(true)
      try {
        // 使用 createDataSourceEngine 执行数据源请求
        const { dataSourceMap } = createDataSourceEngine({ list: [dataSourceConfig] }, runtimeContext)

        const ds = dataSourceMap[dataSourceConfig.id]
        if (!ds) {
          setFetchedData([])
          return
        }

        // load() 返回请求结果数据
        const result = await ds.load()

        // 获取数据
        const data: unknown = result ?? ds.data

        setFetchedData(Array.isArray(data) ? data : data ? [data] : [])
      } catch (error) {
        console.error('数据源请求失败:', error)
        setFetchedData([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [isStaticMode, dataSourceConfig, runtimeContext])

  // 获取预览数据
  const previewData = useMemo(() => {
    if (isStaticMode) {
      return currentValue.staticData || []
    }
    return fetchedData
  }, [isStaticMode, currentValue.staticData, fetchedData])

  // 更新值
  const updateValue = useCallback(
    (partial: Partial<DataSetterValue>) => {
      onChange?.({ ...currentValue, ...partial })
    },
    [currentValue, onChange],
  )

  // 处理数据源类型变更
  const handleSourceTypeChange = useCallback(
    (type: string) => {
      updateValue({ sourceType: type as DataSourceType })
    },
    [updateValue],
  )

  // 处理静态数据变更
  const handleStaticDataChange = useCallback(
    (data: unknown[]) => {
      updateValue({ staticData: data })
    },
    [updateValue],
  )

  // 处理数据源选择变更
  const handleDatasourceChange = useCallback(
    (datasourceId: string) => {
      updateValue({ datasourceId })
    },
    [updateValue],
  )

  // 刷新数据源数据
  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  // 处理字段映射变更
  const handleMappingsChange = useCallback(
    (fieldMappings: DataSetterValue['fieldMappings']) => {
      updateValue({ fieldMappings })
    },
    [updateValue],
  )

  return (
    <div className={styles.container}>
      {/* 1. 数据源类型选择 */}
      <div className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>数据源类型</span>
          <Select value={currentValue.sourceType} onValueChange={handleSourceTypeChange}>
            <SelectTrigger className={styles.select}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_TYPE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 2. 数据源选择（仅数据源/全局数据源模式） */}
      {!isStaticMode && (
        <DatasourceSelector
          node={selected}
          sourceType={currentValue.sourceType}
          datasourceId={currentValue.datasourceId}
          onChange={handleDatasourceChange}
          onRefresh={handleRefresh}
        />
      )}

      {/* 3. 字段映射 */}
      {expectedFields.length > 0 && (
        <DataMappingTable
          expectedFields={expectedFields}
          fieldMappings={currentValue.fieldMappings || []}
          previewData={previewData}
          onChange={handleMappingsChange}
        />
      )}

      {/* 4. 数据预览 */}
      <div className={styles.section}>
        <div className={styles.previewHeader}>
          <span className={styles.label}>
            {isStaticMode ? '数据编辑' : '数据预览'}
            {isLoading && <span className={styles.loadingText}> 加载中...</span>}
          </span>
          <div className={styles.viewToggle}>
            <button
              type='button'
              className={`${styles.viewBtn} ${previewView === 'table' ? styles.viewBtnActive : ''}`}
              onClick={() => setPreviewView('table')}
            >
              表格
            </button>
            <button
              type='button'
              className={`${styles.viewBtn} ${previewView === 'code' ? styles.viewBtnActive : ''}`}
              onClick={() => setPreviewView('code')}
            >
              代码
            </button>
          </div>
        </div>
        <div className={styles.previewContent}>
          {previewView === 'table' ? (
            <DataTableView
              data={previewData}
              editable={isStaticMode}
              limit={previewLimit}
              expectedFields={expectedFields}
              onChange={isStaticMode ? handleStaticDataChange : undefined}
            />
          ) : (
            <DataCodeView
              data={previewData}
              editable={isStaticMode}
              onChange={isStaticMode ? handleStaticDataChange : undefined}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default DataSetter
