import { lookup } from 'node:dns/promises'
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { type RequestOptions, request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import { ModelProfileError, assertPublicResolvedAddresses } from './model-profile.js'

export type OutboundHttpsResolver = (hostname: string) => Promise<readonly string[]>

export interface PinnedHttpsTarget {
  address: string
  family: 4 | 6
  hostname: string
  lookup: NonNullable<RequestOptions['lookup']>
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  if (isIP(hostname)) return [hostname]
  return (await lookup(hostname, { all: true, verbatim: true })).map(result => result.address)
}

/** Resolves once, validates every answer, then returns a lookup function pinned to one approved address. */
export async function resolvePinnedHttpsTarget(
  url: URL,
  resolveHost: OutboundHttpsResolver = defaultResolveHost,
): Promise<PinnedHttpsTarget> {
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new ModelProfileError('INVALID_ENDPOINT', 'Outbound model requests require a credential-free HTTPS URL')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = await resolveHost(hostname)
  assertPublicResolvedAddresses(addresses)
  const address = addresses[0] as string
  const family = isIP(address)
  if (family !== 4 && family !== 6) {
    throw new ModelProfileError('PRIVATE_ENDPOINT', 'Model endpoint must resolve only to public network addresses')
  }
  const lookup: NonNullable<RequestOptions['lookup']> = (_hostname, options, callback) => {
    if (typeof options === 'object' && options.all) {
      ;(callback as (error: null, addresses: Array<{ address: string; family: 4 | 6 }>) => void)(null, [
        { address, family },
      ])
      return
    }
    ;(callback as (error: null, address: string, family: 4 | 6) => void)(null, address, family)
  }
  return { address, family, hostname, lookup }
}

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach(item => result.append(name, item))
    else if (value !== undefined) result.set(name, value)
  }
  return result
}

async function readResponseBody(response: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maximumBytes) {
      response.destroy()
      throw new Error('Outbound HTTPS response is too large')
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

export interface PinnedHttpsFetchOptions {
  resolveHost?: OutboundHttpsResolver
  maximumResponseBytes: number
  request?: PinnedHttpsRequest
}

export type PinnedHttpsRequest = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest

/** HTTPS-only fetch subset that disables pooling/redirects and pins the socket to the validated DNS answer. */
export async function pinnedHttpsFetch(
  url: URL,
  init: RequestInit,
  options: PinnedHttpsFetchOptions,
): Promise<Response> {
  const target = await resolvePinnedHttpsTarget(url, options.resolveHost)
  const headers = new Headers(init.headers)
  headers.set('host', url.host)
  const requestHeaders: Record<string, string> = {}
  headers.forEach((value, name) => {
    requestHeaders[name] = value
  })
  const body = init.body == null ? undefined : String(init.body)

  return new Promise<Response>((resolve, reject) => {
    const request = (options.request ?? (httpsRequest as PinnedHttpsRequest))(
      url,
      {
        method: init.method,
        headers: requestHeaders,
        signal: init.signal ?? undefined,
        agent: false,
        lookup: target.lookup,
        rejectUnauthorized: true,
        checkServerIdentity: (_hostname, certificate) => checkServerIdentity(target.hostname, certificate),
        ...(isIP(target.hostname) ? {} : { servername: target.hostname }),
      },
      response => {
        void readResponseBody(response, options.maximumResponseBytes).then(
          responseBody =>
            resolve(
              new Response(responseBody, {
                status: response.statusCode ?? 500,
                statusText: response.statusMessage,
                headers: responseHeaders(response.headers),
              }),
            ),
          reject,
        )
      },
    )
    request.on('error', reject)
    if (body !== undefined) request.write(body)
    request.end()
  })
}

export function createPinnedHttpsFetch(options: PinnedHttpsFetchOptions): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
    return pinnedHttpsFetch(url, init ?? {}, options)
  }) as typeof fetch
}
