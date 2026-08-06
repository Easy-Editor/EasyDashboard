import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'
import type { ResolvedAgentModelRuntime } from '../routes/agent-config.js'
import type { AgentAssetRecord, ProjectRecord } from '../types.js'
import {
  AGENT_CHANGE_SET_RESPONSE_FORMAT,
  AgentChangeSetProviderError,
  AgentChangeSetProviderResponseError,
  type AgentConversationTurn,
  agentAllowedOperationTypesForProviderInput,
  agentRequiresRemoveForProviderInput,
  agentRequiresRemoveForRequest,
  createAgentChangeSetResponseFormat,
  createAgentClarificationHistoryProviderInputSnapshot,
  createAgentProviderInputSnapshot,
  createAgentResponseProviderInputSnapshot,
  estimateAgentProviderInputTokens,
  requestAgentChangeSet,
} from './change-set-model.js'
import type { PinnedHttpsRequest } from './outbound-https.js'

const now = new Date('2026-07-31T12:00:00.000Z')
const publicResolver = async () => ['93.184.216.34'] as const

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
  model: 'vision-model',
  budget: { taskMicros: 1_000_000, projectMonthMicros: 20_000_000, warningRatio: 0.8 },
  capabilities: { vision: true, toolCalling: true, structuredOutput: true },
  billingScope: 'project',
  payerId: '22222222-2222-4222-8222-222222222222',
  source: 'platform-default',
}

const project = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '城市态势',
  description: null,
  draftVersion: 1,
  draftSchema: {
    componentsTree: [{ id: 'page-root', componentName: 'Page', children: [{ id: 'title', componentName: 'Text' }] }],
  },
  canvasWidth: 1920,
  canvasHeight: 1080,
  pageCount: 1,
} as unknown as ProjectRecord

const image = {
  id: '44444444-4444-4444-8444-444444444444',
  projectId: project.id,
  conversationId: '33333333-3333-4333-8333-333333333333',
  originalName: 'reference.png',
  contentType: 'image/png',
  size: 1_024,
  sha256: 'a'.repeat(64),
  status: 'ready',
  extractedText: null,
  storagePath: 'private/storage/path',
  createdAt: now,
  updatedAt: now,
} satisfies AgentAssetRecord

function providerOperationRefs(responseFormat: typeof AGENT_CHANGE_SET_RESPONSE_FORMAT): string[] {
  const schema = responseFormat.json_schema.schema as Record<string, unknown>
  const decision = (schema.properties as Record<string, Record<string, unknown>>).decision!
  const execute = (decision.anyOf as Array<Record<string, unknown>>).find(branch => {
    const properties = branch.properties as Record<string, Record<string, unknown>>
    return properties.action?.const === 'execute'
  })!
  const operations = (execute.properties as Record<string, Record<string, unknown>>).operations!
  const items = operations.items as { anyOf: Array<{ $ref: string }> }
  return items.anyOf.map(item => item.$ref)
}

function providerOperationDefinitions(responseFormat: typeof AGENT_CHANGE_SET_RESPONSE_FORMAT): string[] {
  const schema = responseFormat.json_schema.schema as Record<string, unknown>
  return Object.keys(schema.$defs as Record<string, unknown>)
}

