import { describe, expect, it } from 'vitest'
import { buildProjectContextSummary, buildProjectMemoryProposal } from './context'

describe('project memory proposal', () => {
  it('builds concise structured memory with fact and inference labels plus private-safe provenance', () => {
    const proposal = buildProjectMemoryProposal({
      sourceTaskId: 'task-sales-dashboard',
      userGoal: '创建销售经营驾驶舱，使用深色科技风，不要使用浅色背景。\n用户：这是另一条私聊原文',
      agentSummary: '规划销售指标、区域排行和最近六个月趋势。\nAgent：这是另一条私聊原文',
    })

    expect(proposal).toEqual({
      title: '本轮需求摘要',
      sourceTaskId: 'task-sales-dashboard',
      provenance: { origin: 'agent_task', sourceKinds: ['user_request', 'agent_plan'] },
      content: expect.any(String),
    })
    expect(proposal?.content).toContain('## 目标\n- [事实] 创建销售经营驾驶舱，使用深色科技风，不要使用浅色背景。')
    expect(proposal?.content).toContain('## 业务 / 领域\n- [事实] 创建销售经营驾驶舱')
    expect(proposal?.content).toContain('## 视觉\n- [事实] 使用深色科技风')
    expect(proposal?.content).toContain('## 数据\n- [推断] 规划销售指标、区域排行和最近六个月趋势')
    expect(proposal?.content).toContain('## 决策\n- [推断] 规划销售指标、区域排行和最近六个月趋势。')
    expect(proposal?.content).toContain('## 禁止项\n- [事实] 不要使用浅色背景')
    expect(proposal?.content).toContain('## 验收标准\n- 待确认')
    expect(JSON.stringify(proposal?.provenance)).not.toMatch(/销售|私聊|深色/u)
  })

  it('marks a completed Agent result as fact and removes execution or billing metadata', () => {
    const proposal = buildProjectMemoryProposal({
      sourceTaskId: 'task-complete',
      userGoal: '完善销售驾驶舱',
      agentSummary:
        '已完成指标卡和趋势图，operation-54c21621-bf23-4867-bbc4-1a48fc33e626 已提交；费用 0.2638 USD；Receipt 已记录。',
      summaryKind: 'result',
    })

    expect(proposal?.content).toContain('## 决策\n- [事实] 已完成指标卡和趋势图')
    expect(proposal?.provenance.sourceKinds).toEqual(['user_request', 'agent_result'])
    expect(proposal?.content).not.toMatch(/operation|54c21621|USD|费用|Receipt/iu)
  })

  it('keeps the legacy content helper structured and rejects incomplete proposals', () => {
    expect(buildProjectContextSummary('完善销售驾驶舱', '完成指标卡布局')).toContain('## 目标')
    expect(buildProjectContextSummary('完善销售驾驶舱', '')).toBeNull()
    expect(buildProjectContextSummary('', '完成指标卡布局')).toBeNull()
    expect(
      buildProjectMemoryProposal({ sourceTaskId: '', userGoal: '完善销售驾驶舱', agentSummary: '完成指标卡布局' }),
    ).toBeNull()
  })
})
