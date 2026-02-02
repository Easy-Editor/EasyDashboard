import type { JSFunction, JSONObject } from '@easy-editor/core'
import type { InterpretDataSourceConfig } from '@easy-editor/plugin-datasource'
import { defaultDataHandler, defaultErrorHandler, defaultShouldFetch, defaultWillFetch } from './constants'
import type { DataSourceFormData, KeyValuePair } from './types'

/**
 * 解析数据源配置为表单数据
 */
export const parseDataSourceToFormData = (dataSource: InterpretDataSourceConfig): DataSourceFormData => {
  const paramsObj = dataSource.options?.params as JSONObject
  const params: KeyValuePair[] =
    paramsObj && typeof paramsObj === 'object'
      ? Object.entries(paramsObj).map(([key, value]) => ({ key, value: String(value) }))
      : []

  const headersObj = dataSource.options?.headers as JSONObject
  const headers: KeyValuePair[] =
    headersObj && typeof headersObj === 'object'
      ? Object.entries(headersObj).map(([key, value]) => ({ key, value: String(value) }))
      : []

  const body = (dataSource.options as any)?.body
  let requestBody = ''
  let requestBodyType: 'json' | 'form' | 'text' = 'json'

  if (body) {
    if (typeof body === 'string') {
      requestBody = body
      requestBodyType = 'text'
    } else {
      requestBody = JSON.stringify(body, null, 2)
      requestBodyType = 'json'
    }
  }

  return {
    id: dataSource.id,
    type: dataSource.type || 'fetch',
    method: (dataSource.options?.method as string) || 'GET',
    uri: (dataSource.options?.uri as string) || '',
    isSync: (dataSource.options?.isSync as boolean) ?? true,
    timeout: (dataSource.options?.timeout as number) || 5000,
    isCors: (dataSource.options?.isCors as boolean) ?? true,
    params,
    headers,
    requestBody,
    requestBodyType,
    shouldFetch: (dataSource.shouldFetch as JSFunction)?.value || defaultShouldFetch,
    willFetch: (dataSource.willFetch as JSFunction)?.value || defaultWillFetch,
    dataHandler: (dataSource.dataHandler as JSFunction)?.value || defaultDataHandler,
    errorHandler: (dataSource.errorHandler as JSFunction)?.value || defaultErrorHandler,
    enableShouldFetch: !!(dataSource.shouldFetch as JSFunction)?.value,
    enableWillFetch: !!(dataSource.willFetch as JSFunction)?.value,
    enableDataHandler: !!(dataSource.dataHandler as JSFunction)?.value,
    enableErrorHandler: !!(dataSource.errorHandler as JSFunction)?.value,
  }
}

/**
 * 将表单数据转换为数据源配置
 */
export const formDataToDataSourceConfig = (
  formData: DataSourceFormData,
): { config: InterpretDataSourceConfig | null; error: string | null } => {
  if (!formData.id) {
    return { config: null, error: '请输入数据源ID' }
  }

  if (!formData.uri && formData.type === 'fetch') {
    return { config: null, error: '请输入请求地址' }
  }

  const paramsObj: JSONObject = {}
  formData.params.forEach(param => {
    if (param.key.trim()) {
      paramsObj[param.key] = param.value
    }
  })

  const headersObj: JSONObject = {}
  formData.headers.forEach(header => {
    if (header.key.trim()) {
      headersObj[header.key] = header.value
    }
  })

  let bodyData: any = undefined
  if (formData.requestBody.trim() && ['POST', 'PUT', 'PATCH'].includes(formData.method)) {
    if (formData.requestBodyType === 'json') {
      try {
        bodyData = JSON.parse(formData.requestBody)
      } catch (e) {
        return { config: null, error: '请求体JSON格式错误' }
      }
    } else {
      bodyData = formData.requestBody
    }
  }

  const options: any = {
    method: formData.method,
    uri: formData.uri,
    isSync: formData.isSync,
    timeout: formData.timeout,
    isCors: formData.isCors,
    params: paramsObj,
    headers: headersObj,
  }

  if (bodyData !== undefined) {
    options.body = bodyData
  }

  const config: InterpretDataSourceConfig = {
    id: formData.id,
    type: formData.type,
    options,
    shouldFetch:
      formData.enableShouldFetch && formData.shouldFetch
        ? { type: 'JSFunction', value: formData.shouldFetch }
        : undefined,
    willFetch:
      formData.enableWillFetch && formData.willFetch ? { type: 'JSFunction', value: formData.willFetch } : undefined,
    dataHandler:
      formData.enableDataHandler && formData.dataHandler
        ? { type: 'JSFunction', value: formData.dataHandler }
        : undefined,
    errorHandler:
      formData.enableErrorHandler && formData.errorHandler
        ? { type: 'JSFunction', value: formData.errorHandler }
        : undefined,
  }

  return { config, error: null }
}
