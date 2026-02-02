import type { PropsWithChildren } from 'react'
import type { InterpretDataSourceConfig } from '@easy-editor/plugin-datasource'

export interface DataSourceEditorModalProps extends PropsWithChildren {
  open: boolean
  onConfirm?: (dataSource: InterpretDataSourceConfig) => void
  onClose?: () => void
  dataSource?: InterpretDataSourceConfig
}

export interface KeyValuePair {
  key: string
  value: string
}

export interface DataSourceFormData {
  id: string
  type: string
  method: string
  uri: string
  isSync: boolean
  timeout: number
  isCors: boolean
  params: KeyValuePair[]
  headers: KeyValuePair[]
  requestBody: string
  requestBodyType: 'json' | 'form' | 'text'
  dataHandler: string
  shouldFetch: string
  willFetch: string
  errorHandler: string
  enableShouldFetch: boolean
  enableWillFetch: boolean
  enableDataHandler: boolean
  enableErrorHandler: boolean
}
