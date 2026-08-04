import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ModelProfileError } from './model-profile.js'
import { type PinnedHttpsRequest, pinnedHttpsFetch, resolvePinnedHttpsTarget } from './outbound-https.js'

function invokeLookup(lookup: NonNullable<RequestOptions['lookup']>): Promise<string> {
  return new Promise((resolve, reject) => {
    lookup('models.example.com', {}, (error, address) => {
      if (error) reject(error)
      else resolve(typeof address === 'string' ? address : (address[0]?.address ?? ''))
    })
  })
}

describe('pinned outbound HTTPS policy', () => {
  it('rejects mixed public and private DNS answers', async () => {
    await expect(
      resolvePinnedHttpsTarget(new URL('https://models.example.com/v1'), async () => ['93.184.216.34', '127.0.0.1']),
    ).rejects.toBeInstanceOf(ModelProfileError)
  })

  it('pins every connection lookup to the validated answer despite public-then-private rebinding', async () => {
    const resolveHost = vi
      .fn<() => Promise<readonly string[]>>()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValueOnce(['127.0.0.1'])

    const target = await resolvePinnedHttpsTarget(new URL('https://models.example.com/v1'), resolveHost)

    await expect(invokeLookup(target.lookup)).resolves.toBe('93.184.216.34')
    await expect(invokeLookup(target.lookup)).resolves.toBe('93.184.216.34')
    expect(resolveHost).toHaveBeenCalledOnce()
    expect(target.hostname).toBe('models.example.com')
  })

  it('accepts an all-public endpoint and preserves the original hostname for TLS SNI', async () => {
    await expect(
      resolvePinnedHttpsTarget(new URL('https://models.example.com/v1'), async () => [
        '93.184.216.34',
        '2606:2800:220:1:248:1893:25c8:1946',
      ]),
    ).resolves.toMatchObject({ address: '93.184.216.34', family: 4, hostname: 'models.example.com' })
  })

  it.each([
    { status: 200, body: '{"ok":true}' },
    { status: 302, body: '', location: 'https://127.0.0.1/private' },
  ])('pins actual request options and never follows a $status response', async ({ status, body, location }) => {
    let capturedOptions: RequestOptions | undefined
    const resolveHost = vi
      .fn<() => Promise<readonly string[]>>()
      .mockResolvedValueOnce(['93.184.216.34'])
      .mockResolvedValueOnce(['127.0.0.1'])
    const request: PinnedHttpsRequest = (_url, options, callback) => {
      capturedOptions = options
      const client = new EventEmitter() as EventEmitter & {
        write: (body: string) => void
        end: () => void
      }
      client.write = vi.fn()
      client.end = () => {
        const response = new PassThrough() as PassThrough & IncomingMessage
        response.statusCode = status
        response.statusMessage = status === 200 ? 'OK' : 'Found'
        response.headers = location ? { location } : { 'content-type': 'application/json' }
        callback(response)
        response.end(body)
      }
      return client as unknown as ClientRequest
    }

    const response = await pinnedHttpsFetch(
      new URL('https://models.example.com/v1/chat/completions'),
      { method: 'POST', redirect: 'follow', headers: { host: 'attacker.invalid' }, body: '{}' },
      { resolveHost, maximumResponseBytes: 1_024, request },
    )

    expect(response.status).toBe(status)
    expect(capturedOptions).toMatchObject({
      agent: false,
      rejectUnauthorized: true,
      servername: 'models.example.com',
      headers: { host: 'models.example.com' },
    })
    expect(capturedOptions?.checkServerIdentity).toBeTypeOf('function')
    expect(capturedOptions?.lookup).toBeTypeOf('function')
    await expect(invokeLookup(capturedOptions?.lookup as NonNullable<RequestOptions['lookup']>)).resolves.toBe(
      '93.184.216.34',
    )
    expect(resolveHost).toHaveBeenCalledOnce()
    if (status === 302) expect(response.headers.get('location')).toBe('https://127.0.0.1/private')
  })
})
