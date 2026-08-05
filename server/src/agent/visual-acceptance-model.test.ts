import { describe, expect, it, vi } from 'vitest'
import type { ResolvedAgentModelRuntime } from '../routes/agent-config.js'
import type { PinnedHttpsRequest } from './outbound-https.js'
import { AgentVisualAcceptanceProviderResponseError, requestAgentVisualAcceptance } from './visual-acceptance-model.js'

const runtime: ResolvedAgentModelRuntime = {
  profileId: 'profile-1',
  provider: 'platform',
  endpoint: new URL('https://model.example.com/v1'),
  apiKey: 'secret',
  model: 'gpt-5.4',
  budget: { taskMicros: 1_000_000, projectMonthMicros: 10_000_000, warningRatio: 0.8 },
  capabilities: { structuredOutput: true, vision: true, toolCalling: false },
  billingScope: 'project',
  payerId: 'project-1',
  source: 'platform-default',
}

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

function response(decision: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ decision }) } }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('visual acceptance model', () => {
  it('sends reference images before the final screenshot and parses a strict revision decision', async () => {
    const request = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content?: Array<{ type: string; image_url?: { url: string } }> }>
      }
      const images = body.messages[1]?.content?.filter(item => item.type === 'image_url') ?? []
      expect(images.map(item => item.image_url?.url)).toEqual([
        'data:image/png;base64,REF',
        'data:image/png;base64,FINAL',
      ])
      return response({
        action: 'revise',
        summary: '左右面板不完整',
        findings: [{ code: 'missing_side_panel', severity: 'blocking', description: '右侧面板未实现' }],
        confidence: 0.98,
      })
    })

    await expect(
      requestAgentVisualAcceptance({
        runtime,
        criteria: '实现左右面板',
        referenceImageDataUrls: ['data:image/png;base64,REF'],
        screenshotDataUrl: 'data:image/png;base64,FINAL',
        resolveHost: async () => ['93.184.216.34'],
        request: pinnedRequest(request),
      }),
    ).resolves.toMatchObject({
      output: { action: 'revise', confidence: 0.98 },
      usage: { totalTokens: 150 },
      providerAttempt: { requestBodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    })
  })

  it('rejects pass decisions that still contain blocking findings', async () => {
    await expect(
      requestAgentVisualAcceptance({
        runtime,
        criteria: '完成大屏',
        screenshotDataUrl: 'data:image/png;base64,FINAL',
        resolveHost: async () => ['93.184.216.34'],
        request: pinnedRequest(
          vi.fn<typeof globalThis.fetch>(async () =>
            response({
              action: 'pass',
              summary: '完成',
              findings: [{ code: 'overlap', severity: 'blocking', description: '仍有重叠' }],
              confidence: 0.9,
            }),
          ),
        ),
      }),
    ).rejects.toBeInstanceOf(AgentVisualAcceptanceProviderResponseError)
  })
})
import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
