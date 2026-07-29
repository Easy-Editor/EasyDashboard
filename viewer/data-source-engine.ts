import type { DataSourceEngine } from '@easy-editor/core'
import {
  type IDataSourceRuntimeContext,
  type InterpretDataSource,
  type RuntimeOptionsConfig,
  createInterpret,
} from '@easy-editor/plugin-datasource'

function appendSearchParams(searchParams: URLSearchParams, params: Record<string, unknown>) {
  for (const [key, rawValue] of Object.entries(params)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue]
    for (const value of values) {
      if (value === null || value === undefined) continue
      searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
  }
}

function requestHeaders(input: Record<string, unknown> | undefined): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value !== null && value !== undefined) headers.set(key, String(value))
  }
  return headers
}

function requestBody(params: Record<string, unknown>, headers: Headers): BodyInit {
  const contentType = headers.get('Content-Type')?.toLowerCase() ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = new URLSearchParams()
    appendSearchParams(body, params)
    return body
  }

  if (!contentType) headers.set('Content-Type', 'application/json')
  return JSON.stringify(params)
}

async function cookieLessFetch(options: RuntimeOptionsConfig): Promise<{ data: unknown }> {
  const method = (options.method ?? 'GET').toUpperCase()
  const params = options.params ?? {}
  const url = new URL(options.uri, window.location.href)
  const headers = requestHeaders(options.headers)
  const controller = new AbortController()
  const timeout = Number(options.timeout)
  const timeoutId =
    Number.isFinite(timeout) && timeout > 0
      ? window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout)
      : null

  if (method === 'GET' || method === 'HEAD') appendSearchParams(url.searchParams, params)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : requestBody(params, headers),
      credentials: 'omit',
      signal: controller.signal,
    })
    const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? ''
    const data =
      response.status === 204
        ? undefined
        : contentType.includes('application/json')
          ? await response.json()
          : await response.text()

    if (!response.ok) {
      throw new Error(`Datasource request failed with status ${response.status}`)
    }

    return { data }
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
}

export const createCookieLessDataSourceEngine: DataSourceEngine['createDataSourceEngine'] = (dataSource, context) => {
  const normalizedDataSource = {
    ...dataSource,
    list: dataSource.list ?? [],
  } as unknown as InterpretDataSource

  return createInterpret(normalizedDataSource, context as IDataSourceRuntimeContext, {
    requestHandlersMap: {
      fetch: cookieLessFetch,
    },
  })
}
