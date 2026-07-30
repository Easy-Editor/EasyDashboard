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
import { type InterpretDataSource, createDataSourceEngine } from '@easy-editor/plugin-datasource'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { DataCodeView } from './DataCodeView'
import { DataMappingTable } from './DataMappingTable'
import { DataTableView } from './DataTableView'
import { DatasourceSelector } from './DatasourceSelector'
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

const PREVIEW_VIEW_ORDER: PreviewViewType[] = ['table', 'code']

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
    void refreshKey
    if (!selected || !currentValue.datasourceId) return null

    let dataSourceList: InterpretDataSource['list'] = []

    if (currentValue.sourceType === 'datasource') {
      // 组件级数据源
      const dataSource = selected.getExtraPropValue('dataSource') as InterpretDataSource | undefined
      dataSourceList = dataSource?.list ?? []
    } else if (currentValue.sourceType === 'global') {
      // 全局数据源
      const rootNode = selected.document?.rootNode
      const dataSource = rootNode?.getExtraPropValue('dataSource') as InterpretDataSource | undefined
      dataSourceList = dataSource?.list ?? []
    }

    return dataSourceList.find(dataSource => dataSource.id === currentValue.datasourceId) ?? null
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

  const handlePreviewViewKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentView: PreviewViewType) => {
      const currentIndex = PREVIEW_VIEW_ORDER.indexOf(currentView)
      let nextView: PreviewViewType | null = null

      if (event.key === 'ArrowRight') {
        nextView = PREVIEW_VIEW_ORDER[(currentIndex + 1) % PREVIEW_VIEW_ORDER.length]
      } else if (event.key === 'ArrowLeft') {
        nextView = PREVIEW_VIEW_ORDER[(currentIndex - 1 + PREVIEW_VIEW_ORDER.length) % PREVIEW_VIEW_ORDER.length]
      } else if (event.key === 'Home') {
        nextView = PREVIEW_VIEW_ORDER[0]
      } else if (event.key === 'End') {
        nextView = PREVIEW_VIEW_ORDER[PREVIEW_VIEW_ORDER.length - 1]
      }

      if (!nextView) return

      event.preventDefault()
      setPreviewView(nextView)
      document.getElementById(`data-view-tab-${nextView}`)?.focus()
    },
    [],
  )

  return (
    <div className='flex flex-col gap-4 w-full'>
      {/* 1. 数据源类型选择 */}
      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-2'>
          <span className='text-xs font-medium text-foreground min-w-[70px] shrink-0'>数据源类型</span>
          <Select value={currentValue.sourceType} onValueChange={handleSourceTypeChange}>
            <SelectTrigger className='flex-1 h-7 text-xs'>
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
      <div className='flex flex-col gap-2'>
        <div className='flex items-center justify-between'>
          <span className='text-xs font-medium text-foreground min-w-[70px] shrink-0'>
            {isStaticMode ? '数据编辑' : '数据预览'}
            {isLoading && (
              <span className='text-[11px] font-normal text-muted-foreground animate-pulse'> 加载中...</span>
            )}
          </span>
          <div
            role='tablist'
            aria-label='数据视图'
            className='flex h-7 items-center rounded-md border border-[var(--ed-line)] bg-[var(--ed-panel-raised)] p-0.5'
          >
            <button
              id='data-view-tab-table'
              type='button'
              role='tab'
              aria-selected={previewView === 'table'}
              aria-controls='data-view-panel-table'
              tabIndex={previewView === 'table' ? 0 : -1}
              className={`h-[22px] cursor-pointer rounded border-none bg-transparent px-2.5 text-[11px] font-medium text-[var(--ed-ink-muted)] outline-none transition-colors hover:text-[var(--ed-ink)] focus-visible:ring-1 focus-visible:ring-[var(--ed-cyan)] ${previewView === 'table' ? 'bg-[var(--ed-canvas)] text-[var(--ed-ink)]' : ''}`}
              onClick={() => setPreviewView('table')}
              onKeyDown={event => handlePreviewViewKeyDown(event, 'table')}
            >
              表格
            </button>
            <button
              id='data-view-tab-code'
              type='button'
              role='tab'
              aria-selected={previewView === 'code'}
              aria-controls='data-view-panel-code'
              tabIndex={previewView === 'code' ? 0 : -1}
              className={`h-[22px] cursor-pointer rounded border-none bg-transparent px-2.5 text-[11px] font-medium text-[var(--ed-ink-muted)] outline-none transition-colors hover:text-[var(--ed-ink)] focus-visible:ring-1 focus-visible:ring-[var(--ed-cyan)] ${previewView === 'code' ? 'bg-[var(--ed-canvas)] text-[var(--ed-ink)]' : ''}`}
              onClick={() => setPreviewView('code')}
              onKeyDown={event => handlePreviewViewKeyDown(event, 'code')}
            >
              代码
            </button>
          </div>
        </div>
        <div
          id='data-view-panel-table'
          role='tabpanel'
          aria-labelledby='data-view-tab-table'
          hidden={previewView !== 'table'}
          className='overflow-hidden rounded-md border border-[var(--ed-line)] bg-[var(--ed-panel)]'
        >
          {previewView === 'table' && (
            <DataTableView
              data={previewData}
              editable={isStaticMode}
              limit={previewLimit}
              expectedFields={expectedFields}
              onChange={isStaticMode ? handleStaticDataChange : undefined}
            />
          )}
        </div>
        <div
          id='data-view-panel-code'
          role='tabpanel'
          aria-labelledby='data-view-tab-code'
          hidden={previewView !== 'code'}
          className='overflow-hidden rounded-md border border-[var(--ed-line)] bg-[var(--ed-panel)]'
        >
          {previewView === 'code' && (
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
