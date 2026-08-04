export type DashboardEvaluationCase = {
  id: string
  category: string
  prompt: string
  expected: {
    requiredCapabilities: string[]
    requiredKeywords: string[]
    forbiddenKeywords: string[]
    minOperationCount: number
  }
}

export type RecordedAgentResult = {
  caseId: string
  response: {
    text: string
    capabilities: string[]
    operations: unknown[]
  }
}

export type EvaluationCriterion = {
  id: string
  passed: boolean
  detail: string
}

export type EvaluationCaseScore = {
  caseId: string
  score: number
  passed: boolean
  criteria: EvaluationCriterion[]
}

export type DeterministicScorer = {
  id: string
  version: string
  score(testCase: DashboardEvaluationCase, result: RecordedAgentResult): EvaluationCaseScore
}

export type EvaluationRunSummary = {
  scorer: { id: string; version: string }
  totalCases: number
  recordedCases: number
  aggregateScore: number
  passedCases: number
  cases: EvaluationCaseScore[]
}

export type EvaluationComparison = {
  candidate: EvaluationRunSummary
  baseline?: EvaluationRunSummary
  aggregateDelta?: number
  caseDeltas?: Array<{ caseId: string; delta: number }>
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export const dashboardDeterministicScorer: DeterministicScorer = {
  id: 'easy-dashboard-contract-scorer',
  version: '1.0.0',
  score(testCase, result) {
    if (result.caseId !== testCase.id) throw new Error(`Recorded result case mismatch: ${result.caseId}`)

    const normalizedText = result.response.text.toLocaleLowerCase('zh-CN')
    const capabilitySet = new Set(result.response.capabilities)
    const criteria: EvaluationCriterion[] = [
      ...testCase.expected.requiredCapabilities.map(capability => ({
        id: `capability:${capability}`,
        passed: capabilitySet.has(capability),
        detail: capabilitySet.has(capability) ? 'present' : 'missing',
      })),
      ...testCase.expected.requiredKeywords.map(keyword => ({
        id: `required-keyword:${keyword}`,
        passed: normalizedText.includes(keyword.toLocaleLowerCase('zh-CN')),
        detail: normalizedText.includes(keyword.toLocaleLowerCase('zh-CN')) ? 'present' : 'missing',
      })),
      ...testCase.expected.forbiddenKeywords.map(keyword => ({
        id: `forbidden-keyword:${keyword}`,
        passed: !normalizedText.includes(keyword.toLocaleLowerCase('zh-CN')),
        detail: normalizedText.includes(keyword.toLocaleLowerCase('zh-CN')) ? 'present' : 'absent',
      })),
      {
        id: 'minimum-operation-count',
        passed: result.response.operations.length >= testCase.expected.minOperationCount,
        detail: `${result.response.operations.length}/${testCase.expected.minOperationCount}`,
      },
    ]
    const passedCriteria = criteria.filter(criterion => criterion.passed).length
    const score = criteria.length === 0 ? 1 : rounded(passedCriteria / criteria.length)
    return { caseId: testCase.id, score, passed: criteria.every(criterion => criterion.passed), criteria }
  },
}

export function runRecordedEvaluation(
  cases: readonly DashboardEvaluationCase[],
  recordings: readonly RecordedAgentResult[],
  scorer: DeterministicScorer = dashboardDeterministicScorer,
): EvaluationRunSummary {
  const byCaseId = new Map(recordings.map(recording => [recording.caseId, recording]))
  if (byCaseId.size !== recordings.length) throw new Error('Recorded result case IDs must be unique')

  const scores = cases.map(testCase => {
    const recording = byCaseId.get(testCase.id)
    if (!recording) {
      return {
        caseId: testCase.id,
        score: 0,
        passed: false,
        criteria: [{ id: 'recording', passed: false, detail: 'missing' }],
      }
    }
    return scorer.score(testCase, recording)
  })
  const aggregateScore =
    scores.length === 0 ? 0 : rounded(scores.reduce((sum, item) => sum + item.score, 0) / scores.length)
  return {
    scorer: { id: scorer.id, version: scorer.version },
    totalCases: cases.length,
    recordedCases: cases.filter(testCase => byCaseId.has(testCase.id)).length,
    aggregateScore,
    passedCases: scores.filter(item => item.passed).length,
    cases: scores,
  }
}

export function compareRecordedEvaluations(
  cases: readonly DashboardEvaluationCase[],
  candidate: readonly RecordedAgentResult[],
  baseline?: readonly RecordedAgentResult[],
  scorer: DeterministicScorer = dashboardDeterministicScorer,
): EvaluationComparison {
  const candidateSummary = runRecordedEvaluation(cases, candidate, scorer)
  if (!baseline) return { candidate: candidateSummary }

  const baselineSummary = runRecordedEvaluation(cases, baseline, scorer)
  const baselineByCaseId = new Map(baselineSummary.cases.map(item => [item.caseId, item]))
  return {
    candidate: candidateSummary,
    baseline: baselineSummary,
    aggregateDelta: rounded(candidateSummary.aggregateScore - baselineSummary.aggregateScore),
    caseDeltas: candidateSummary.cases.map(item => ({
      caseId: item.caseId,
      delta: rounded(item.score - (baselineByCaseId.get(item.caseId)?.score ?? 0)),
    })),
  }
}
