import { describe, expect, it } from 'vitest'
import {
  assertAgentDecisionUserTextSafe,
  isAgentConversationImplementationDetailText,
  renderAgentConversationPolicy,
} from './conversation-policy.js'

describe('Agent conversation policy', () => {
  it('requires questions to use visible product language instead of implementation protocol fields', () => {
    const policy = renderAgentConversationPolicy()

    expect(policy).toContain('可见内容')
    expect(policy).toContain('业务口径')
    expect(policy).toContain('数据范围')
    expect(policy).toContain('授权或高风险选择')
    expect(policy).toContain('禁止要求用户提供')
    expect(policy).toContain('nodeId')
    expect(policy).toContain('ChangeSet')
  })

  it.each([
    '请告诉我 nodeId',
    '需要把 fieldId 改成 props.text 吗？',
    'componentName 应该用什么？',
    '请返回一段 JSON',
    '目标位置 x=120, y=48',
    '请告诉我 x 和 y 多少',
    '请确认 width=320 和 height=180',
    '我会生成 ChangeSet',
  ])('rejects technical user-facing text: %s', text => {
    expect(() =>
      assertAgentDecisionUserTextSafe({
        action: 'ask_user',
        message: '还需要确认一项信息。',
        question: { id: 'target', text },
      }),
    ).toThrow(/implementation details/iu)
  })

  it('allows questions about visible targets, business meaning, data scope, and authorization', () => {
    expect(() =>
      assertAgentDecisionUserTextSafe({
        action: 'ask_user',
        message: '需要确认右侧排行的展示范围。',
        question: { id: 'shareholder-range', text: '右侧股东排行展示前 8 名，还是全部股东？' },
        plan: ['确认展示范围后更新右侧股东排行'],
      }),
    ).not.toThrow()
  })

  it('applies the same fail-closed boundary to summaries and plans', () => {
    expect(() =>
      assertAgentDecisionUserTextSafe({
        action: 'execute',
        summary: '已修改 props.text',
        plan: ['下一步确认 componentName'],
      }),
    ).toThrow(/implementation details/iu)
  })

  it.each([
    '{"target":"visible-title"}',
    "{'target':'visible-title'}",
    'payload={"safe":"value"}',
    '{"x":120,"y":48,"width":320,"height":180}',
    '目标区域的 "width": 320',
    'fieldPath=props.text',
  ])('classifies raw JSON and numeric protocol text as implementation detail: %s', text => {
    expect(isAgentConversationImplementationDetailText(text)).toBe(true)
  })

  it.each(['更新右侧股东排行', '画布宽度需要跟随窗口自适应', '把标题移动到页面上方'])(
    'does not classify visible product language as implementation detail: %s',
    text => {
      expect(isAgentConversationImplementationDetailText(text)).toBe(false)
    },
  )

  it('does not mistake a visible English business title for the internal operations protocol', () => {
    expect(() =>
      assertAgentDecisionUserTextSafe({
        action: 'execute',
        summary: '英文副标题已更新为 BANK OPERATIONS ANALYSIS',
        plan: ['预览并确认 BANK OPERATIONS ANALYSIS 显示完整'],
      }),
    ).not.toThrow()
  })
})
