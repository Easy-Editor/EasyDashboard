import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const baseEnv = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'https://app.example.com',
  PUBLIC_VIEWER_ORIGIN: 'https://view.example.com',
  PORT: '8787',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1234567890',
  DATABASE_URL: 'postgresql://runtime',
}
const compatibility = {
  runtimeVersion: '0.1.0-m0',
  runtimeSha256: '1'.repeat(64),
  coreVersion: '1.0.3-m0',
  coreSha256: '2'.repeat(64),
  rendererVersion: '1.0.3-m0',
  rendererSha256: '3'.repeat(64),
  dashboardAgentHostVersion: '0.1.0-m0',
  dashboardAgentHostSha256: '4'.repeat(64),
  browserArtifactVersion: '0.0.0-m0',
  browserArtifactSha256: '6'.repeat(64),
  materialManifestVersion: 'manifest-2026-07-31',
  materialManifestSha256: '5'.repeat(64),
}

describe('Agent executor environment', () => {
  it('keeps the Agent planning model optional while validating a configured gateway', () => {
    expect(parseEnv(baseEnv)).not.toHaveProperty('EASY_EDITOR_AGENT_BASE_URL')
    expect(
      parseEnv({
        ...baseEnv,
        EASY_EDITOR_AGENT_BASE_URL: 'https://model.example.com/v1',
        EASY_EDITOR_AGENT_API_KEY: 'server-only-key',
        EASY_EDITOR_AGENT_MODEL: 'planner-model',
      }),
    ).toMatchObject({
      EASY_EDITOR_AGENT_BASE_URL: 'https://model.example.com/v1',
      EASY_EDITOR_AGENT_API_KEY: 'server-only-key',
      EASY_EDITOR_AGENT_MODEL: 'planner-model',
    })
  })

  it('accepts a bounded Agent model timeout override', () => {
    expect(parseEnv(baseEnv)).not.toHaveProperty('AGENT_MODEL_TIMEOUT_MS')
    expect(parseEnv({ ...baseEnv, AGENT_MODEL_TIMEOUT_MS: '180000' })).toMatchObject({
      AGENT_MODEL_TIMEOUT_MS: 180_000,
    })
    expect(() => parseEnv({ ...baseEnv, AGENT_MODEL_TIMEOUT_MS: '4999' })).toThrow('AGENT_MODEL_TIMEOUT_MS')
    expect(() => parseEnv({ ...baseEnv, AGENT_MODEL_TIMEOUT_MS: '600001' })).toThrow('AGENT_MODEL_TIMEOUT_MS')
  })

  it('keeps linked PieChart Agent capabilities off unless explicitly enabled', () => {
    expect(parseEnv(baseEnv)).not.toHaveProperty('AGENT_ENABLE_LINKED_PIE_CHART_0_0_8')
    expect(parseEnv({ ...baseEnv, AGENT_ENABLE_LINKED_PIE_CHART_0_0_8: 'true' })).toMatchObject({
      AGENT_ENABLE_LINKED_PIE_CHART_0_0_8: true,
    })
    expect(parseEnv({ ...baseEnv, AGENT_ENABLE_LINKED_PIE_CHART_0_0_8: 'false' })).toMatchObject({
      AGENT_ENABLE_LINKED_PIE_CHART_0_0_8: false,
    })
    expect(() => parseEnv({ ...baseEnv, AGENT_ENABLE_LINKED_PIE_CHART_0_0_8: '1' })).toThrow(
      'AGENT_ENABLE_LINKED_PIE_CHART_0_0_8',
    )
  })

  it('accepts an optional HMAC secret of at least 32 bytes', () => {
    expect(parseEnv(baseEnv)).not.toHaveProperty('AGENT_EXECUTOR_GRANT_SECRET')
    expect(
      parseEnv({
        ...baseEnv,
        AGENT_EXECUTOR_GRANT_SECRET: 'executor-grant-secret-with-at-least-32-bytes',
      }),
    ).toMatchObject({
      AGENT_EXECUTOR_GRANT_SECRET: 'executor-grant-secret-with-at-least-32-bytes',
    })
  })

  it('accepts only a base64-encoded 256-bit model profile encryption key', () => {
    const encryptionKey = Buffer.alloc(32, 9).toString('base64')
    expect(parseEnv({ ...baseEnv, AGENT_MODEL_PROFILE_ENCRYPTION_KEY: encryptionKey })).toMatchObject({
      AGENT_MODEL_PROFILE_ENCRYPTION_KEY: encryptionKey,
    })
    expect(() =>
      parseEnv({ ...baseEnv, AGENT_MODEL_PROFILE_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow('AGENT_MODEL_PROFILE_ENCRYPTION_KEY')
  })

  it('rejects a short executor HMAC secret instead of starting with weak authority', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        AGENT_EXECUTOR_GRANT_SECRET: 'too-short',
      }),
    ).toThrow('AGENT_EXECUTOR_GRANT_SECRET')
  })

  it('parses the deployment compatibility JSON into a strict tuple', () => {
    expect(
      parseEnv({
        ...baseEnv,
        AGENT_EXECUTOR_COMPATIBILITY_JSON: JSON.stringify(compatibility),
      }),
    ).toMatchObject({
      AGENT_EXECUTOR_COMPATIBILITY_JSON: compatibility,
    })
  })

  it.each([
    ['invalid JSON', '{not-json'],
    ['an incomplete tuple', JSON.stringify({ runtimeVersion: '0.1.0-m0' })],
    ['unknown tuple fields', JSON.stringify({ ...compatibility, unexpected: 'not-allowed' })],
  ])('rejects %s for the deployment compatibility lock', (_case, value) => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        AGENT_EXECUTOR_COMPATIBILITY_JSON: value,
      }),
    ).toThrow('AGENT_EXECUTOR_COMPATIBILITY_JSON')
  })
})
