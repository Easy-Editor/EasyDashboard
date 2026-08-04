import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedAgentModelRuntime } from '../routes/agent-config.js'
import type { AgentProviderInputSnapshot } from '../types.js'
import type { PinnedHttpsRequest } from './outbound-https.js'
import { requestAgentTaskPlanningDecision } from './task-planning-model.js'

function pinnedRequest(modelFetch: typeof fetch): PinnedHttpsRequest {
  return (url, options, callback) => {
    const request = new EventEmitter() as EventEmitter & {
      body: string
      write: (chunk: string) => void
      end: () => void
    }
    request.body = ''
    request.write = chunk => {
      request.body += chunk
    }
    request.end = () => {
      void modelFetch(url, {
        method: options.method,
        headers: options.headers as HeadersInit,
        body: request.body,
      }).then(
        source => {
          const response = new PassThrough() as PassThrough & IncomingMessage
          response.statusCode = source.status
          response.statusMessage = source.statusText
          const headers: Record<string, string> = {}
          source.headers.forEach((value, name) => {
            headers[name] = value
          })
          response.headers = headers
          callback(response)
          void source.arrayBuffer().then(body => response.end(Buffer.from(body)))
        },
        error => request.emit('error', error),
      )
    }
    return request as unknown as ClientRequest
  }
}

const runtime: ResolvedAgentModelRuntime = {
  profileId: 'platform:default',
  provider: 'platform',
  endpoint: new URL('https://models.example.com/v1'),
  apiKey: 'server-only-key',
  model: 'gpt-5.6',
  budget: { taskMicros: 1_000_000, projectMonthMicros: 20_000_000, warningRatio: 0.8 },
  capabilities: { vision: true, toolCalling: true, structuredOutput: true },
  billingScope: 'project',
  payerId: '22222222-2222-4222-8222-222222222222',
  source: 'platform-default',
}

const snapshot: AgentProviderInputSnapshot = {
  systemPrompt: 'legacy ChangeSet prompt must not be sent by the planning model',
  userText: JSON.stringify({ requirement: '照参考图搭建经营大屏', project: { document: {} } }),
  trace: { promptBundleId: 'source', promptBundleVersion: '1', promptBundleHash: 'a'.repeat(64), skills: [] },
  images: [],
}

describe('Agent task planning model boundary', () => {
  it('requests a semantic plan without ChangeSet operations and preserves the provider lifecycle', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: {
                    action: 'plan',
                    summary: '建立清晰的左右面板与中心主视觉',
                    assumptions: ['现有数据可用于预览'],
                    risks: ['参考图部分细节不可见'],
                    verification: { strategy: '每步预览', checks: ['左右面板对齐', '核心指标可读'] },
                    steps: [
                      {
                        semanticKey: 'layout-shell',
                        title: '建立大屏布局骨架',
                        intent: '先形成左右面板和中心区域的稳定层级',
                      },
                    ],
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const prepare = vi.fn(
      async (input: { requestBodyDigest: string; idempotencyMode: 'unsupported' | 'stable' }) => input,
    )
    const markStarted = vi.fn(async () => undefined)

    const result = await requestAgentTaskPlanningDecision({
      runtime,
      providerInputSnapshot: snapshot,
      resolveHost: async () => ['93.184.216.34'],
      request: pinnedRequest(fetch),
      providerAttemptLifecycle: { prepare, markStarted },
    })

    expect(result.output).toMatchObject({ action: 'plan', steps: [{ semanticKey: 'layout-shell' }] })
    expect(prepare).toHaveBeenCalledOnce()
    expect(markStarted).toHaveBeenCalledOnce()
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('operations')
    expect(serialized).not.toContain('ChangeSet')
    expect(serialized).not.toContain('nodeId')
    expect(serialized).toContain('semanticKey')
  })

  it('accepts a clarification decision without fabricating plan steps', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: {
                    action: 'ask_user',
                    summary: '需要确认核心指标',
                    question: { id: 'metric-focus', text: '最需要突出销售额还是利润率？' },
                  },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await requestAgentTaskPlanningDecision({
      runtime,
      providerInputSnapshot: snapshot,
      resolveHost: async () => ['93.184.216.34'],
      request: pinnedRequest(fetch),
    })

    expect(result.output).toEqual({
      action: 'ask_user',
      summary: '需要确认核心指标',
      question: { id: 'metric-focus', text: '最需要突出销售额还是利润率？' },
    })
  })

  it.each([429, 500])('classifies HTTP %s as a transient provider response', async status => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('temporarily unavailable', { status }))

    const promise = requestAgentTaskPlanningDecision({
      runtime,
      providerInputSnapshot: snapshot,
      resolveHost: async () => ['93.184.216.34'],
      request: pinnedRequest(fetch),
    })

    await expect(promise).rejects.toMatchObject({
      classification: 'transient',
      providerAttempt: { requestBodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    })
  })

  it.each([
    ['malformed JSON', '{'],
    ['invalid envelope', JSON.stringify({ choices: [] })],
  ])('classifies a %s envelope as transient', async (_label, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, { status: 200 }))

    await expect(
      requestAgentTaskPlanningDecision({
        runtime,
        providerInputSnapshot: snapshot,
        resolveHost: async () => ['93.184.216.34'],
        request: pinnedRequest(fetch),
      }),
    ).rejects.toMatchObject({ classification: 'transient' })
  })

  it('classifies a structurally invalid plan as deterministic invalid output', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: {
                    action: 'plan',
                    summary: 'invalid empty plan',
                    assumptions: [],
                    risks: [],
                    verification: { strategy: 'preview', checks: ['visible'] },
                    steps: [],
                  },
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const promise = requestAgentTaskPlanningDecision({
      runtime,
      providerInputSnapshot: snapshot,
      resolveHost: async () => ['93.184.216.34'],
      request: pinnedRequest(fetch),
    })

    await expect(promise).rejects.toMatchObject({ classification: 'invalid_output' })
  })
})
