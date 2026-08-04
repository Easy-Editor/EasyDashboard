import { describe, expect, it } from 'vitest'
import { type AgentSemanticCompileError, materializeAgentDecision } from './semantic-edit-compiler.js'

const document = {
  componentsTree: [
    {
      id: 'page-root',
      componentName: 'Root',
      children: [
        { id: 'title', componentName: 'Text', extra: { title: '大屏标题' }, props: { text: '旧标题' } },
        { id: 'ranking', componentName: 'ScrollList', extra: { title: '股东排行' } },
        { id: 'clock', componentName: 'DateTime', extra: { title: '右侧时间' } },
      ],
    },
  ],
}

const semanticDecision = (changes: unknown[]) => ({
  action: 'execute_semantic',
  summary: '完成修改',
  plan: ['更新所选内容'],
  changes,
})

describe('Agent semantic edit compiler', () => {
  it('compiles selection-first text and typography intents into the existing ChangeSet protocol', () => {
    const output = materializeAgentDecision(
      semanticDecision([
        { target: { by: 'selected' }, edit: { kind: 'set_text', text: '银行经营总览' } },
        {
          target: { by: 'selected' },
          edit: { kind: 'set_typography', fontSize: 42, emphasis: 'bold', color: '#202631', align: 'center' },
        },
      ]),
      {
        document,
        selectionContext: {
          selectedRefs: [{ id: 'title', title: '大屏标题', componentName: 'Text' }],
        },
      },
    )

    expect(output).toEqual({
      action: 'execute',
      summary: '完成修改',
      plan: ['更新所选内容'],
      operations: [
        {
          type: 'set',
          nodeId: 'title',
          fieldId: 'data.config',
          value: { sourceType: 'static', staticData: [{ text: '银行经营总览' }] },
        },
        { type: 'set', nodeId: 'title', fieldId: 'props.fontSize', value: 42 },
        { type: 'set', nodeId: 'title', fieldId: 'props.fontWeight', value: 'bold' },
        { type: 'set', nodeId: 'title', fieldId: 'props.color', value: '#202631' },
        { type: 'set', nodeId: 'title', fieldId: 'props.textAlign', value: 'center' },
      ],
    })
  })

  it('maps ranking and realtime intents without exposing material field paths to the model plan', () => {
    const ranking = materializeAgentDecision(
      semanticDecision([
        {
          target: { by: 'visible_title', title: '股东排行' },
          edit: { kind: 'configure_ranking', maxItems: 8, emphasizeTopThree: true },
        },
      ]),
      { document },
    )
    expect(ranking.action).toBe('execute')
    if (ranking.action !== 'execute') throw new Error('Expected an execute decision')
    expect(ranking.operations).toEqual([
      { type: 'set', nodeId: 'ranking', fieldId: 'props.maxItems', value: 8 },
      { type: 'set', nodeId: 'ranking', fieldId: 'props.showRank', value: true },
      { type: 'set', nodeId: 'ranking', fieldId: 'props.showMedal', value: true },
    ])

    const clock = materializeAgentDecision(
      semanticDecision([
        {
          target: { by: 'selected' },
          edit: {
            kind: 'configure_datetime',
            mode: 'time',
            timeFormat: 'hms',
            hour12: false,
            timeZone: 'Asia/Shanghai',
            updateInterval: 'second',
          },
        },
      ]),
      {
        document,
        selectionContext: { selectedRefs: [{ id: 'clock', title: '右侧时间', componentName: 'DateTime' }] },
      },
    )
    expect(clock.action).toBe('execute')
    if (clock.action !== 'execute') throw new Error('Expected an execute decision')
    expect(clock.operations).toEqual([
      { type: 'set', nodeId: 'clock', fieldId: 'dateTime.mode', value: 'time' },
      { type: 'set', nodeId: 'clock', fieldId: 'dateTime.timeFormat', value: 'hms' },
      { type: 'set', nodeId: 'clock', fieldId: 'dateTime.hour12', value: false },
      { type: 'set', nodeId: 'clock', fieldId: 'dateTime.timeZone', value: 'Asia/Shanghai' },
      { type: 'set', nodeId: 'clock', fieldId: 'dateTime.updateInterval', value: 'second' },
    ])
  })

  it('keeps ask-user and legacy operations decisions compatible', () => {
    const question = {
      action: 'ask_user',
      message: '需要确认展示范围。',
      question: { id: 'ranking-range', text: '股东排行展示前 8 名，还是全部股东？' },
      plan: ['确认展示范围后更新排行'],
    } as const
    expect(materializeAgentDecision(question, { document })).toEqual(question)

    const legacy = {
      summary: '建立新的分析区域',
      operations: [{ type: 'insert', parentId: 'page-root', componentName: 'Div' }],
    } as const
    expect(materializeAgentDecision(legacy, { document })).toEqual({
      action: 'execute',
      summary: '建立新的分析区域',
      plan: ['建立新的分析区域'],
      operations: legacy.operations,
    })
  })

  it.each([
    {
      name: 'no current selection',
      decision: semanticDecision([{ target: { by: 'selected' }, edit: { kind: 'set_visibility', visible: false } }]),
      context: { document },
      questionId: 'semantic-target-required',
      questionText: '请先选中要修改的内容，或者直接告诉我它在画面上显示的标题。',
    },
    {
      name: 'multiple current selections',
      decision: semanticDecision([{ target: { by: 'selected' }, edit: { kind: 'set_visibility', visible: false } }]),
      context: {
        document,
        selectionContext: {
          selectedRefs: [
            { id: 'title', title: '大屏标题', componentName: 'Text' },
            { id: 'clock', title: '右侧时间', componentName: 'DateTime' },
          ],
        },
      },
      questionId: 'semantic-target-ambiguous',
      questionText: '这次要修改哪一个？可以直接告诉我它在画面上显示的标题。',
    },
    {
      name: 'stale current selection',
      decision: semanticDecision([{ target: { by: 'selected' }, edit: { kind: 'set_visibility', visible: false } }]),
      context: {
        document,
        selectionContext: { selectedRefs: [{ id: 'removed', title: '旧组件', componentName: 'Text' }] },
      },
      questionId: 'semantic-target-stale',
      questionText: '请重新选中要修改的内容，再告诉我需要怎么调整。',
    },
  ])('asks a natural target question for $name', ({ decision, context, questionId, questionText }) => {
    const output = materializeAgentDecision(decision, context)

    expect(output).toMatchObject({
      action: 'ask_user',
      question: { id: questionId, text: questionText },
      plan: ['更新所选内容'],
    })
    expect(JSON.stringify(output)).not.toMatch(/nodeId|fieldId|ChangeSet|\bx\b|\by\b/u)
  })

  it('asks which visible region the user means when titles are ambiguous', () => {
    const duplicateTitleDocument = structuredClone(document)
    duplicateTitleDocument.componentsTree[0]?.children.push({
      id: 'ranking-copy',
      componentName: 'ScrollList',
      extra: { title: '股东排行' },
    })
    const output = materializeAgentDecision(
      semanticDecision([
        { target: { by: 'visible_title', title: '股东排行' }, edit: { kind: 'set_visibility', visible: false } },
      ]),
      { document: duplicateTitleDocument },
    )

    expect(output).toMatchObject({
      action: 'ask_user',
      question: {
        id: 'semantic-title-ambiguous',
        text: '你想修改哪一个？可以告诉我它在画面的哪个区域。',
      },
    })
  })

  it('resolves visible titles only against effectively visible objects', () => {
    const visibilityDocument = {
      componentsTree: [
        {
          id: 'page-root',
          componentName: 'Root',
          children: [
            {
              id: 'hidden-directly',
              componentName: 'Text',
              extra: { title: '直接隐藏', condition: false },
            },
            {
              id: 'hidden-group',
              componentName: 'Div',
              extra: { condition: false },
              children: [{ id: 'hidden-by-parent', componentName: 'Text', extra: { title: '父级隐藏' } }],
            },
            { id: 'visible-ranking', componentName: 'ScrollList', extra: { title: '同名排行' } },
            {
              id: 'hidden-ranking',
              componentName: 'ScrollList',
              extra: { title: '同名排行', condition: false },
            },
          ],
        },
      ],
    }

    for (const title of ['直接隐藏', '父级隐藏']) {
      const output = materializeAgentDecision(
        semanticDecision([{ target: { by: 'visible_title', title }, edit: { kind: 'set_visibility', visible: true } }]),
        {
          document: visibilityDocument,
          selectionContext: { selectedRefs: [{ id: 'hidden-directly', title: '直接隐藏' }] },
        },
      )
      expect(output).toMatchObject({ action: 'ask_user', question: { id: 'semantic-title-not-found' } })
    }

    const visibleMatch = materializeAgentDecision(
      semanticDecision([
        { target: { by: 'visible_title', title: '同名排行' }, edit: { kind: 'configure_ranking', maxItems: 6 } },
      ]),
      { document: visibilityDocument },
    )
    expect(visibleMatch).toMatchObject({
      action: 'execute',
      operations: [{ type: 'set', nodeId: 'visible-ranking', fieldId: 'props.maxItems', value: 6 }],
    })

    const explicitlySelectedHiddenObject = materializeAgentDecision(
      semanticDecision([{ target: { by: 'selected' }, edit: { kind: 'set_visibility', visible: true } }]),
      {
        document: visibilityDocument,
        selectionContext: { selectedRefs: [{ id: 'hidden-directly', title: '直接隐藏', componentName: 'Text' }] },
      },
    )
    expect(explicitlySelectedHiddenObject).toMatchObject({
      action: 'execute',
      operations: [{ type: 'set', nodeId: 'hidden-directly', fieldId: 'shared.visibility', value: true }],
    })
  })

  it('resolves visible titles within the current page before considering other pages', () => {
    const multiPageDocument = {
      editorSchema: {
        componentsTree: [
          {
            id: 'page-a-root',
            docId: 'page-a',
            componentName: 'Root',
            children: [{ id: 'page-a-ranking', componentName: 'ScrollList', extra: { title: '股东排行' } }],
          },
          {
            id: 'page-b-root',
            docId: 'page-b',
            componentName: 'Root',
            children: [{ id: 'page-b-ranking', componentName: 'ScrollList', extra: { title: '股东排行' } }],
          },
        ],
      },
    }

    const output = materializeAgentDecision(
      semanticDecision([
        { target: { by: 'visible_title', title: '股东排行' }, edit: { kind: 'configure_ranking', maxItems: 8 } },
      ]),
      { document: multiPageDocument, selectionContext: { pageId: 'page-b' } },
    )

    expect(output).toMatchObject({
      action: 'execute',
      operations: [{ type: 'set', nodeId: 'page-b-ranking', fieldId: 'props.maxItems', value: 8 }],
    })
  })

  it('asks for a visible title when the named object cannot be found', () => {
    const output = materializeAgentDecision(
      semanticDecision([
        { target: { by: 'visible_title', title: '不存在的模块' }, edit: { kind: 'set_visibility', visible: false } },
      ]),
      { document },
    )

    expect(output).toMatchObject({
      action: 'ask_user',
      question: {
        id: 'semantic-title-not-found',
        text: '请选中要修改的内容，或者换用画面上能看到的标题来描述。',
      },
    })
  })

  it('fails atomically when a semantic intent is unsupported by the target material', () => {
    expect(() =>
      materializeAgentDecision(
        semanticDecision([
          { target: { by: 'visible_title', title: '大屏标题' }, edit: { kind: 'configure_ranking', maxItems: 8 } },
        ]),
        { document },
      ),
    ).toThrowError(expect.objectContaining<Partial<AgentSemanticCompileError>>({ code: 'INTENT_UNSUPPORTED' }))
  })

  it('rejects semantic plans that smuggle implementation fields', () => {
    expect(() =>
      materializeAgentDecision(
        semanticDecision([
          {
            target: { by: 'selected', nodeId: 'title' },
            edit: { kind: 'set_text', text: '新标题', fieldId: 'data.config' },
          },
        ]),
        { document, selectionContext: { selectedRefs: [{ id: 'title', componentName: 'Text' }] } },
      ),
    ).toThrowError(expect.objectContaining<Partial<AgentSemanticCompileError>>({ code: 'DECISION_INVALID' }))
  })
})
