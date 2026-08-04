import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  MAX_AGENT_PLANNED_OPERATIONS,
  agentChangeSetDecisionSchema,
  agentChangeSetModelOutputSchema,
  planStrictChangeSet,
} from './change-set-planner.js'

describe('Agent ChangeSet decision contract', () => {
  it('accepts a user-facing clarification decision and rejects executable or reasoning fields', () => {
    const decision = {
      action: 'ask_user',
      message: '需要确认一个会影响数据结构的选择。',
      question: { id: 'data-source-mode', text: '要使用实时数据，还是先用示例数据？' },
      plan: ['确认数据模式', '生成大屏'],
    } as const

    expect(agentChangeSetDecisionSchema.parse(decision)).toEqual(decision)
    expect(
      agentChangeSetDecisionSchema.safeParse({
        ...decision,
        operations: [{ type: 'remove', nodeId: 'title' }],
      }).success,
    ).toBe(false)
    expect(agentChangeSetDecisionSchema.safeParse({ ...decision, reasoning: '隐藏的推理过程' }).success).toBe(false)
  })

  it('normalizes the legacy execute output into the strict decision union', () => {
    const operations = [{ type: 'set', nodeId: 'title', fieldId: 'props.text', value: '城市态势' }] as const

    expect(
      agentChangeSetModelOutputSchema.parse({
        summary: '更新主标题',
        operations,
      }),
    ).toEqual({
      action: 'execute',
      summary: '更新主标题',
      plan: ['更新主标题'],
      operations,
    })
    expect(
      agentChangeSetDecisionSchema.safeParse({
        action: 'execute',
        summary: '更新主标题',
        operations,
      }).success,
    ).toBe(false)
  })

  it('mints an invocation only for execute decisions', () => {
    expect(() =>
      planStrictChangeSet(
        {
          action: 'ask_user',
          message: '需要确认数据模式。',
          question: { id: 'data-source-mode', text: '使用实时数据吗？' },
        },
        'page-root',
      ),
    ).toThrow(ZodError)

    const invocation = planStrictChangeSet(
      {
        action: 'execute',
        summary: '更新主标题',
        plan: ['更新主标题'],
        operations: [{ type: 'set', nodeId: 'title', fieldId: 'props.text', value: '城市态势' }],
      },
      'page-root',
    )

    expect(invocation.arguments.operations[0]).toMatchObject({
      type: 'set',
      nodeId: 'title',
      opId: expect.stringMatching(/^op-/),
    })
  })

  it('replays identical server-owned identities byte-for-byte', () => {
    const decision = {
      action: 'execute' as const,
      summary: '更新主标题',
      plan: ['更新主标题'],
      operations: [{ type: 'set' as const, nodeId: 'title', fieldId: 'props.text', value: '城市态势' }],
    }
    const options = {
      identities: {
        sessionId: 'session-replay-1',
        stepId: 'step-replay-1',
        callId: 'call-replay-1',
        opIds: ['op-replay-1'],
      },
    }
    const first = planStrictChangeSet(decision, 'page-root', options)
    const replay = planStrictChangeSet(decision, 'page-root', options)

    expect(replay).toEqual(first)
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first))
  })

  it('allows a revised attempt to provide a distinct identity set', () => {
    const decision = {
      action: 'execute' as const,
      summary: '更新主标题',
      plan: ['更新主标题'],
      operations: [{ type: 'set' as const, nodeId: 'title', fieldId: 'props.text', value: '城市态势' }],
    }
    const first = planStrictChangeSet(decision, 'page-root', {
      identities: { sessionId: 'session-1', stepId: 'step-1', callId: 'call-1', opIds: ['op-1'] },
    })
    const revised = planStrictChangeSet(decision, 'page-root', {
      identities: { sessionId: 'session-2', stepId: 'step-2', callId: 'call-2', opIds: ['op-2'] },
    })

    expect(revised).not.toEqual(first)
  })

  it('validates supplied identities and operation-id cardinality', () => {
    const decision = {
      action: 'execute' as const,
      summary: '更新主标题',
      plan: ['更新主标题'],
      operations: [{ type: 'set' as const, nodeId: 'title', fieldId: 'props.text', value: '城市态势' }],
    }
    expect(() =>
      planStrictChangeSet(decision, 'page-root', {
        identities: { sessionId: '', stepId: 'step-1', callId: 'call-1', opIds: ['op-1'] },
      }),
    ).toThrow()
    expect(() =>
      planStrictChangeSet(decision, 'page-root', {
        identities: { sessionId: 'session-1', stepId: 'step-1', callId: 'call-1', opIds: [] },
      }),
    ).toThrow('identity count')
  })

  it.each([
    { type: 'remove', nodeId: 'page-home-root' },
    { type: 'move', nodeId: 'page-home-root', parentId: 'layout' },
    { type: 'resize', nodeId: 'page-home-root', rect: { x: 0, y: 0, width: 1280, height: 720 } },
    { type: 'reorder', nodeId: 'page-home-root', position: { place: 'last' } },
  ] as const)('rejects structural $type operations against the immutable Root', operation => {
    expect(() =>
      planStrictChangeSet(
        {
          action: 'execute',
          summary: '调整页面结构',
          plan: ['调整页面结构'],
          operations: [operation],
        },
        'page-home',
        { immutableNodeIds: ['page-home-root'] },
      ),
    ).toThrow()
  })

  it('allows setting Root fields without changing its structural identity', () => {
    const invocation = planStrictChangeSet(
      {
        action: 'execute',
        summary: '更新页面背景',
        plan: ['更新页面背景'],
        operations: [{ type: 'set', nodeId: 'page-home-root', fieldId: 'props.background', value: '#071426' }],
      },
      'page-home',
      {
        immutableNodeIds: ['page-home-root'],
        allowedOperationTypes: ['insert', 'move', 'resize', 'set', 'unset', 'reorder', 'remove'],
      },
    )

    expect(invocation.arguments.operations[0]).toMatchObject({
      type: 'set',
      nodeId: 'page-home-root',
      fieldId: 'props.background',
    })
  })

  it('allows removing a non-Root node from an existing dashboard', () => {
    const invocation = planStrictChangeSet(
      {
        action: 'execute',
        summary: '删除过时标题',
        plan: ['删除过时标题'],
        operations: [{ type: 'remove', nodeId: 'obsolete-title' }],
      },
      'page-home',
      { immutableNodeIds: ['page-home-root'] },
    )

    expect(invocation.arguments.operations[0]).toMatchObject({ type: 'remove', nodeId: 'obsolete-title' })
  })

  it('rejects visibility-only output when the frozen request explicitly requires deletion', () => {
    expect(() =>
      planStrictChangeSet(
        {
          action: 'execute',
          summary: '删除过时标题',
          plan: ['删除过时标题'],
          operations: [{ type: 'set', nodeId: 'obsolete-title', fieldId: 'shared.visibility', value: false }],
        },
        'page-home',
        { requireRemove: true },
      ),
    ).toThrow('must include a remove operation')
  })

  it('accepts a real remove when the frozen request explicitly requires deletion', () => {
    const invocation = planStrictChangeSet(
      {
        action: 'execute',
        summary: '删除过时标题',
        plan: ['删除过时标题'],
        operations: [{ type: 'remove', nodeId: 'obsolete-title' }],
      },
      'page-home',
      { requireRemove: true },
    )

    expect(invocation.arguments.operations[0]).toMatchObject({ type: 'remove', nodeId: 'obsolete-title' })
  })

  it('accepts visibility-only output when the frozen request asks only to hide', () => {
    const invocation = planStrictChangeSet(
      {
        action: 'execute',
        summary: '隐藏过时标题',
        plan: ['隐藏过时标题'],
        operations: [{ type: 'set', nodeId: 'obsolete-title', fieldId: 'shared.visibility', value: false }],
      },
      'page-home',
      { requireRemove: false },
    )

    expect(invocation.arguments.operations[0]).toMatchObject({
      type: 'set',
      nodeId: 'obsolete-title',
      fieldId: 'shared.visibility',
      value: false,
    })
  })

  it('keeps a refinement executable when the model also removes the container being edited', () => {
    const invocation = planStrictChangeSet(
      {
        action: 'execute',
        summary: '扩展左侧分析区并替换图标',
        plan: ['扩展左侧分析区', '替换用地详情图标'],
        operations: [
          { type: 'resize', nodeId: 'left-wing', rect: { x: 0, y: 138, width: 520, height: 882 } },
          { type: 'remove', nodeId: 'left-wing' },
          { type: 'resize', nodeId: 'land-use', rect: { x: 28, y: 424, width: 450, height: 212 } },
          { type: 'remove', nodeId: 'glyph-industrial' },
          {
            type: 'insert',
            parentId: 'land-use',
            componentName: 'DashboardIcon',
            fields: { 'dashboardIcon.icon': 'factory' },
          },
        ],
      },
      'page-home',
      {
        document: {
          editorSchema: {
            componentsTree: [
              {
                id: 'page-home-root',
                children: [
                  {
                    id: 'left-wing',
                    children: [{ id: 'land-use', children: [{ id: 'glyph-industrial' }] }],
                  },
                ],
              },
            ],
          },
        },
      },
    )

    expect(
      invocation.arguments.operations.map(operation => [
        operation.type,
        'nodeId' in operation ? operation.nodeId : null,
      ]),
    ).toEqual([
      ['resize', 'left-wing'],
      ['resize', 'land-use'],
      ['remove', 'glyph-industrial'],
      ['insert', null],
    ])
  })

  it('rejects an explicit delete request when every proposed remove is filtered as contradictory', () => {
    expect(() =>
      planStrictChangeSet(
        {
          action: 'execute',
          summary: '删除左侧分析区',
          plan: ['删除左侧分析区'],
          operations: [
            { type: 'remove', nodeId: 'left-wing' },
            { type: 'resize', nodeId: 'left-wing', rect: { x: 0, y: 138, width: 520, height: 882 } },
          ],
        },
        'page-home',
        {
          requireRemove: true,
          document: {
            componentsTree: [{ id: 'page-home-root', children: [{ id: 'left-wing', children: [] }] }],
          },
        },
      ),
    ).toThrow('must include a remove operation')
  })

  it('deduplicates nested removals that would otherwise reference an already removed child', () => {
    const invocation = planStrictChangeSet(
      {
        action: 'execute',
        summary: '删除废弃分组',
        plan: ['删除废弃分组'],
        operations: [
          { type: 'remove', nodeId: 'obsolete-group' },
          { type: 'remove', nodeId: 'obsolete-child' },
        ],
      },
      'page-home',
      {
        document: {
          componentsTree: [
            {
              id: 'page-home-root',
              children: [{ id: 'obsolete-group', children: [{ id: 'obsolete-child' }] }],
            },
          ],
        },
      },
    )

    expect(invocation.arguments.operations).toHaveLength(1)
    expect(invocation.arguments.operations[0]).toMatchObject({ type: 'remove', nodeId: 'obsolete-group' })
  })

  it('rejects non-creation operations when the frozen turn allows only insert and set', () => {
    expect(() =>
      planStrictChangeSet(
        {
          action: 'execute',
          summary: '删除空白画布中的旧节点',
          plan: ['清理旧节点'],
          operations: [{ type: 'remove', nodeId: 'obsolete-title' }],
        },
        'page-home',
        {
          immutableNodeIds: ['page-home-root'],
          allowedOperationTypes: ['insert', 'set'],
        },
      ),
    ).toThrow()
  })

  it('keeps one model decision to a bounded complete stage', () => {
    const operation = { type: 'remove', nodeId: 'obsolete-node' } as const
    const decision = {
      action: 'execute',
      summary: '清理当前阶段',
      plan: ['完成一个可验证阶段'],
    } as const

    expect(
      agentChangeSetDecisionSchema.safeParse({
        ...decision,
        operations: Array.from({ length: MAX_AGENT_PLANNED_OPERATIONS }, () => operation),
      }).success,
    ).toBe(true)
    expect(
      agentChangeSetDecisionSchema.safeParse({
        ...decision,
        operations: Array.from({ length: MAX_AGENT_PLANNED_OPERATIONS + 1 }, () => operation),
      }).success,
    ).toBe(false)
  })
})
