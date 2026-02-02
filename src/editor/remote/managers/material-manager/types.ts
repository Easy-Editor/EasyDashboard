import type { Component, ComponentMetadata } from '@easy-editor/core'

/** 远程物料配置 */
export interface RemoteMaterialConfig {
  /** 包名 */
  package: string
  /** 版本 */
  version?: string
  /** UMD 全局变量名 */
  globalName: string
  /** 是否启用 */
  enabled?: boolean
}

/** 缓存的物料包信息 */
export interface CachedMaterialPackage {
  version: string
  globalName: string
  meta: ComponentMetadata
  component?: Component
  hasComponent: boolean
}

/** 批量加载结果 */
export interface BatchLoadResult {
  total: number
  succeeded: number
  failed: number
}
