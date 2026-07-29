import type { ApiErrorPayload } from './contracts'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_HEADER_VALUE = '1'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly requestId?: string

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code
    this.details = payload.details
    this.requestId = payload.requestId
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)

  headers.set('Accept', 'application/json')

  if (MUTATION_METHODS.has(method) && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (MUTATION_METHODS.has(method)) {
    headers.set('X-CSRF-Token', CSRF_HEADER_VALUE)
  }

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: init.credentials ?? 'include',
  })

  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    const error = (payload?.error ?? payload) as Partial<ApiErrorPayload> | null
    throw new ApiError(response.status, {
      code: error?.code ?? 'REQUEST_FAILED',
      message: error?.message ?? `请求失败（${response.status}）`,
      details: error?.details,
      requestId: error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
    })
  }

  return payload as T
}

export function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value)
}