function clarificationResponse() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              decision: {
                action: 'ask_user',
                message: '需要确认数据模式。',
                question: { id: 'data-mode', text: '使用示例数据吗？' },
                plan: null,
              },
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('Agent ChangeSet model boundary', () => {
  it('projects only allowlisted data source references and removes transport details from the model document', () => {
    const dataProject = {
      ...project,
      draftSchema: {
        dataSource: {
          list: [
            {
              id: 'global-orders',
              label: '订单接口',
              type: 'fetch',
              options: {
                uri: 'https://private-api.example.com/orders',
                headers: { authorization: 'Bearer top-secret-token' },
                body: { password: 'never-send-this' },
              },
            },
          ],
        },
        componentsTree: [
          {
            id: 'page-root',
            componentName: 'Page',
            dataSource: {
              list: [
                {
                  id: 'root-summary',
                  name: '全局汇总',
                  type: 'graphql',
                  options: { uri: 'https://root-secret.example.com/graphql' },
                },
              ],
            },
            children: [
              {
                id: 'orders-chart',
                componentName: 'Chart',
                dataSource: {
                  list: [
                    {
                      id: 'local-orders',
                      title: '组件订单',
                      type: 'fetch',
                      options: { uri: 'https://component-secret.example.com/orders', apiKey: 'local-secret' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    } as unknown as ProjectRecord

    const snapshot = createAgentProviderInputSnapshot({
      prompt: '绑定已有订单数据',
      project: dataProject,
      conversationId: 'conversation-data-source-projection',
      taskId: 'task-data-source-projection',
      attachments: [],
      projectContext: [],
    })
    const serialized = snapshot.userText
    const payload = JSON.parse(serialized) as {
      project: { document: Record<string, unknown>; dataSourceRefs: Array<Record<string, string>> }
    }

    expect(payload.project.dataSourceRefs).toEqual([
      { scope: 'global', ownerNodeId: 'page-root', id: 'global-orders', label: '订单接口', type: 'fetch' },
      { scope: 'global', ownerNodeId: 'page-root', id: 'root-summary', label: '全局汇总', type: 'graphql' },
      { scope: 'component', ownerNodeId: 'orders-chart', id: 'local-orders', label: '组件订单', type: 'fetch' },
    ])
    expect(JSON.stringify(payload.project.document)).not.toContain('dataSource')
    expect(serialized).not.toMatch(
      /private-api|root-secret|component-secret|top-secret-token|never-send-this|local-secret/u,
    )
  })

  it('creates a strict response schema containing only the requested operation types', () => {
    const responseFormat = createAgentChangeSetResponseFormat(['insert', 'set'])

    expect(providerOperationRefs(responseFormat)).toEqual(['#/$defs/insertOperation', '#/$defs/setOperation'])
    expect(providerOperationDefinitions(responseFormat).sort()).toEqual(['insertOperation', 'setOperation'])
  })

  it('limits a frozen blank project response schema to creation-safe operations', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(clarificationResponse())
    const blankProject = {
      ...project,
      draftSchema: {
        componentsTree: [{ id: 'page-home-root', componentName: 'Root', children: [] }],
      },
    } as unknown as ProjectRecord

    await requestAgentChangeSet({
      runtime,
      prompt: '创建经营分析大屏',
      project: blankProject,
      conversationId: 'conversation-blank-operation-schema',
      taskId: 'task-blank-operation-schema',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      response_format: typeof AGENT_CHANGE_SET_RESPONSE_FORMAT
    }
    expect(providerOperationRefs(body.response_format)).toEqual(['#/$defs/insertOperation', '#/$defs/setOperation'])
  })

  it('keeps every operation type available after the project has content', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(clarificationResponse())

    await requestAgentChangeSet({
      runtime,
      prompt: '删除旧标题并调整现有布局',
      project,
      conversationId: 'conversation-existing-operation-schema',
      taskId: 'task-existing-operation-schema',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      response_format: typeof AGENT_CHANGE_SET_RESPONSE_FORMAT
    }
    expect(providerOperationRefs(body.response_format)).toEqual([
      '#/$defs/insertOperation',
      '#/$defs/moveOperation',
      '#/$defs/resizeOperation',
      '#/$defs/setOperation',
      '#/$defs/unsetOperation',
      '#/$defs/reorderOperation',
      '#/$defs/removeOperation',
    ])
  })

  it.each([
    '不要删除中央地球，只把它缩小并压暗',
    '不新增、不删除，只校准当前地球',
    '不新增不删除，保持其他内容不变',
    '把删除按钮移到右侧',
  ])('does not authorize remove for a refinement request: %s', async prompt => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(clarificationResponse())

    await requestAgentChangeSet({
      runtime,
      prompt,
      project,
      conversationId: `conversation-no-remove-${prompt.length}`,
      taskId: `task-no-remove-${prompt.length}`,
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      response_format: typeof AGENT_CHANGE_SET_RESPONSE_FORMAT
    }
    expect(providerOperationRefs(body.response_format)).not.toContain('#/$defs/removeOperation')
    expect(providerOperationDefinitions(body.response_format)).not.toContain('removeOperation')
  })

  it.each(['删除旧标题', '移除中央地球', '去掉过时组件', '清空当前分组'])(
    'authorizes remove only for an explicit removal request: %s',
    async prompt => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(clarificationResponse())

      await requestAgentChangeSet({
        runtime,
        prompt,
        project,
        conversationId: `conversation-remove-${prompt.length}`,
        taskId: `task-remove-${prompt.length}`,
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
      })

      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
        response_format: typeof AGENT_CHANGE_SET_RESPONSE_FORMAT
      }
      expect(providerOperationRefs(body.response_format)).toContain('#/$defs/removeOperation')
      expect(providerOperationDefinitions(body.response_format)).toContain('removeOperation')
    },
  )

  it('requires a real remove only for an effective explicit delete directive', () => {
    expect(agentRequiresRemoveForRequest('删除旧标题')).toBe(true)
    expect(agentRequiresRemoveForRequest('隐藏旧标题')).toBe(false)
    expect(agentRequiresRemoveForRequest('不要删除旧标题，只隐藏')).toBe(false)

    const deleting = createAgentProviderInputSnapshot({
      prompt: '隐藏旧标题',
      project,
      conversationId: 'conversation-require-remove',
      taskId: 'task-require-remove',
      attachments: [],
      projectContext: [],
    })
    const clarifiedDelete = createAgentResponseProviderInputSnapshot(
      deleting,
      { id: 'confirm-remove', text: '如何处理旧标题？' },
      '彻底删除旧标题',
      [],
      [],
    )
    const clarifiedHide = createAgentResponseProviderInputSnapshot(
      createAgentProviderInputSnapshot({
        prompt: '删除旧标题',
        project,
        conversationId: 'conversation-require-hide',
        taskId: 'task-require-hide',
        attachments: [],
        projectContext: [],
      }),
      { id: 'confirm-remove', text: '确认删除吗？' },
      '不要删除，只隐藏',
      [],
      [],
    )

    expect(agentRequiresRemoveForProviderInput(clarifiedDelete)).toBe(true)
    expect(agentRequiresRemoveForProviderInput(clarifiedHide)).toBe(false)
  })

  it('lets the frozen clarification response override the original remove directive', () => {
    const deleting = createAgentProviderInputSnapshot({
      prompt: '删除旧地球',
      project,
      conversationId: 'conversation-remove-clarification',
      taskId: 'task-remove-clarification',
      attachments: [],
      projectContext: [],
    })
    const cancelled = createAgentResponseProviderInputSnapshot(
      deleting,
      { id: 'confirm-remove', text: '确认删除吗？' },
      '不要删除了，只压暗',
      [],
      [],
    )
    const keeping = createAgentProviderInputSnapshot({
      prompt: '不要删除旧地球',
      project,
      conversationId: 'conversation-keep-clarification',
      taskId: 'task-keep-clarification',
      attachments: [],
      projectContext: [],
    })
    const authorized = createAgentResponseProviderInputSnapshot(
      keeping,
      { id: 'confirm-remove', text: '如何处理旧地球？' },
      '删除旧地球',
      [],
      [],
    )

    expect(agentAllowedOperationTypesForProviderInput(cancelled)).not.toContain('remove')
    expect(agentAllowedOperationTypesForProviderInput(authorized)).toContain('remove')
  })

  it('requests a strict object-rooted schema for every supported planning decision and operation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: {
                    action: 'ask_user',
                    message: '需要确认数据模式。',
                    question: { id: 'data-mode', text: '使用示例数据吗？' },
                    plan: null,
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '调整经营大屏并删除旧组件',
      project,
      conversationId: 'conversation-strict-schema',
      taskId: 'task-strict-schema',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    expect(result.output).toEqual({
      action: 'ask_user',
      message: '需要确认数据模式。',
      question: { id: 'data-mode', text: '使用示例数据吗？' },
    })
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      response_format: typeof AGENT_CHANGE_SET_RESPONSE_FORMAT
    }
    expect(body.response_format).toEqual(AGENT_CHANGE_SET_RESPONSE_FORMAT)
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'easy_dashboard_agent_decision', strict: true },
    })

    const schema = body.response_format.json_schema.schema as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect(schema).not.toHaveProperty('anyOf')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['decision'])
    const decision = (schema.properties as Record<string, Record<string, unknown>>).decision!
    const decisionBranches = decision.anyOf as Array<Record<string, unknown>>
    expect(
      decisionBranches.map(branch => {
        const properties = branch.properties as Record<string, Record<string, unknown>>
        return properties.action!.const
      }),
    ).toEqual(['ask_user', 'execute', 'execute_semantic'])

    const definitions = schema.$defs as Record<string, Record<string, unknown>>
    expect(Object.keys(definitions).sort()).toEqual(
      [
        'insertOperation',
        'moveOperation',
        'resizeOperation',
        'setOperation',
        'unsetOperation',
        'reorderOperation',
        'removeOperation',
      ].sort(),
    )
    expect((definitions.insertOperation!.properties as Record<string, unknown>).fields).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['fieldId', 'valueJson'],
        additionalProperties: false,
      },
    })
    expect((definitions.setOperation!.properties as Record<string, unknown>).valueJson).toMatchObject({
      type: 'string',
    })

    let constNodeCount = 0
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      const candidate = value as Record<string, unknown>
      if (Object.hasOwn(candidate, 'const')) {
        constNodeCount += 1
        expect(candidate.type).toBe('string')
      }
      if (candidate.type === 'object') {
        const properties = candidate.properties as Record<string, unknown>
        expect(candidate.additionalProperties).toBe(false)
        expect([...(candidate.required as string[])].sort()).toEqual(Object.keys(properties).sort())
      }
      Object.values(candidate).forEach(visit)
    }
    visit(schema)
    expect(constNodeCount).toBeGreaterThan(0)
    expect(JSON.stringify(schema)).not.toContain('propertyNames')
    expect(JSON.stringify(schema)).not.toContain('maxLength')
  })

  it('decodes strict provider field values back into the existing ChangeSet operation contract', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: {
                    action: 'execute',
                    summary: '建立标题并更新现有标题',
                    plan: ['建立可编辑标题', '更新现有标题'],
                    operations: [
                      {
                        type: 'insert',
                        parentId: 'page-root',
                        componentName: 'EasyEditorMaterialsText',
                        position: null,
                        fields: [
                          {
                            fieldId: 'data.config',
                            valueJson: JSON.stringify({
                              sourceType: 'static',
                              staticData: [{ text: '全球自然资源' }],
                            }),
                          },
                          {
                            fieldId: 'shared.rect',
                            valueJson: JSON.stringify({ x: 72, y: 48, width: 720, height: 56 }),
                          },
                        ],
                      },
                      {
                        type: 'set',
                        nodeId: 'title',
                        fieldId: 'props.fontWeight',
                        valueJson: JSON.stringify('bold'),
                      },
                      { type: 'move', nodeId: 'title', parentId: 'page-root', position: null },
                      { type: 'resize', nodeId: 'title', rect: { x: 80, y: 48, width: 760, height: 60 } },
                      { type: 'unset', nodeId: 'title', fieldId: 'props.glowIntensity' },
                      { type: 'reorder', nodeId: 'title', position: { place: 'first' } },
                      { type: 'remove', nodeId: 'obsolete-title' },
                    ],
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '创建全球自然资源标题',
      project,
      conversationId: 'conversation-strict-values',
      taskId: 'task-strict-values',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    expect(result.output).toEqual({
      action: 'execute',
      summary: '建立标题并更新现有标题',
      plan: ['建立可编辑标题', '更新现有标题'],
      operations: [
        {
          type: 'insert',
          parentId: 'page-root',
          componentName: 'EasyEditorMaterialsText',
          fields: {
            'data.config': { sourceType: 'static', staticData: [{ text: '全球自然资源' }] },
            'shared.rect': { x: 72, y: 48, width: 720, height: 56 },
          },
        },
        { type: 'set', nodeId: 'title', fieldId: 'props.fontWeight', value: 'bold' },
        { type: 'move', nodeId: 'title', parentId: 'page-root' },
        { type: 'resize', nodeId: 'title', rect: { x: 80, y: 48, width: 760, height: 60 } },
        { type: 'unset', nodeId: 'title', fieldId: 'props.glowIntensity' },
        { type: 'reorder', nodeId: 'title', position: { place: 'first' } },
        { type: 'remove', nodeId: 'obsolete-title' },
      ],
    })
  })

  it('allows complex dashboard generation for 120 seconds by default and honors an explicit override', async () => {
    const response = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '生成经营大屏',
                  operations: [{ type: 'set', nodeId: 'title', fieldId: 'props.text', value: '经营分析' }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response())
    const timeout = vi.spyOn(AbortSignal, 'timeout')

    try {
      const baseInput = {
        runtime,
        prompt: '创建经营大屏',
        project,
        conversationId: 'conversation-1',
        taskId: 'task-1',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
      } as const
      await requestAgentChangeSet(baseInput)
      await requestAgentChangeSet({ ...baseInput, timeoutMs: 180_000 })

      expect(timeout).toHaveBeenNthCalledWith(1, 240_000)
      expect(timeout).toHaveBeenNthCalledWith(2, 180_000)
    } finally {
      timeout.mockRestore()
    }
  })

  it('materializes a semantic model decision against the frozen selected object', async () => {
    const snapshot = createAgentProviderInputSnapshot({
      prompt: '把这个标题改成银行经营总览',
      selectionContext: {
        selectedRefs: [{ id: 'title', title: '大屏标题', componentName: 'Text' }],
      },
      project,
      conversationId: 'conversation-semantic',
      taskId: 'task-semantic',
      attachments: [],
      projectContext: [],
    })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: {
                    action: 'execute_semantic',
                    summary: '已更新大屏标题',
                    plan: ['修改当前选中的标题'],
                    changes: [
                      { target: { by: 'selected' }, edit: { kind: 'set_text', text: '银行经营总览' } },
                      {
                        target: { by: 'selected' },
                        edit: {
                          kind: 'set_typography',
                          fontSize: 48,
                          emphasis: null,
                          color: null,
                          align: null,
                        },
                      },
                    ],
                  },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '并发变化后的提示不应改变编译目标',
      selectionContext: {
        selectedRefs: [{ id: 'different-node', title: '另一个对象', componentName: 'Text' }],
      },
      project,
      conversationId: 'conversation-semantic',
      taskId: 'task-semantic',
      attachments: [],
      projectContext: [],
      providerInputSnapshot: snapshot,
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    expect(result.output).toEqual({
      action: 'execute',
      summary: '已更新大屏标题',
      plan: ['修改当前选中的标题'],
      operations: [
        {
          type: 'set',
          nodeId: 'title',
          fieldId: 'data.config',
          value: { sourceType: 'static', staticData: [{ text: '银行经营总览' }] },
        },
        { type: 'set', nodeId: 'title', fieldId: 'props.fontSize', value: 48 },
      ],
    })
  })

  it('turns an unresolved semantic target into a natural user question', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'execute_semantic',
                  summary: '隐藏指定内容',
                  plan: ['找到用户所指的内容后隐藏它'],
                  changes: [{ target: { by: 'selected' }, edit: { kind: 'set_visibility', visible: false } }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '把这个隐藏起来',
      project,
      conversationId: 'conversation-semantic-question',
      taskId: 'task-semantic-question',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    expect(result.output).toMatchObject({
      action: 'ask_user',
      message: '我还不知道你指的是画面中的哪一项。',
      question: {
        id: 'semantic-target-required',
        text: '请先选中要修改的内容，或者直接告诉我它在画面上显示的标题。',
      },
    })
  })

  it('freezes the complete normalized project, conversation, preference, and attachment input', () => {
    const mutableProject = structuredClone(project)
    const turns = [{ role: 'user' as const, content: '原始需求上下文' }]
    const preferences = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        category: 'visual' as const,
        content: '使用深色主题',
        source: 'explicit' as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ]
    const snapshot = createAgentProviderInputSnapshot({
      prompt: '创建销售大屏',
      conversationTurns: turns,
      selectionContext: {
        pageId: 'page-home',
        pageLabel: '经营总览',
        selectedRefs: [{ id: 'shareholder-ranking', title: '右侧股东排行', componentName: 'Div' }],
        viewport: { width: 1440, height: 900 },
      },
      project: mutableProject,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [image],
      projectContext: [],
      userPreferences: preferences,
      images: [{ assetId: image.id, sha256: image.sha256 }],
    })
    mutableProject.name = '并发修改后的项目'
    turns[0]!.content = '并发修改后的会话'
    preferences[0]!.content = '并发修改后的偏好'

    const frozen = JSON.parse(snapshot.userText) as Record<string, unknown>
    expect(snapshot.trace).toMatchObject({
      promptBundleId: 'easy-dashboard-change-set',
      promptBundleVersion: '4.3.4',
    })
    expect(snapshot.systemPrompt).toContain('本次执行器已经注册并允许插入的权威清单')
    expect(snapshot.systemPrompt).toContain('不要因为空白项目的 document')
    expect(snapshot.systemPrompt).toContain('multipleOf=5')
    expect(snapshot.systemPrompt).toContain('kind:"table"')
    expect(snapshot.systemPrompt).toContain('kind:"table"|"combo-map"|"cluster"|"line"|"donut"')
    expect(snapshot.systemPrompt).toContain('theme?:{background?,surface?,surfaceStrong?')
    expect(snapshot.systemPrompt).toContain('chrome?:"none",rect?:{x,y,width,height},data:{')
    expect(snapshot.systemPrompt).toContain(
      'line=>xKey,rows,series:[{key,label,color}],showLegend?,showYAxis?,showAllXTicks?,horizontalGrid?,yDomain?,yTicks?,verticalGrid?,dotRadius?,animate?',
    )
    expect(snapshot.systemPrompt).toContain('donut=>rings:[{items,innerRadius?,outerRadius?}]<=2,legendItems?,animate?')
    expect(frozen).toMatchObject({
      requirement: '创建销售大屏',
      conversationTurns: [{ role: 'user', content: '原始需求上下文' }],
      selectionContext: {
        pageId: 'page-home',
        pageLabel: '经营总览',
        selectedRefs: [{ id: 'shareholder-ranking', title: '右侧股东排行', componentName: 'Div' }],
        viewport: { width: 1440, height: 900 },
      },
      project: { name: '城市态势', draftVersion: 1 },
      userPreferences: [{ category: 'visual', content: '使用深色主题' }],
      attachments: [{ id: image.id, name: 'reference.png' }],
    })
  })

  it('builds the provider request from the frozen snapshot after live inputs change', async () => {
    const snapshot = createAgentProviderInputSnapshot({
      prompt: '原始需求',
      conversationTurns: [{ role: 'user', content: '原始会话' }],
      project,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [],
      projectContext: [],
    })
    const changedProject = { ...project, name: '并发修改后的项目', draftSchema: { changed: true } } as ProjectRecord
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'ask_user',
                  message: '需要确认。',
                  question: { id: 'confirm', text: '是否继续？' },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await requestAgentChangeSet({
      runtime,
      prompt: '并发修改后的需求',
      conversationTurns: [{ role: 'user', content: '并发修改后的会话' }],
      project: changedProject,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [],
      projectContext: [],
      providerInputSnapshot: snapshot,
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const providerBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(providerBody.messages.find(message => message.role === 'system')?.content).toBe(snapshot.systemPrompt)
    expect(providerBody.messages.find(message => message.role === 'user')?.content).toBe(snapshot.userText)
    expect(providerBody.messages.find(message => message.role === 'user')?.content).not.toContain('并发修改后')
  })

  it('uses the reasoning-model Chat Completions contract for GPT-5 models', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'ask_user',
                  message: '需要确认。',
                  question: { id: 'confirm', text: '是否继续？' },
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await requestAgentChangeSet({
      runtime: { ...runtime, model: 'gpt-5.6-sol' },
      prompt: '创建大屏',
      project,
      conversationId: 'conversation-reasoning-contract',
      taskId: 'task-reasoning-contract',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const providerBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown> & {
      messages: Array<{ role: string; content: string }>
    }
    expect(providerBody).toMatchObject({
      model: 'gpt-5.6-sol',
      max_completion_tokens: 16_000,
      reasoning_effort: 'low',
    })
    expect(providerBody).not.toHaveProperty('max_tokens')
    expect(providerBody).not.toHaveProperty('temperature')
    expect(providerBody.messages[0]).toMatchObject({ role: 'developer' })
  })

  it('reports the provider finish reason when a response has no final JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      requestAgentChangeSet({
        runtime: { ...runtime, model: 'gpt-5.6-sol' },
        prompt: '创建大屏',
        project,
        conversationId: 'conversation-empty-final',
        taskId: 'task-empty-final',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_MODEL_OUTPUT_INVALID',
      message: 'Agent model returned no final JSON (finish_reason=length)',
    })
  })

  it('keeps a valid decision when optional provider usage telemetry is unusable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'ask_user',
                  message: '需要确认数据模式。',
                  question: { id: 'data-mode', text: '使用示例数据吗？' },
                }),
              },
            },
          ],
          usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '创建大屏',
      project,
      conversationId: 'conversation-usage',
      taskId: 'task-usage',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    expect(result.output).toMatchObject({ action: 'ask_user', question: { id: 'data-mode' } })
    expect(result.usage).toBeUndefined()
  })

  it('fails closed when provider output exposes implementation details to the user', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'ask_user',
                  message: '还需要确认位置。',
                  question: { id: 'position', text: '请提供 x=120、y=80 和 nodeId。' },
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      requestAgentChangeSet({
        runtime,
        prompt: '把这个模块移到右侧',
        project,
        conversationId: 'conversation-natural-language',
        taskId: 'task-natural-language',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
      }),
    ).rejects.toMatchObject({
      code: 'AGENT_MODEL_OUTPUT_INVALID',
      message: 'Agent model exposed implementation details in user-facing text',
    })
  })

  it('keeps scenario-specific bank quality gates out of the core model boundary', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'execute',
                  summary: '生成银行财报',
                  plan: ['生成标题'],
                  operations: [
                    {
                      type: 'insert',
                      parentId: 'page-root',
                      componentName: 'EasyEditorMaterialsText',
                      fields: {
                        'data.config': { sourceType: 'static', staticData: [{ text: '银行年度财报' }] },
                        'shared.rect': { x: 48, y: 48, width: 600, height: 80 },
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      requestAgentChangeSet({
        runtime,
        prompt: '创建银行2022年度可视化财报',
        project,
        conversationId: 'conversation-bank-quality',
        taskId: 'task-bank-quality',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
      }),
    ).resolves.toMatchObject({ output: { action: 'execute', summary: '生成银行财报' } })
  })

  it('allows an incremental bank refactor when a sparse tree already contains a meaningful dashboard scene', async () => {
    const existingBankProject = {
      ...project,
      draftSchema: {
        componentsTree: [
          {
            id: 'page-root',
            componentName: 'Root',
            children: [
              {
                id: 'legacy-bank-scene',
                componentName: 'DashboardScene',
                props: {
                  spec: {
                    canvas: { width: 1920, height: 1080 },
                    widgets: [{ id: 'revenue', kind: 'kpi', title: '营业总收入' }],
                  },
                },
              },
            ],
          },
        ],
      },
    } as unknown as ProjectRecord
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'execute',
                  summary: '先建立语义分区',
                  plan: ['插入页面容器，后续继续迁移内容'],
                  operations: [
                    {
                      type: 'insert',
                      parentId: 'page-root',
                      componentName: 'Div',
                      fields: {
                        'shared.title': '页面装饰层',
                        'shared.rect': { x: 0, y: 0, width: 1920, height: 1080 },
                        'props.background': '#edf2f6',
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '继续调优银行财报，先建立 Div 分区',
      project: existingBankProject,
      conversationId: 'conversation-bank-refactor',
      taskId: 'task-bank-refactor',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    expect(result.output).toMatchObject({
      action: 'execute',
      operations: [{ type: 'insert', componentName: 'Div' }],
    })
  })

  it('estimates the full bounded provider payload instead of only the latest prompt', () => {
    const largeProject = {
      ...project,
      draftSchema: { componentsTree: [{ id: 'root', componentName: 'Page', props: { text: 'x'.repeat(120_000) } }] },
    } as ProjectRecord
    const snapshot = createAgentProviderInputSnapshot({
      prompt: '短提示',
      conversationTurns: Array.from({ length: 24 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `turn-${index}-${'y'.repeat(3_900)}`,
      })),
      project: largeProject,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [],
      projectContext: [],
    })

    expect(estimateAgentProviderInputTokens(snapshot)).toBeGreaterThan(50_000)
  })

  it('summarizes a large legacy dashboard scene before sending the project document to the model', () => {
    const legacySceneProject = {
      ...project,
      draftSchema: {
        componentsTree: [
          {
            id: 'page-root',
            componentName: 'Root',
            children: [
              {
                id: 'legacy-scene',
                componentName: 'DashboardScene',
                props: {
                  spec: {
                    canvas: { width: 1920, height: 1080 },
                    header: { title: '银行2022年度可视化财报', showClock: true },
                    widgets: [
                      { id: 'kpi-1', kind: 'kpi', data: { rows: ['sensitive-detail'.repeat(600)] } },
                      { id: 'table-1', kind: 'table', data: { rows: ['merchant-detail'.repeat(600)] } },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    } as unknown as ProjectRecord

    const snapshot = createAgentProviderInputSnapshot({
      prompt: '继续调优银行财报',
      project: legacySceneProject,
      conversationId: 'conversation-scene-summary',
      taskId: 'task-scene-summary',
      attachments: [],
      projectContext: [],
    })
    const input = JSON.parse(snapshot.userText) as {
      project: { document: { componentsTree: Array<Record<string, unknown>> } }
    }
    const root = input.project.document.componentsTree[0]
    const scene = Array.isArray(root?.children)
      ? (root.children as Array<Record<string, unknown>>).find(node => node.componentName === 'DashboardScene')
      : undefined

    expect(scene).toMatchObject({
      id: 'legacy-scene',
      props: {
        spec: {
          projection: 'dashboard-scene-summary',
          widgetCount: 2,
          widgetKinds: ['kpi', 'table'],
          canvas: { width: 1920, height: 1080 },
          header: { title: '银行2022年度可视化财报', showClock: true },
        },
      },
    })
    expect(snapshot.userText).not.toContain('sensitive-detail')
    expect(snapshot.userText).not.toContain('merchant-detail')
  })

  it('keeps the original requirement and source assets in a 4,000-character clarification snapshot', () => {
    const source = createAgentProviderInputSnapshot({
      prompt: '创建销售大屏',
      project,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [image],
      projectContext: [],
      images: [{ assetId: image.id, sha256: image.sha256 }],
    })
    const response = '使用 1920x1080。'.padEnd(4_000, '补')
    const responseImage = {
      ...image,
      id: '66666666-6666-4666-8666-666666666666',
      originalName: 'answer-reference.png',
      sha256: 'b'.repeat(64),
    }
    const next = createAgentResponseProviderInputSnapshot(
      source,
      { id: 'canvas-size', text: '使用什么画布尺寸？' },
      response,
      [responseImage],
      [{ assetId: responseImage.id, sha256: responseImage.sha256 }],
    )
    const payload = JSON.parse(next.userText) as Record<string, unknown>

    expect(payload).toMatchObject({
      requirement: '创建销售大屏',
      clarification: {
        question: { id: 'canvas-size', text: '使用什么画布尺寸？' },
        response,
      },
      attachments: [{ id: image.id }, { id: responseImage.id }],
    })
    expect(next.images).toEqual([
      { assetId: image.id, sha256: image.sha256 },
      { assetId: responseImage.id, sha256: responseImage.sha256 },
    ])
    expect(estimateAgentProviderInputTokens(next)).toBeGreaterThan(estimateAgentProviderInputTokens(source))
  })

  it('keeps every bounded clarification and its new image in order', () => {
    const source = createAgentProviderInputSnapshot({
      prompt: '创建销售大屏',
      project,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [image],
      projectContext: [],
      images: [{ assetId: image.id, sha256: image.sha256 }],
    })
    const secondImage = {
      ...image,
      id: '77777777-7777-4777-8777-777777777777',
      originalName: 'second-answer.png',
      sha256: 'c'.repeat(64),
    }
    const history = [
      {
        question: { id: 'metric-focus', text: '突出哪些指标？' },
        response: '突出销售额。',
        attachmentIds: [] as string[],
      },
      {
        question: { id: 'visual-reference', text: '是否有补充参考图？' },
        response: '使用新截图。',
        attachmentIds: [secondImage.id],
      },
    ]

    const next = createAgentClarificationHistoryProviderInputSnapshot(
      source,
      history,
      [image, secondImage],
      [
        { assetId: image.id, sha256: image.sha256 },
        { assetId: secondImage.id, sha256: secondImage.sha256 },
      ],
    )
    const payload = JSON.parse(next.userText) as Record<string, unknown>

    expect(payload.clarificationHistory).toEqual(history)
    expect(payload).toMatchObject({
      clarification: {
        question: { id: 'visual-reference', text: '是否有补充参考图？' },
        response: '使用新截图。',
      },
      attachments: [{ id: image.id }, { id: secondImage.id }],
    })
    expect(next.images).toEqual([
      { assetId: image.id, sha256: image.sha256 },
      { assetId: secondImage.id, sha256: secondImage.sha256 },
    ])
  })

  it('compacts older conversation context while preserving the original requirement and recent turns', () => {
    const conversationTurns = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn-${index}-${'x'.repeat(2_000)}`,
    }))
    const snapshot = createAgentProviderInputSnapshot({
      prompt: '创建销售大屏',
      project,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [],
      projectContext: [],
      conversationTurns,
    })
    const payload = JSON.parse(snapshot.userText) as {
      requirement: string
      contextSummary?: string
      conversationTurns: Array<{ role: string; content: string }>
    }

    expect(payload.requirement).toBe('创建销售大屏')
    expect(payload.contextSummary).toContain('turn-0-')
    expect(payload.conversationTurns.at(-1)?.content).toContain('turn-29-')
    expect(payload.conversationTurns.length).toBeLessThan(conversationTurns.length)
  })

  it('freezes the explicit linked PieChart capability across clarification snapshots', () => {
    const source = createAgentProviderInputSnapshot({
      prompt: '调整环形图',
      project,
      conversationId: 'conversation-linked-pie',
      taskId: 'task-linked-pie',
      attachments: [],
      projectContext: [],
      linkedPieChartStyles: true,
    })
    const next = createAgentResponseProviderInputSnapshot(
      source,
      { id: 'pie-style', text: '需要哪种环形图？' },
      '使用多层细弧环',
      [],
      [],
    )

    for (const snapshot of [source, next]) {
      expect(snapshot.systemPrompt).toContain('material-catalog@3.10.0-linked-pie-0.0.8')
      expect(snapshot.systemPrompt).toContain('concentric-rings')
      expect(snapshot.systemPrompt).toContain('tilted-donut')
    }
  })

  it('keeps or safely replaces the frozen selection context for clarification turns', () => {
    const source = createAgentProviderInputSnapshot({
      prompt: '修改这个东西',
      selectionContext: {
        pageId: 'page-home',
        selectedRefs: [{ id: 'old-node', title: '旧选择', componentName: 'Div' }],
        viewport: { width: 1920, height: 1080 },
      },
      project,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [],
      projectContext: [],
    })
    const kept = createAgentResponseProviderInputSnapshot(
      source,
      { id: 'target', text: '你指的是哪个区域？' },
      '就改当前选中的内容',
      [],
      [],
    )
    const keptForEmptyContext = createAgentResponseProviderInputSnapshot(
      source,
      { id: 'target', text: '你指的是哪个区域？' },
      '仍然修改当前选中的内容',
      [],
      [],
      {},
    )
    const replaced = createAgentResponseProviderInputSnapshot(
      source,
      { id: 'target', text: '你指的是哪个区域？' },
      '改右侧时间',
      [],
      [],
      {
        pageId: 'page-home',
        pageLabel: '经营总览',
        selectedRefs: [{ id: 'clock', title: '右侧时间', componentName: 'DateTime' }],
        viewport: { width: 1440.4, height: 900.6 },
      },
    )

    expect(JSON.parse(kept.userText)).toMatchObject({
      selectionContext: {
        selectedRefs: [{ id: 'old-node', title: '旧选择', componentName: 'Div' }],
      },
    })
    expect(JSON.parse(keptForEmptyContext.userText)).toMatchObject({
      selectionContext: {
        selectedRefs: [{ id: 'old-node', title: '旧选择', componentName: 'Div' }],
      },
    })
    expect(JSON.parse(replaced.userText)).toMatchObject({
      selectionContext: {
        pageId: 'page-home',
        pageLabel: '经营总览',
        selectedRefs: [{ id: 'clock', title: '右侧时间', componentName: 'DateTime' }],
        viewport: { width: 1440, height: 901 },
      },
    })
  })

  it('does not send when recovery finds a prior started attempt with unknown outcome', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const prepare = vi.fn(async () => {
      throw new ApiError(
        409,
        'AGENT_PROVIDER_BILLING_INDETERMINATE',
        'Prior worker started the request before its lease was lost',
      )
    })

    await expect(
      requestAgentChangeSet({
        runtime,
        prompt: 'Create dashboard',
        project,
        conversationId: 'conversation-1',
        taskId: 'task-1',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
        providerAttemptLifecycle: { prepare, markStarted: vi.fn() },
      }),
    ).rejects.toMatchObject({ code: 'AGENT_PROVIDER_BILLING_INDETERMINATE' })
    expect(prepare).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['HTTP 500', new Response('upstream failed', { status: 500 })],
    ['invalid envelope JSON', new Response('{', { status: 200 })],
    [
      'invalid ChangeSet',
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'execute' }) } }] }), {
        status: 200,
      }),
    ],
  ])('preserves provider attempt evidence for %s responses', async (_label, response) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    const prepare = vi.fn(
      async (metadata: { requestBodyDigest: string; idempotencyMode: 'unsupported' | 'stable' }) => metadata,
    )
    const markStarted = vi.fn(async () => undefined)

    const rejection = requestAgentChangeSet({
      runtime,
      prompt: 'Create dashboard',
      project,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
      providerAttemptLifecycle: { prepare, markStarted },
    })

    await expect(rejection).rejects.toBeInstanceOf(AgentChangeSetProviderResponseError)
    await expect(rejection).rejects.toMatchObject({
      providerAttempt: { requestBodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    })
    expect(prepare).toHaveBeenCalledOnce()
    expect(markStarted).toHaveBeenCalledOnce()
  })

  it('records provider I/O duration only after the provider call starts', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
    const clock = [100, 137]

    await expect(
      requestAgentChangeSet({
        runtime,
        prompt: 'Create dashboard',
        project,
        conversationId: 'conversation-1',
        taskId: 'task-1',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
        nowMs: () => clock.shift() ?? 137,
      }),
    ).rejects.toMatchObject({ providerAttempt: { outcome: 'failed_definite', durationMs: 37 } })

    const preflightError = await requestAgentChangeSet({
      runtime,
      prompt: 'Create dashboard',
      project,
      conversationId: 'conversation-1',
      taskId: 'task-1',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
      providerRequestKey: undefined,
      idempotencyMode: 'stable',
    }).catch((error: unknown) => error)
    expect(preflightError).toBeInstanceOf(AgentChangeSetProviderError)
    expect((preflightError as AgentChangeSetProviderError).providerAttempt).not.toHaveProperty('durationMs')
  })

  it('makes one strict ask-or-execute decision from the visible conversation turns', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: 'ask_user',
                  message: '实时接口会改变数据结构和实施成本，需要先确认。',
                  question: { id: 'data-source-mode', text: '使用实时接口，还是先使用示例数据？' },
                  plan: ['确认数据模式', '生成大屏'],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const conversationTurns = [
      { role: 'user' as const, content: '创建销售大屏' },
      { role: 'assistant' as const, content: '使用实时接口，还是示例数据？' },
      { role: 'user' as const, content: '先使用示例数据' },
    ]
    const userPreferences = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        category: 'visual' as const,
        content: '优先深色高对比',
        source: 'explicit' as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ]

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '先使用示例数据',
      conversationTurns,
      project,
      conversationId: 'conversation-1',
      taskId: 'task-decision',
      attachments: [],
      projectContext: [{ title: '暂定布局', content: '可能采用三栏布局', status: 'pending' }],
      userPreferences,
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    expect(result.output).toMatchObject({
      action: 'ask_user',
      question: { id: 'data-source-mode' },
    })
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const system = body.messages.find(message => message.role === 'system')?.content ?? ''
    const user = JSON.parse(body.messages.find(message => message.role === 'user')?.content ?? '{}') as {
      conversationTurns?: unknown
      projectContext?: unknown
      userPreferences?: unknown
    }
    expect(system).toContain('明显改变结果、成本或风险')
    expect(system).toContain('不要输出分析或思维链')
    expect(user.conversationTurns).toEqual(conversationTurns)
    expect(user.projectContext).toEqual([{ title: '暂定布局', content: '可能采用三栏布局', status: 'pending' }])
    expect(user.userPreferences).toEqual([{ category: 'visual', content: '优先深色高对比' }])
    expect(system).toContain('当前用户指令 > 当前项目的已确认上下文与文档 > pending 暂定记忆 > 用户跨项目偏好')
    expect(system).toContain('pending 是该用户私有、尚未确认的暂定记忆，不能当作项目事实')
    expect(system).not.toContain('55555555-5555-4555-8555-555555555555')
  })

  it('redacts nested schema credentials from the actual outbound model body while preserving design values', async () => {
    const secrets = {
      authorization: 'opaque-header-secret',
      apiKey: 'short-api-secret',
      connectionString: 'postgresql://dashboard-user:fake-password@db.example.com/dashboard',
      credentialedUrl: 'https://dashboard-user:fake-password@example.com/private',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fakeSignature123456',
      pem: '-----BEGIN PRIVATE KEY-----\nfake-private-key-material\n-----END PRIVATE KEY-----',
      apiToken: 'sk-proj-fakeKey1234567890',
    }
    const guardedProject = {
      ...project,
      draftSchema: {
        componentsTree: [
          {
            id: 'page-root',
            componentName: 'Page',
            props: {
              headers: [
                { name: 'Authorization', value: secrets.authorization },
                { header: 'X-API-Key', headerValue: secrets.apiKey },
                { name: 'X-Request-Id', value: 'dashboard-preview-42' },
              ],
              connectionHint: secrets.connectionString,
              helpLink: secrets.credentialedUrl,
              sessionPreview: secrets.jwt,
              certificatePreview: secrets.pem,
              sampleValue: secrets.apiToken,
              title: '城市运行态势总览',
              description: 'Use bearer authentication documentation as the help-link label',
              color: '#07111f',
              accent: 'rgba(56, 189, 248, 0.65)',
              publicUrl: 'https://example.com/dashboard?theme=dark',
              version: '1.2.3',
            },
          },
        ],
      },
    } as unknown as ProjectRecord
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '更新标题',
                  operations: [{ type: 'set', nodeId: 'title', fieldId: 'props.text', value: '城市运行态势' }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await requestAgentChangeSet({
      runtime,
      prompt: '更新标题',
      project: guardedProject,
      conversationId: 'conversation-redaction',
      taskId: 'task-redaction',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const outboundBody = String(fetch.mock.calls[0]?.[1]?.body)
    for (const secret of Object.values(secrets)) expect(outboundBody).not.toContain(secret)

    const body = JSON.parse(outboundBody) as { messages: Array<{ role: string; content: string }> }
    const user = JSON.parse(body.messages.find(message => message.role === 'user')?.content ?? '{}') as {
      project: { document: { componentsTree: Array<{ props: Record<string, unknown> }> } }
    }
    const props = user.project.document.componentsTree[0]?.props
    expect(props).toMatchObject({
      headers: [
        { name: 'Authorization', value: '[redacted]' },
        { header: 'X-API-Key', headerValue: '[redacted]' },
        { name: 'X-Request-Id', value: 'dashboard-preview-42' },
      ],
      connectionHint: '[redacted]',
      helpLink: '[redacted]',
      sessionPreview: '[redacted]',
      certificatePreview: '[redacted]',
      sampleValue: '[redacted]',
      title: '城市运行态势总览',
      description: 'Use bearer authentication documentation as the help-link label',
      color: '#07111f',
      accent: 'rgba(56, 189, 248, 0.65)',
      publicUrl: 'https://example.com/dashboard?theme=dark',
      version: '1.2.3',
    })
  })

  it('redacts secrets across every untrusted outbound text channel without dropping channel metadata', async () => {
    const secrets = {
      requirement: 'sk-proj-requirementSecret1234567890',
      conversation: 'Bearer conversationSecret123',
      context: 'https://context-user:context-pass@example.com/private',
      attachment: '-----BEGIN PRIVATE KEY-----\nattachment-private-material\n-----END PRIVATE KEY-----',
      preference: 'abcdefgh1234.ijklmnop5678.qrstuvwx9012',
    }
    const textAttachment = {
      ...image,
      id: '66666666-6666-4666-8666-666666666666',
      originalName: 'dashboard-requirements.txt',
      contentType: 'text/plain',
      extractedText: secrets.attachment,
    } satisfies AgentAssetRecord
    const projectContext = [
      {
        id: '77777777-7777-4777-8777-777777777777',
        title: '视觉方向',
        content: secrets.context,
        status: 'pending' as const,
      },
    ]
    const userPreferences = [
      {
        id: '88888888-8888-4888-8888-888888888888',
        category: 'visual' as const,
        content: secrets.preference,
        source: 'explicit' as const,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ]
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '保留安全设计内容',
                  operations: [{ type: 'set', nodeId: 'title', fieldId: 'props.text', value: '城市运行态势' }],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await requestAgentChangeSet({
      runtime,
      prompt: secrets.requirement,
      conversationTurns: [
        { role: 'assistant', content: '保留三栏布局与蓝绿色配色' },
        { role: 'user', content: secrets.conversation },
      ],
      project,
      conversationId: 'conversation-all-input-redaction',
      taskId: 'task-all-input-redaction',
      attachments: [textAttachment],
      projectContext,
      userPreferences,
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const outboundBody = String(fetch.mock.calls[0]?.[1]?.body)
    for (const secret of Object.values(secrets)) expect(outboundBody).not.toContain(secret)

    const body = JSON.parse(outboundBody) as { messages: Array<{ role: string; content: string }> }
    const user = JSON.parse(body.messages.find(message => message.role === 'user')?.content ?? '{}') as {
      requirement: string
      conversationTurns: AgentConversationTurn[]
      projectContext: Array<Record<string, unknown>>
      attachments: Array<Record<string, unknown>>
      userPreferences: Array<Record<string, unknown>>
    }
    expect(user.requirement).toBe('[redacted]')
    expect(user.conversationTurns).toEqual([
      { role: 'assistant', content: '保留三栏布局与蓝绿色配色' },
      { role: 'user', content: '[redacted]' },
    ])
    expect(user.projectContext).toEqual([
      {
        id: '77777777-7777-4777-8777-777777777777',
        title: '视觉方向',
        content: '[redacted]',
        status: 'pending',
      },
    ])
    expect(user.attachments).toEqual([
      {
        id: textAttachment.id,
        name: textAttachment.originalName,
        contentType: textAttachment.contentType,
        scope: 'conversation',
        extractedText: '[redacted]',
      },
    ])
    expect(user.userPreferences).toEqual([{ category: 'visual', content: '[redacted]' }])
  })

  it('reports validation paths without echoing rejected model values', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: 'invalid',
                    operations: [
                      {
                        type: 'insert',
                        parentId: 'page-home-root',
                        componentName: 'Text',
                        opId: 'model-must-not-mint-this-secret-value',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )

    await expect(
      requestAgentChangeSet({
        runtime,
        prompt: '创建标题',
        project,
        conversationId: 'conversation-1',
        taskId: 'task-invalid',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'AGENT_MODEL_OUTPUT_INVALID',
      message: expect.stringContaining('operations.0:unrecognized_keys'),
    })
    await expect(
      requestAgentChangeSet({
        runtime,
        prompt: '创建标题',
        project,
        conversationId: 'conversation-1',
        taskId: 'task-invalid',
        attachments: [],
        projectContext: [],
        resolveHost: publicResolver,
        request: pinnedRequest(fetch),
      }),
    ).rejects.not.toThrow('model-must-not-mint-this-secret-value')
  })

  it('provides the blank-canvas material catalog and safe layout contract to the model', async () => {
    const blankProject = {
      ...project,
      draftSchema: {
        componentsTree: [{ id: 'page-home-root', componentName: 'Root', children: [] }],
      },
    } as unknown as ProjectRecord
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '创建基础经营大屏',
                  operations: [
                    {
                      type: 'insert',
                      parentId: 'page-home-root',
                      componentName: 'Text',
                      fields: {
                        'props.text': '经营分析',
                        'shared.rect': { x: 48, y: 32, width: 720, height: 64 },
                      },
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await requestAgentChangeSet({
      runtime,
      prompt: '创建经营分析大屏',
      project: blankProject,
      conversationId: '33333333-3333-4333-8333-333333333333',
      taskId: 'task-blank',
      attachments: [],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
    })

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const system = body.messages.find(message => message.role === 'system')?.content ?? ''
    const user = body.messages.find(message => message.role === 'user')?.content ?? ''
    expect(system).toContain('material-catalog@3.10.0')
    expect(system).not.toContain('concentric-rings')
    expect(system).not.toContain('tilted-donut')
    expect(system).toContain('除非用户明确询问，或尺寸会实质改变方案，否则不要主动复述画布分辨率')
    expect(system).toContain('直接删除')
    expect(system).toContain('禁止用 shared.visibility=false')
    expect(system).toContain('现有物料优先')
    expect(system).toContain('Div[insertable,structure]')
    expect(system).toContain('按可见区域建立有含义的 Div 分组')
    expect(system).toContain('EasyEditorMaterialsText')
    expect(system).toContain('EasyEditorMaterialsNumberFlip')
    expect(system).toContain('EasyEditorMaterialsGeoMap')
    expect(system).toContain('EasyEditorMaterialsScrollList')
    expect(system).toContain('EasyEditorMaterialsBarChart')
    expect(system).toContain('EasyEditorMaterialsLineChart')
    expect(system).toContain('EasyEditorMaterialsPieChart')
    expect(system).toContain('EasyEditorMaterialsProgress')
    expect(system).toContain('DateTime[insertable,display]')
    expect(system).toContain('dateTime.dateFormat<string,enum="localized"|"dot"|"dash"|"slash">')
    expect(system).toContain('dateTime.timeFormat<string,enum="localized"|"hm"|"hms">')
    expect(system).toContain('dateTime.timeZone<string,enum="local"|"Asia/Shanghai"|"UTC">')
    expect(system).toContain('data.config')
    expect(system).toContain('fieldMappings?:Array<{componentField:safePath,sourceField:safePath}>')
    expect(system).toContain('datasourceId:existing-id')
    expect(system).toContain('Always map rank, name and value')
    expect(system).toContain('shared.rect')
    expect(system).toContain('coordinateSpace=canvas-global-absolute')
    expect(system).not.toContain('一个全画布 DashboardScene')
    expect(system).toContain('禁止用 DashboardScene 承载整张大屏')
    expect(system).toContain('conversation-policy@1.1.0')
    expect(system).toContain('禁止要求用户提供或确认 x、y、width、height、nodeId')
    expect(system).toContain('当前选中对象 > 用户明确提到的标题或区域 > 最近会话中的指代')
    expect(system).toContain('semantic-editing@1.0.0')
    expect(system).toContain('"action":"execute_semantic"')
    expect(system).toContain('configure_ranking{maxItems?,emphasizeTopThree?}')
    expect(system).toContain('core-capabilities@1.0.0')
    expect(system).toContain('附件与参考理解(reference-understanding)')
    expect(system).toContain('material-composition-quality@4.1.0')
    expect(system).toContain('实时日期或时钟必须使用 DateTime')
    expect(system).toContain('交互控件必须产生可观察的状态或数据变化')
    expect(system).not.toContain('右侧股东区 x=1373,y=169,width=493,height=527')
    expect(system).not.toContain('银行2022年度可视化财报')
    expect(system).not.toContain('左侧经营分析、中部交易概况、右侧股东排行')
    expect(system).not.toContain('银行财报日期')
    expect(system).not.toContain('China bank dashboard')
    expect(system).toContain('下一轮使用投影出的真实 Div id 完成 move 归组')
    expect(system).toContain('shared.rect.x/y 始终是相对 1920×1080 画布原点的全局绝对坐标')
    expect(system).toContain('因归组执行 move 时必须保留子节点原 shared.rect')
    expect(system).not.toContain('并同时 resize 为相对容器的局部坐标')
    expect(system).toContain('只有普通物料无法表达局部效果时才使用局部 DashboardScene')
    expect(system).toContain('props.widgetData')
    expect(system).toContain('depth-limited')
    expect(system).toContain('tabViews?:Record<tabKey')
    expect(system).toContain('layers?:Array<{id?,color?,opacity?,scale?,rotation?,offsetX?,offsetY?,blur?}>')
    expect(system).toContain('props.fontSize')
    expect(system).toContain('props.fontWeight<string,enum="normal"|"bold">')
    expect(system).toContain('props.lineHeight<number,range=0.5..4,multipleOf=0.1>')
    expect(system).toContain('props.glowIntensity<number,range=0..2,multipleOf=0.1>')
    expect(system).toContain('props.scatterSymbolSize<number,range=4..30,multipleOf=1>')
    expect(system).toContain('keep scatter markers small enough that they do not cover the regions')
    expect(system).toContain('props.borderRadius<number,range=0..20,multipleOf=1>')
    expect(system).toContain('props.strokeWidth<number,range=1..10,multipleOf=1>')
    expect(system).toContain('props.innerRadius<number,range=0..100,multipleOf=5>')
    expect(system).toContain('props.strokeWidthRatio<number,range=0.02..0.2,multipleOf=0.01>')
    expect(system).toContain('globeScene.background<safe-solid-color only')
    expect(system).toContain('"fieldId":"props.fontWeight"')
    expect(system).toContain('output-example@4.1.0')
    expect(system).toContain('insert 必须始终输出 position')
    expect(system).toContain('1 至 48 项完整操作')
    expect(system).toContain('只输出首个自身完整、可渲染、可验证的阶段')
    expect(system).toContain('valueJson 必须是该字段值的合法 JSON 序列化字符串')
    expect(user).toContain('page-home-root')

    const providerSnapshot = createAgentProviderInputSnapshot({
      prompt: '创建经营分析大屏',
      project: blankProject,
      conversationId: '33333333-3333-4333-8333-333333333333',
      taskId: 'task-blank-budget',
      attachments: [],
      projectContext: [],
    })
    expect(providerSnapshot.systemPrompt.length).toBeLessThan(20_000)
    expect(estimateAgentProviderInputTokens(providerSnapshot)).toBeLessThan(14_000)
  })

  it('routes globe dashboards to GlobeScene while keeping the surrounding dashboard editable', () => {
    const globeSnapshot = createAgentProviderInputSnapshot({
      prompt: '创建全球自然资源数据可视化大屏，中央是缓慢旋转的地球、星空与蓝色大气层',
      project,
      conversationId: 'conversation-globe',
      taskId: 'task-globe',
      attachments: [],
      projectContext: [],
    })

    expect(globeSnapshot.trace.skills).toEqual(['gis-3d-design@1.1.0'])
    expect(globeSnapshot.systemPrompt).toContain('globe-and-spatial-composition@1.0.0')
    expect(globeSnapshot.systemPrompt).toContain('普通“世界地图”使用 GeoMap')
    expect(globeSnapshot.systemPrompt).toContain('优先 GlobeScene')
    expect(globeSnapshot.systemPrompt).toContain('页面装饰、头部、左侧分析区、中央地球区、右侧分析区、底部指标区')
    expect(globeSnapshot.systemPrompt).toContain('GlobeScene 仅承载中央地球舞台')
    expect(globeSnapshot.systemPrompt).toContain('真实时间使用 DateTime')
    expect(globeSnapshot.systemPrompt).toContain('只有局部特殊效果')
    expect(globeSnapshot.systemPrompt).toContain('才使用局部 DashboardScene')
    expect(globeSnapshot.systemPrompt).toContain('禁止整屏自定义')
    expect(globeSnapshot.systemPrompt).toContain('用户只需用自然语言指出区域和目标')
    expect(globeSnapshot.systemPrompt).toContain('GlobeScene[insertable,map-stage]')
    expect(globeSnapshot.systemPrompt).toContain('globeScene.autoRotate')

    const worldMapSnapshot = createAgentProviderInputSnapshot({
      prompt: '制作普通世界地图，展示各国销售额分布',
      project,
      conversationId: 'conversation-world-map',
      taskId: 'task-world-map',
      attachments: [],
      projectContext: [],
    })
    expect(worldMapSnapshot.trace.skills).toEqual([])
  })

  it('sends authorized image attachments as multimodal input without embedding storage paths in prompt text', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '按参考图更新标题',
                  operations: [{ type: 'set', nodeId: 'title', fieldId: 'props.text', value: '城市运行态势' }],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            prompt_tokens_details: { cached_tokens: 80 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'provider-request-150' } },
      ),
    )

    const result = await requestAgentChangeSet({
      runtime,
      prompt: '参考图片调整标题',
      project,
      conversationId: image.conversationId,
      taskId: 'task-1',
      attachments: [image],
      images: [{ assetId: image.id, url: 'https://storage.example.com/signed/reference.png' }],
      projectContext: [],
      resolveHost: publicResolver,
      request: pinnedRequest(fetch),
      providerRequestKey: 'task-1-model-attempt-1',
      idempotencyMode: 'stable',
      nowMs: (() => {
        const clock = [200, 224]
        return () => clock.shift() ?? 224
      })(),
    })

    expect(result.output).toMatchObject({
      action: 'execute',
      summary: '按参考图更新标题',
      plan: ['按参考图更新标题'],
    })
    expect(result.trace.skills).not.toContain('attachment-analysis@1.0.0')
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 30, totalTokens: 150, cachedTokens: 80 })
    expect(result.providerAttempt).toMatchObject({
      providerRequestKey: 'task-1-model-attempt-1',
      idempotencyMode: 'stable',
      idempotencyHeaderSent: true,
      upstreamRequestId: 'provider-request-150',
      durationMs: 24,
      requestBodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    const init = fetch.mock.calls[0]?.[1]
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
    }
    const user = body.messages.find(message => message.role === 'user')
    expect(user?.content).toEqual([
      expect.objectContaining({ type: 'text' }),
      {
        type: 'image_url',
        image_url: { url: 'https://storage.example.com/signed/reference.png', detail: 'auto' },
      },
    ])
    expect(JSON.stringify(user?.content)).not.toContain(image.storagePath)
    expect(init?.headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer server-only-key',
        'content-type': 'application/json',
        'idempotency-key': 'task-1-model-attempt-1',
      }),
    )
  })
})
