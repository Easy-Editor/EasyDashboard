import { describe, expect, it } from 'vitest'
import {
  EMPTY_AGENT_USER_PREFERENCE_MEMORY,
  agentUserPreferencesForModel,
  isAgentUserPreferenceContentSafe,
  readAgentUserPreferenceMemory,
} from './agent-user-preferences.js'

const now = '2026-08-01T00:00:00.000Z'

describe('Agent user preference memory', () => {
  it('treats missing or malformed settings as disabled memory', () => {
    expect(readAgentUserPreferenceMemory({})).toEqual(EMPTY_AGENT_USER_PREFERENCE_MEMORY)
    expect(readAgentUserPreferenceMemory({ agentPreferenceMemory: { enabled: true, preferences: [{}] } })).toEqual(
      EMPTY_AGENT_USER_PREFERENCE_MEMORY,
    )
  })

  it('projects only bounded plain preferences and drops credential-like content', () => {
    const preferences = agentUserPreferencesForModel({
      version: 1,
      revision: 2,
      enabled: true,
      updatedAt: now,
      preferences: Array.from({ length: 14 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        category: 'visual' as const,
        content: index === 1 ? 'apiKey=do-not-inject' : `偏好 ${index}`,
        source: 'explicit' as const,
        createdAt: now,
        updatedAt: now,
      })),
    })

    expect(preferences).toHaveLength(12)
    expect(preferences.some(item => item.content.includes('do-not-inject'))).toBe(false)
    expect(preferences.every(item => typeof item.content === 'string')).toBe(true)
  })

  it.each([
    ['OpenAI project key in prose', 'use token sk-proj-fakeKey1234567890 for the next request'],
    ['generic sk token', '模型密钥是 sk-fakeSecret1234567890'],
    ['Anthropic key', 'use sk-ant-api03-fakeSecret1234567890'],
    ['Stripe-style secret', 'credential sk_live_fakeSecret1234567890'],
    ['API key token prefix', 'use api_key_live_fakeSecret1234567890'],
    ['Google API key', 'key AIzaSyFakeCredential123456789012345'],
    ['GitHub token', 'token ghp_FakeCredential12345678901234567890'],
    ['Slack token', ['token ', 'xoxb-', '1234567890-', 'fakeCredentialValue'].join('')],
    ['JWT', 'session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fakeSignature123456'],
    ['nonstandard JWT header', 'session abcdefgh1234.ijklmnop5678.qrstuvwx9012'],
    ['PEM private key', '-----BEGIN PRIVATE KEY-----\nfake-private-key-material\n-----END PRIVATE KEY-----'],
    ['credentialed URL', 'connect to https://dashboard-user:fake-password@example.com/api'],
    ['password in prose', 'password is fake-password-value'],
    ['Bearer token', 'Authorization uses Bearer abcd12'],
    ['authorization assignment', 'authorization=Basic ZmFrZTpmYWtl'],
    ['cookie assignment', 'cookie: session=fakeCookieValue'],
    ['access token assignment', 'access_token = fakeAccessTokenValue'],
  ])('fails closed for %s', (_name, content) => {
    expect(isAgentUserPreferenceContentSafe(content)).toBe(false)

    const projected = agentUserPreferencesForModel({
      version: 1,
      revision: 1,
      enabled: true,
      updatedAt: now,
      preferences: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          category: 'other',
          content: `保留这部分设计偏好；${content}；也不要泄漏这一部分`,
          source: 'explicit',
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    expect(projected).toEqual([])
  })

  it.each([
    '中文界面优先使用简洁、克制的视觉风格',
    '图表配色使用蓝绿色，并确保文字对比度充足',
    'Use a three-column layout with compact spacing',
    '登录按钮放在右上角，表单标签使用中文',
    'The password field should include a visibility toggle',
    'Use bearer authentication documentation as the help-link label',
    '版本号展示为 1.2.3，卡片圆角为 8px',
  ])('keeps normal preference content: %s', content => {
    expect(isAgentUserPreferenceContentSafe(content)).toBe(true)
  })
})
