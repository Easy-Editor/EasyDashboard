/**
 * DataSetter 工具函数
 */

/**
 * 从数据中提取字段名列表
 * 支持嵌套对象，使用点号分隔路径
 */
export function extractFieldsFromData(data: unknown[], maxDepth = 2): string[] {
  if (!Array.isArray(data) || data.length === 0) return []

  const fields = new Set<string>()
  const firstItem = data[0]

  if (typeof firstItem !== 'object' || firstItem === null) {
    return ['value']
  }

  const extractKeys = (obj: Record<string, unknown>, prefix = '', depth = 0) => {
    if (depth >= maxDepth) return

    for (const key of Object.keys(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      fields.add(fullKey)

      const value = obj[key]
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        extractKeys(value as Record<string, unknown>, fullKey, depth + 1)
      }
    }
  }

  extractKeys(firstItem as Record<string, unknown>)
  return Array.from(fields)
}

/**
 * 根据路径从对象中获取值
 */
export function getValueByPath(obj: unknown, path: string): unknown {
  if (!path) return obj

  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

/**
 * 根据路径设置对象的值
 */
export function setValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let current = obj

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }

  current[keys[keys.length - 1]] = value
}

// ============ 数据解析函数 ============

import type { DataSetterValue, FieldMapping } from './types'

/**
 * 应用字段映射，将源数据转换为组件期望的数据格式
 * @param sourceData - 原始数据数组
 * @param mappings - 字段映射配置
 * @returns 映射后的数据数组
 */
export function applyFieldMappings(sourceData: unknown[], mappings: FieldMapping[]): Record<string, unknown>[] {
  if (!Array.isArray(sourceData) || sourceData.length === 0) {
    return []
  }

  // 如果没有映射配置，直接返回原始数据
  if (!mappings || mappings.length === 0) {
    return sourceData as Record<string, unknown>[]
  }

  return sourceData.map(item => {
    const result: Record<string, unknown> = {}

    for (const mapping of mappings) {
      const { componentField, sourceField } = mapping
      if (componentField && sourceField) {
        result[componentField] = getValueByPath(item, sourceField)
      }
    }

    return result
  })
}

/**
 * 从 DataSetter 配置解析数据
 * 支持三种数据源类型：static（具体数据）、datasource（数据源）、global（全局数据源）
 * @param config - $data 配置（DataSetterValue）
 * @param dataSourceMap - 全局数据源映射（从渲染器上下文获取）
 * @returns 解析后的数据数组
 */
export function resolveDataFromConfig(
  config: DataSetterValue | undefined,
  dataSourceMap?: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!config) return []

  let rawData: unknown[] = []

  // 具体数据模式 (static)
  if (config.sourceType === 'static') {
    rawData = Array.isArray(config.staticData) ? config.staticData : []
  }
  // 数据源模式 (datasource) - 组件内部 API 配置
  else if (config.sourceType === 'datasource') {
    // 组件内部数据源配置 - 需要在运行时执行请求
    // 这里返回空数组，实际数据需要在组件中异步获取
    rawData = []
  }
  // 全局数据源模式 (global)
  else if (config.sourceType === 'global' && config.datasourceId) {
    if (dataSourceMap) {
      const dsData = dataSourceMap[config.datasourceId]
      rawData = extractDataFromSource(dsData, config.dataPath)
    }
  }

  // 应用字段映射
  return applyFieldMappings(rawData, config.fieldMappings || [])
}

/**
 * 从数据源数据中提取数组
 */
function extractDataFromSource(dsData: unknown, dataPath?: string): unknown[] {
  if (dsData === undefined) return []

  if (dataPath) {
    const extracted = getValueByPath(dsData, dataPath)
    return Array.isArray(extracted) ? extracted : extracted ? [extracted] : []
  }

  if (Array.isArray(dsData)) {
    return dsData
  }

  if (dsData && typeof dsData === 'object') {
    return [dsData]
  }

  return []
}
