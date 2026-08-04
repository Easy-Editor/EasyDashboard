import { describe, expect, it } from 'vitest'
import {
  type DashboardEvaluationCase,
  type RecordedAgentResult,
  compareRecordedEvaluations,
  dashboardDeterministicScorer,
  runRecordedEvaluation,
} from './evaluation.js'

const testCase: DashboardEvaluationCase = {
  id: 'case-1',
  category: 'sales',
  prompt: '创建销售驾驶舱',
  expected: {
    requiredCapabilities: ['screen.applyChangeSet'],
    requiredKeywords: ['销售', '候选'],
    forbiddenKeywords: ['已发布'],
    minOperationCount: 2,
  },
}

function recording(text: string, operationCount: number): RecordedAgentResult {
  return {
    caseId: testCase.id,
    response: {
      text,
      capabilities: ['screen.applyChangeSet'],
      operations: Array.from({ length: operationCount }, (_, index) => ({ opId: `op-${index}` })),
    },
  }
}

describe('offline dashboard evaluation', () => {
  it('scores recorded output deterministically without a model call', () => {
    const result = recording('已生成销售大屏候选变更。', 2)
    expect(dashboardDeterministicScorer.score(testCase, result)).toEqual(
      dashboardDeterministicScorer.score(testCase, result),
    )
    expect(runRecordedEvaluation([testCase], [result])).toMatchObject({
      totalCases: 1,
      recordedCases: 1,
      aggregateScore: 1,
      passedCases: 1,
    })
  })

  it('reports missing recordings and exact candidate-to-baseline deltas', () => {
    const missing = runRecordedEvaluation([testCase], [])
    const comparison = compareRecordedEvaluations([testCase], [recording('销售候选变更', 2)], [recording('销售', 0)])

    expect(missing).toMatchObject({ recordedCases: 0, aggregateScore: 0, passedCases: 0 })
    expect(comparison).toMatchObject({
      candidate: { aggregateScore: 1 },
      baseline: { aggregateScore: 0.6 },
      aggregateDelta: 0.4,
      caseDeltas: [{ caseId: 'case-1', delta: 0.4 }],
    })
  })

  it('rejects duplicate and mismatched recording identities', () => {
    const result = recording('销售候选变更', 2)
    expect(() => runRecordedEvaluation([testCase], [result, result])).toThrow('must be unique')
    expect(() => dashboardDeterministicScorer.score(testCase, { ...result, caseId: 'other' })).toThrow('case mismatch')
  })

  it('fails autonomous delivery recordings that only contain plausible text and operation counts', () => {
    const autonomousCase: DashboardEvaluationCase = {
      ...testCase,
      expected: { ...testCase.expected, qualityProfile: 'autonomous-dashboard-v1' },
    }
    const superficial = dashboardDeterministicScorer.score(autonomousCase, recording('销售候选变更', 2))
    expect(superficial.passed).toBe(false)
    expect(superficial.criteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'delivery:task-completed', passed: false }),
        expect.objectContaining({ id: 'delivery:clean-preview', passed: false }),
        expect.objectContaining({ id: 'document:left-right-occupancy', passed: false }),
      ]),
    )

    const complete: RecordedAgentResult = {
      ...recording('销售候选变更', 2),
      delivery: {
        taskStatus: 'completed',
        eventTypes: ['plan_created', 'change_committed', 'preview_checked', 'task_completed'],
        semanticRevisions: 1,
        preview: {
          renderReady: true,
          browserErrorCount: 0,
          resourceErrorCount: 0,
          materialGapCount: 0,
          layoutStatus: 'passed',
        },
      },
      document: {
        componentsTree: [
          {
            componentName: 'Root',
            $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
            children: [
              { componentName: 'Div', $dashboard: { rect: { x: 20, y: 100, width: 400, height: 800 } } },
              { componentName: 'Text', $dashboard: { rect: { x: 80, y: 140, width: 300, height: 80 } } },
              { componentName: 'GeoMap', $dashboard: { rect: { x: 650, y: 180, width: 620, height: 620 } } },
              { componentName: 'Div', $dashboard: { rect: { x: 1500, y: 100, width: 400, height: 800 } } },
            ],
          },
        ],
      },
    }
    expect(dashboardDeterministicScorer.score(autonomousCase, complete)).toMatchObject({ passed: true, score: 1 })
  })
})
