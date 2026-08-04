import { describe, expect, it } from 'vitest'
import {
  type ModelProfile,
  ModelProfileError,
  activateModelProfile,
  assertPublicResolvedAddresses,
  normalizeCustomModelEndpoint,
  selectModelProfile,
  toModelProfileManifest,
} from './model-profile.js'

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'profile-1',
    ownerId: 'user-1',
    projectId: null,
    provider: 'openai-compatible',
    endpoint: 'https://models.example.com/v1',
    model: 'vision-tools-model',
    billingScope: 'user',
    fallbackToPlatform: false,
    status: 'active',
    capabilities: { vision: true, toolCalling: true, structuredOutput: true },
    secret: { apiKey: 'secret-key' },
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  }
}

describe('model profile policy', () => {
  it.each([
    'http://models.example.com/v1',
    'https://localhost/v1',
    'https://api.internal/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.1/v1',
    'https://[::1]/v1',
    'https://[::ffff:7f00:1]/v1',
    'https://[ff02::1]/v1',
    'https://[2002:7f00:1::]/v1',
    'https://[64:ff9b::7f00:1]/v1',
    'https://[3fff::1]/v1',
    'https://[4000::1]/v1',
    'https://[5f00::1]/v1',
    'https://192.88.99.1/v1',
    'https://user:pass@models.example.com/v1',
  ])('rejects unsafe custom endpoint %s', endpoint => {
    expect(() => normalizeCustomModelEndpoint(endpoint)).toThrow(ModelProfileError)
  })

  it.each(['192.1.1.1', '198.52.1.1', '203.1.1.1'])('does not overblock public IPv4 address %s', address => {
    expect(() => assertPublicResolvedAddresses([address])).not.toThrow()
  })

  it('normalizes a public HTTPS endpoint without leaking its query', () => {
    expect(normalizeCustomModelEndpoint('https://models.example.com/v1?token=discard').toString()).toBe(
      'https://models.example.com/v1',
    )
  })

  it('rejects DNS resolution containing any private address', () => {
    expect(() => assertPublicResolvedAddresses(['203.0.113.5', '10.0.0.2'])).toThrow(ModelProfileError)
    expect(() => assertPublicResolvedAddresses([])).toThrow(ModelProfileError)
  })

  it('requires every Agent capability before activation', () => {
    expect(() =>
      activateModelProfile(profile({ status: 'probing', capabilities: null }), {
        vision: true,
        toolCalling: true,
        structuredOutput: false,
      }),
    ).toThrowError(/structured output/)
  })

  it('never silently falls back from an unavailable custom profile', () => {
    expect(
      selectModelProfile({
        customProfile: profile({ status: 'failed', capabilities: null, fallbackToPlatform: false }),
        platformProfile: profile({ id: 'platform', provider: 'platform', billingScope: 'project' }),
      }),
    ).toEqual({ kind: 'unavailable', code: 'CUSTOM_PROFILE_UNAVAILABLE' })
  })

  it('uses platform fallback only when the user explicitly enables it', () => {
    const platform = profile({ id: 'platform', provider: 'platform', billingScope: 'project' })
    expect(
      selectModelProfile({
        customProfile: profile({ status: 'failed', capabilities: null, fallbackToPlatform: true }),
        platformProfile: platform,
      }),
    ).toEqual({ kind: 'selected', profile: platform, source: 'platform' })
  })

  it('projects a manifest without API key or endpoint path', () => {
    expect(toModelProfileManifest(profile())).toEqual({
      id: 'profile-1',
      provider: 'openai-compatible',
      endpointOrigin: 'https://models.example.com',
      model: 'vision-tools-model',
      billingScope: 'user',
      fallbackToPlatform: false,
      capabilities: { vision: true, toolCalling: true, structuredOutput: true },
    })
  })
})
