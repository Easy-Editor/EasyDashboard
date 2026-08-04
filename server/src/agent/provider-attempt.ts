import { createHash } from 'node:crypto'

export type ProviderIdempotencyMode = 'unsupported' | 'stable'
export type ProviderAttemptFailureOutcome = 'failed_definite' | 'outcome_unknown'

export interface ProviderAttemptMetadata {
  providerRequestKey?: string
  requestBodyDigest: string
  idempotencyMode: ProviderIdempotencyMode
  idempotencyHeaderSent: boolean
  upstreamRequestId?: string
  durationMs?: number
}

export interface ProviderAttemptFailureMetadata extends ProviderAttemptMetadata {
  outcome: ProviderAttemptFailureOutcome
  reason:
    | 'invalid_request_metadata'
    | 'request_digest_mismatch'
    | 'name_resolution_failed'
    | 'connection_failed'
    | 'request_aborted'
    | 'request_timed_out'
    | 'network_error'
}

export class ProviderAttemptError extends Error {
  override readonly name = 'ProviderAttemptError'

  constructor(public readonly metadata: ProviderAttemptFailureMetadata) {
    super('Provider request could not be completed safely')
  }
}

const PROVIDER_REQUEST_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u
const SHA256_DIGEST = /^[a-f0-9]{64}$/u
const SAFE_UPSTREAM_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u
const SENSITIVE_IDENTIFIER =
  /(?:authorization|bearer|cookie|credential|password|secret|token|api[-_]?key)|(?:^sk-(?:proj-)?)|(?:^[\w-]+\.[\w-]+\.[\w-]+$)/iu
const UPSTREAM_REQUEST_ID_HEADERS = ['x-request-id', 'request-id', 'openai-request-id', 'x-amzn-requestid'] as const

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Provider request body must contain finite JSON numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  throw new TypeError('Provider request body must be JSON-compatible')
}

export function providerRequestBodyDigest(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')
}

export function assertProviderRequestDigest(expected: string, actual: string): void {
  if (!SHA256_DIGEST.test(expected) || expected !== actual) {
    throw new TypeError('Provider request key cannot be reused with a different request body')
  }
}

function safeUpstreamRequestId(headers: Headers): string | undefined {
  for (const header of UPSTREAM_REQUEST_ID_HEADERS) {
    const value = headers.get(header)?.trim()
    if (value && SAFE_UPSTREAM_REQUEST_ID.test(value) && !SENSITIVE_IDENTIFIER.test(value)) return value
  }
  return undefined
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code.toUpperCase() : undefined
}

function failure(error: unknown): Pick<ProviderAttemptFailureMetadata, 'outcome' | 'reason'> {
  const name = error instanceof Error ? error.name : undefined
  const code = errorCode(error)
  if (code === 'INVALID_ENDPOINT' || code === 'PRIVATE_ENDPOINT') {
    return { outcome: 'failed_definite', reason: 'invalid_request_metadata' }
  }
  if (name === 'TimeoutError' || code === 'ETIMEDOUT')
    return { outcome: 'outcome_unknown', reason: 'request_timed_out' }
  if (name === 'AbortError' || code === 'ABORT_ERR') return { outcome: 'outcome_unknown', reason: 'request_aborted' }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return { outcome: 'failed_definite', reason: 'name_resolution_failed' }
  }
  if (code === 'ECONNREFUSED' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EADDRNOTAVAIL') {
    return { outcome: 'failed_definite', reason: 'connection_failed' }
  }
  return { outcome: 'outcome_unknown', reason: 'network_error' }
}

export interface ProviderAttemptInput {
  body: unknown
  providerRequestKey?: string
  idempotencyMode?: ProviderIdempotencyMode
  expectedRequestBodyDigest?: string
  headers?: HeadersInit
  send: (body: string, headers: Headers) => Promise<Response>
}

export interface ProviderAttemptResult {
  response: Response
  metadata: ProviderAttemptMetadata
}

/**
 * Executes one provider call while exposing only persistence-safe attempt metadata.
 * Stable idempotency is opt-in because generic providers do not share this contract.
 */
export async function executeProviderAttempt(input: ProviderAttemptInput): Promise<ProviderAttemptResult> {
  const idempotencyMode = input.idempotencyMode ?? 'unsupported'
  let requestBodyDigest = 'unavailable'
  let idempotencyHeaderSent = false
  let validationFailureReason: ProviderAttemptFailureMetadata['reason'] = 'invalid_request_metadata'

  try {
    requestBodyDigest = providerRequestBodyDigest(input.body)
    if (
      input.providerRequestKey !== undefined &&
      (!PROVIDER_REQUEST_KEY.test(input.providerRequestKey) || SENSITIVE_IDENTIFIER.test(input.providerRequestKey))
    ) {
      throw new TypeError('Provider request key is invalid')
    }
    if (idempotencyMode === 'stable' && input.providerRequestKey === undefined) {
      throw new TypeError('Stable provider idempotency requires a provider request key')
    }
    if (input.expectedRequestBodyDigest !== undefined) {
      validationFailureReason = 'request_digest_mismatch'
      assertProviderRequestDigest(input.expectedRequestBodyDigest, requestBodyDigest)
    }
  } catch {
    throw new ProviderAttemptError({
      ...(input.providerRequestKey &&
      PROVIDER_REQUEST_KEY.test(input.providerRequestKey) &&
      !SENSITIVE_IDENTIFIER.test(input.providerRequestKey)
        ? { providerRequestKey: input.providerRequestKey }
        : {}),
      requestBodyDigest,
      idempotencyMode,
      idempotencyHeaderSent,
      outcome: 'failed_definite',
      reason: validationFailureReason,
    })
  }

  const headers = new Headers(input.headers)
  if (idempotencyMode === 'stable') {
    headers.set('idempotency-key', input.providerRequestKey as string)
    idempotencyHeaderSent = true
  } else {
    headers.delete('idempotency-key')
  }
  const baseMetadata: ProviderAttemptMetadata = {
    ...(input.providerRequestKey ? { providerRequestKey: input.providerRequestKey } : {}),
    requestBodyDigest,
    idempotencyMode,
    idempotencyHeaderSent,
  }

  try {
    const response = await input.send(canonicalJson(input.body), headers)
    const upstreamRequestId = safeUpstreamRequestId(response.headers)
    return {
      response,
      metadata: {
        ...baseMetadata,
        ...(upstreamRequestId ? { upstreamRequestId } : {}),
      },
    }
  } catch (error) {
    throw new ProviderAttemptError({ ...baseMetadata, ...failure(error) })
  }
}
