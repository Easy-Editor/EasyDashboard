export type DashboardEvaluationCase = {
  id: string
  category: string
  prompt: string
  expected: {
    requiredCapabilities: string[]
    requiredKeywords: string[]
    forbiddenKeywords: string[]
    minOperationCount: number
    qualityProfile?: 'autonomous-dashboard-v1'
  }
}

export type RecordedAgentResult = {
  caseId: string
  response: {
    text: string
    capabilities: string[]
    operations: unknown[]
  }
  delivery?: {
    taskStatus: string
    eventTypes: string[]
    semanticRevisions: number
    preview: {
      renderReady: boolean
      browserErrorCount: number
      resourceErrorCount: number
      materialGapCount: number
      layoutStatus: 'passed' | 'failed' | null
    }
  }
  document?: unknown
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

type EvaluationNode = { componentName: string; rect: { x: number; y: number; width: number; height: number } | null }

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function finiteRect(value: unknown): EvaluationNode['rect'] {
  const candidate = record(value)
  const x = candidate?.x
  const y = candidate?.y
  const width = candidate?.width
  const height = candidate?.height
  return typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y) &&
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
    ? { x, y, width, height }
    : null
}

function documentQuality(document: unknown) {
  const nodes: EvaluationNode[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const node = record(value)
    if (!node) return
    if (typeof node.componentName === 'string') {
      const dashboard = record(node.$dashboard)
      nodes.push({ componentName: node.componentName, rect: finiteRect(dashboard?.rect ?? node.rect) })
      if (Array.isArray(node.children)) node.children.forEach(visit)
      return
    }
    if (Array.isArray(node.componentsTree)) node.componentsTree.forEach(visit)
  }
  visit(document)
  const root = nodes.find(node => node.componentName === 'Root' && node.rect)
  const renderable = nodes.filter(node => node.componentName !== 'Root' && node.rect)
  const canvas = root?.rect
  const leftOccupancy = Boolean(
    canvas && renderable.some(node => node.rect!.x + node.rect!.width / 2 < canvas.width * 0.4),
  )
  const rightOccupancy = Boolean(
    canvas && renderable.some(node => node.rect!.x + node.rect!.width / 2 > canvas.width * 0.6),
  )
  const fullscreenFallbackCount = canvas
    ? renderable.filter(
        node =>
          node.componentName === 'DashboardScene' &&
          node.rect!.width * node.rect!.height >= canvas.width * canvas.height * 0.5,
      ).length
    : 0
  return { renderableNodeCount: renderable.length, leftOccupancy, rightOccupancy, fullscreenFallbackCount }
}

function autonomousDeliveryCriteria(result: RecordedAgentResult): EvaluationCriterion[] {
  const delivery = result.delivery
  const eventTypes = new Set(delivery?.eventTypes ?? [])
  const preview = delivery?.preview
  const quality = documentQuality(result.document)
  const requiredEvents = ['plan_created', 'change_committed', 'preview_checked', 'task_completed']
  return [
    {
      id: 'delivery:task-completed',
      passed: delivery?.taskStatus === 'completed',
      detail: delivery?.taskStatus ?? 'missing',
    },
    ...requiredEvents.map(eventType => ({
      id: `delivery:event:${eventType}`,
      passed: eventTypes.has(eventType),
      detail: eventTypes.has(eventType) ? 'present' : 'missing',
    })),
    {
      id: 'delivery:bounded-revisions',
      passed: typeof delivery?.semanticRevisions === 'number' && delivery.semanticRevisions <= 2,
      detail: delivery ? `${delivery.semanticRevisions}/2` : 'missing',
    },
    {
      id: 'delivery:clean-preview',
      passed:
        preview?.renderReady === true &&
        preview.browserErrorCount === 0 &&
        preview.resourceErrorCount === 0 &&
        preview.materialGapCount === 0 &&
        preview.layoutStatus === 'passed',
      detail: preview ? JSON.stringify(preview) : 'missing',
    },
    {
      id: 'document:renderable-material-count',
      passed: quality.renderableNodeCount >= 4,
      detail: `${quality.renderableNodeCount}/4`,
    },
    {
      id: 'document:left-right-occupancy',
      passed: quality.leftOccupancy && quality.rightOccupancy,
      detail: `left=${quality.leftOccupancy};right=${quality.rightOccupancy}`,
    },
    {
      id: 'document:no-fullscreen-fallback',
      passed: quality.fullscreenFallbackCount === 0,
      detail: String(quality.fullscreenFallbackCount),
    },
  ]
}

export const dashboardDeterministicScorer: DeterministicScorer = {
  id: 'easy-dashboard-contract-scorer',
  version: '2.0.0',
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
      ...(testCase.expected.qualityProfile === 'autonomous-dashboard-v1' ? autonomousDeliveryCriteria(result) : []),
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
