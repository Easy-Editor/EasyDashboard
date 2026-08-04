import type { AgentProjectContextProvenance } from './types'

const OPERATION_ID_PATTERN = /\boperation[-_: ]*[a-z0-9-]{8,}\b/giu
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu
const BILLING_METADATA_PATTERN = /(?:receipt|billing|cost|计费|模型费用|调用费用|费用)\s*[:：]?\s*[^，。；;]*/giu
const TOKEN_AMOUNT_PATTERN = /\b\d+(?:\.\d+)?\s*(?:usd|tokens?)\b/giu
const SPEAKER_PREFIX_PATTERN = /^(?:用户|user|agent|assistant|system)\s*[:：]\s*/iu

type MemorySectionDefinition = {
  title: string
  sources: readonly ('goal' | 'summary')[]
  pattern?: RegExp
}

const SECTION_DEFINITIONS = [
  { title: '目标', sources: ['goal'] as const },
  {
    title: '业务 / 领域',
    sources: ['goal', 'summary'] as const,
    pattern: /业务|经营|销售|运营|客户|用户|场景|行业|领域/u,
  },
  { title: '视觉', sources: ['goal', 'summary'] as const, pattern: /视觉|风格|主题|色|布局|画布|分辨率|字号|间距/u },
  { title: '数据', sources: ['goal', 'summary'] as const, pattern: /数据|指标|趋势|排行|图表|接口|字段|维度|统计/u },
  { title: '决策', sources: ['summary'] as const },
  { title: '禁止项', sources: ['goal'] as const, pattern: /不要|禁止|不得|避免|不允许|不能|仅/u },
  { title: '验收标准', sources: ['goal', 'summary'] as const, pattern: /验收|验证|校验|确保|必须|完成|通过|达到/u },
] as const satisfies readonly MemorySectionDefinition[]

export type ProjectMemoryProposalInput = {
  sourceTaskId: string
  userGoal: string
  agentSummary: string
  summaryKind?: 'plan' | 'result'
}

export type ProjectMemoryProposal = {
  title: string
  content: string
  sourceTaskId: string
  provenance: AgentProjectContextProvenance
}

function conciseProjectFact(value: string, maxLength: number): string {
  const firstLine = value.trim().split(/\r?\n/u)[0] ?? ''
  return firstLine
    .replace(SPEAKER_PREFIX_PATTERN, '')
    .replace(OPERATION_ID_PATTERN, '')
    .replace(UUID_PATTERN, '')
    .replace(BILLING_METADATA_PATTERN, '')
    .replace(TOKEN_AMOUNT_PATTERN, '')
    .replace(/[，,]\s*[。；;,.]/gu, '。')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([，。；！？,.!?])/gu, '$1')
    .replace(/[，,；;:\s]+$/gu, '')
    .trim()
    .slice(0, maxLength)
}

function matchingStatement(value: string, pattern?: RegExp): string | null {
  if (!pattern) return value
  const clauses = value.split(/[，,。；;！？!?]/u).map(clause => clause.trim())
  return clauses.find(clause => pattern.test(clause)) ?? null
}

function buildStructuredContent(goal: string, summary: string, summaryKind: 'plan' | 'result'): string {
  return SECTION_DEFINITIONS.map(section => {
    const statements: string[] = []
    const definition: MemorySectionDefinition = section
    if (definition.sources.includes('goal')) {
      const statement = matchingStatement(goal, definition.pattern)
      if (statement) statements.push(`- [事实] ${statement}`)
    }
    if (definition.sources.includes('summary')) {
      const statement = matchingStatement(summary, definition.pattern)
      if (statement) statements.push(`- [${summaryKind === 'result' ? '事实' : '推断'}] ${statement}`)
    }
    return `## ${section.title}\n${statements.length > 0 ? statements.join('\n') : '- 待确认'}`
  }).join('\n\n')
}

export function buildProjectMemoryProposal(input: ProjectMemoryProposalInput): ProjectMemoryProposal | null {
  const sourceTaskId = input.sourceTaskId.trim()
  const goal = conciseProjectFact(input.userGoal, 320)
  const summary = conciseProjectFact(input.agentSummary, 480)
  if (!sourceTaskId || !goal || !summary) return null

  const summaryKind = input.summaryKind ?? 'plan'
  return {
    title: '本轮需求摘要',
    content: buildStructuredContent(goal, summary, summaryKind),
    sourceTaskId,
    provenance: {
      origin: 'agent_task',
      sourceKinds: ['user_request', summaryKind === 'result' ? 'agent_result' : 'agent_plan'],
    },
  }
}

export function buildProjectContextSummary(userGoal: string, agentSummary: string): string | null {
  const proposal = buildProjectMemoryProposal({
    sourceTaskId: 'legacy-unlinked-task',
    userGoal,
    agentSummary,
  })
  return proposal?.content ?? null
}
