import { describe, expect, it, vi } from 'vitest'
import { ProviderAttemptError, executeProviderAttempt, providerRequestBodyDigest } from './provider-attempt.js'

describe('provider attempt safety boundary', () => {
  it('uses a canonical body digest and rejects a key reused for a different body', async () => {
    const first = { model: 'safe-model', messages: [{ role: 'user', content: 'hello' }], options: { b: 2, a: 1 } }
    const reordered = { options: { a: 1, b: 2 }, messages: [{ content: 'hello', role: 'user' }], model: 'safe-model' }
    expect(providerRequestBodyDigest(first)).toBe(providerRequestBodyDigest(reordered))

    const expectedRequestBodyDigest = providerRequestBodyDigest(first)
    await expect(
      executeProviderAttempt({
        body: { ...first, model: 'different-model' },
        providerRequestKey: 'run-1-attempt-1',
        idempotencyMode: 'stable',
        expectedRequestBodyDigest,
        send: vi.fn(),
      }),
    ).rejects.toMatchObject({
      metadata: {
        outcome: 'failed_definite',
        reason: 'request_digest_mismatch',
        providerRequestKey: 'run-1-attempt-1',
      },
    })
  })

  it('sends Idempotency-Key only for an explicitly stable provider contract', async () => {
    const seen: Headers[] = []
    const send = vi.fn(async (_body: string, headers: Headers) => {
      seen.push(headers)
      return new Response('{}', { status: 200 })
    })
    await executeProviderAttempt({
      body: { model: 'safe-model' },
      providerRequestKey: 'run-1-attempt-1',
      idempotencyMode: 'unsupported',
      headers: { 'Idempotency-Key': 'caller-must-not-smuggle-this' },
      send,
    })
    const stable = await executeProviderAttempt({
      body: { model: 'safe-model' },
      providerRequestKey: 'run-1-attempt-2',
      idempotencyMode: 'stable',
      send,
    })

    expect(seen[0]?.has('idempotency-key')).toBe(false)
    expect(seen[1]?.get('idempotency-key')).toBe('run-1-attempt-2')
    expect(stable.metadata.idempotencyHeaderSent).toBe(true)
  })

  it('captures only a bounded safe upstream request ID', async () => {
    const accepted = await executeProviderAttempt({
      body: {},
      send: async () => new Response('{}', { headers: { 'x-request-id': 'req_01-safe/value' } }),
    })
    const rejected = await executeProviderAttempt({
      body: {},
      send: async () => new Response('{}', { headers: { 'x-request-id': 'Bearer super-secret-token' } }),
    })
    expect(accepted.metadata.upstreamRequestId).toBe('req_01-safe/value')
    expect(rejected.metadata).not.toHaveProperty('upstreamRequestId')
  })

  it.each([
    ['ENOTFOUND', 'failed_definite', 'name_resolution_failed'],
    ['ECONNREFUSED', 'failed_definite', 'connection_failed'],
    ['ETIMEDOUT', 'outcome_unknown', 'request_timed_out'],
    ['ECONNRESET', 'outcome_unknown', 'network_error'],
  ] as const)('classifies %s without exposing the raw error', async (code, outcome, reason) => {
    const secret = 'provider-secret-from-socket'
    const failure = Object.assign(new Error(secret), { code })
    let caught: unknown
    try {
      await executeProviderAttempt({ body: { safe: true }, send: async () => Promise.reject(failure) })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProviderAttemptError)
    expect(caught).toMatchObject({ metadata: { outcome, reason } })
    expect(JSON.stringify((caught as ProviderAttemptError).metadata)).not.toContain(secret)
    expect((caught as Error).message).not.toContain(secret)
  })
})
