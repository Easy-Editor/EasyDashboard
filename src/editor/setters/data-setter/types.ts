/**
 * DataSetter 类型定义
 */

import type { SetterProps } from '@easy-editor/core'

/** 数据源类型 */
export type DataSourceType = 'static' | 'datasource' | 'global'

/** 字段映射项 */
export interface FieldMapping {
  /** 组件字段名 */
  componentField: string
  /** 数据源字段名（支持点号路径） */
  sourceField: string
}

/** DataSetter 的值结构 */
export interface DataSetterValue {
  /** 数据源类型 */
  sourceType: DataSourceType

  // ===== 静态数据模式 (static) =====
  /** 静态数据 */
  staticData?: unknown[]

  // ===== 数据源模式 (datasource) / 全局数据源模式 (global) =====
  /** 引用的数据源 ID */
  datasourceId?: string

  // ===== 通用 =====
  /** 字段映射配置 */
  fieldMappings?: FieldMapping[]
}

/** 期望字段定义 */
export interface ExpectedField {
  /** 字段名 */
  name: string
  /** 字段标签 */
  label: string
  /** 字段类型 */
  type?: string
  /** 是否必填 */
  required?: boolean
  /** 字段说明 */
  description?: string
}

/** DataSetter Props */
export interface DataSetterProps extends SetterProps<DataSetterValue> {
  /** 组件期望的字段定义 */
  expectedFields?: ExpectedField[]
  /** 是否显示数据预览 */
  showPreview?: boolean
  /** 预览数据行数限制 */
  previewLimit?: number
}

/** 数据预览视图类型 */
export type PreviewViewType = 'table' | 'code'

/** 数据源选项 */
export interface DataSourceOption {
  id: string
  label: string
}
