import type { Component, ComponentMetadata } from '@easy-editor/core'

/** 物料连接配置 */
export interface LocalMaterialConfig {
  /** 开发服务器地址 */
  devServerUrl: string
}

/** 物料服务器返回的信息 */
export interface MaterialServerInfo {
  name: string
  title?: string
  version: string
  group?: string
  category?: string
  entry: string
  hasComponent: boolean
  hasMeta: boolean
  hasConfigure: boolean
  hasSnippets: boolean
  hmrPort?: number
  /** WebSocket 路径 */
  wsPath?: string
}

/** 加载的物料模块 */
export interface LoadedMaterialModule {
  /** 默认导出（通常是组件） */
  default?: Component
  /** 组件 */
  component?: Component
  /** 元数据 */
  meta?: ComponentMetadata
}

/** 物料连接信息 */
export interface MaterialConnection {
  url: string
  componentName: string
  module: LoadedMaterialModule
  ws?: WebSocket
  info: MaterialServerInfo
  /** 重连状态 */
  reconnect: {
    retries: number
    timer?: ReturnType<typeof setTimeout>
    isReconnecting: boolean
  }
}
