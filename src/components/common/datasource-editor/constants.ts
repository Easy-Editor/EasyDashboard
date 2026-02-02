import type { DataSourceFormData } from './types'

export const defaultShouldFetch = `function shouldFetch(options) {
  return true
}`

export const defaultWillFetch = `function willFetch(options) {
  return options
}`

export const defaultDataHandler = `function dataHandler(response) {
  return response.data
}`

export const defaultErrorHandler = `function errorHandler(error) {
  console.error('Data source error:', error)
  throw error
}`

export const createDefaultFormData = (): DataSourceFormData => ({
  id: '',
  type: 'fetch',
  method: 'GET',
  uri: '',
  isSync: false,
  timeout: 5000,
  isCors: true,
  params: [],
  headers: [],
  requestBody: '',
  requestBodyType: 'json',
  shouldFetch: defaultShouldFetch,
  willFetch: defaultWillFetch,
  dataHandler: defaultDataHandler,
  errorHandler: defaultErrorHandler,
  enableShouldFetch: false,
  enableWillFetch: false,
  enableDataHandler: true,
  enableErrorHandler: false,
})

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const

export const REQUEST_BODY_TYPES = [
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form Data' },
  { value: 'text', label: 'Text' },
] as const
