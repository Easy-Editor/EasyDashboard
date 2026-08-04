import { z } from 'zod'
import {
  type AgentChangeSetModelOutput,
  type AgentExecuteDecision,
  agentChangeSetModelOutputSchema,
} from './change-set-planner.js'

const targetSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('selected') }).strict(),
  z.object({ by: z.literal('visible_title'), title: z.string().trim().min(1).max(160) }).strict(),
])

const setTextEditSchema = z
  .object({
    kind: z.literal('set_text'),
    text: z.string().max(4_000),
  })
  .strict()

const setVisibilityEditSchema = z
  .object({
    kind: z.literal('set_visibility'),
    visible: z.boolean(),
  })
  .strict()

const setTypographyEditSchema = z
  .object({
    kind: z.literal('set_typography'),
    fontSize: z.number().int().min(8).max(240).optional(),
    emphasis: z.enum(['regular', 'bold']).optional(),
    color: z.string().trim().min(1).max(160).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
  })
  .strict()
  .refine(edit => Object.keys(edit).some(key => key !== 'kind'), 'Typography edit must change at least one value')

const configureRankingEditSchema = z
  .object({
    kind: z.literal('configure_ranking'),
    maxItems: z.number().int().min(1).max(20).optional(),
    emphasizeTopThree: z.boolean().optional(),
  })
  .strict()
  .refine(edit => edit.maxItems !== undefined || edit.emphasizeTopThree !== undefined, 'Ranking edit is empty')

const configureDateTimeEditSchema = z
  .object({
    kind: z.literal('configure_datetime'),
    mode: z.enum(['date', 'time', 'datetime']).optional(),
    locale: z.enum(['zh-CN', 'en-US']).optional(),
    dateFormat: z.enum(['localized', 'dot', 'dash', 'slash']).optional(),
    timeFormat: z.enum(['localized', 'hm', 'hms']).optional(),
    hour12: z.boolean().optional(),
    timeZone: z.enum(['local', 'Asia/Shanghai', 'UTC']).optional(),
    updateInterval: z.enum(['second', 'minute']).optional(),
  })
  .strict()
  .refine(edit => Object.keys(edit).some(key => key !== 'kind'), 'DateTime edit must change at least one value')

const semanticEditSchema = z.discriminatedUnion('kind', [
  setTextEditSchema,
  setVisibilityEditSchema,
  setTypographyEditSchema,
  configureRankingEditSchema,
  configureDateTimeEditSchema,
])

const semanticDecisionSchema = z
  .object({
    action: z.literal('execute_semantic'),
    summary: z.string().trim().min(1).max(2_000),
    plan: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
    changes: z
      .array(
        z
          .object({
            target: targetSchema,
            edit: semanticEditSchema,
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict()

export type AgentSemanticCompileErrorCode =
  | 'DECISION_INVALID'
  | 'SELECTION_REQUIRED'
  | 'SELECTION_AMBIGUOUS'
  | 'SELECTION_STALE'
  | 'TITLE_NOT_FOUND'
  | 'TITLE_AMBIGUOUS'
  | 'INTENT_UNSUPPORTED'
  | 'COMPILE_CONFLICT'

export class AgentSemanticCompileError extends Error {
  override readonly name = 'AgentSemanticCompileError'

  constructor(
    public readonly code: AgentSemanticCompileErrorCode,
    message: string,
  ) {
    super(message)
  }
}

type SelectionContext = {
  pageId?: string
  selectedRefs?: readonly { id: string; title?: string; componentName?: string }[]
}

export type AgentSemanticCompileContext = {
  document: unknown
  selectionContext?: SelectionContext
}

type DashboardNode = {
  id: string
  componentName: string
  titles: string[]
  visible: boolean
  pageId?: string
}

type MaterialKind = 'text' | 'number_flip' | 'scroll_list' | 'date_time' | 'root' | 'other'
type Operation = AgentExecuteDecision['operations'][number]

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function directStrings(value: Record<string, unknown> | null, keys: readonly string[]): string[] {
  if (!value) return []
  return keys.flatMap(key => {
    const candidate = value[key]
    return typeof candidate === 'string' && candidate.trim() ? [candidate.trim()] : []
  })
}

function nodeTitles(node: Record<string, unknown>): string[] {
  const props = record(node.props)
  const extra = record(node.extra)
  const extraProps = record(node.extraProps)
  const meta = record(node.meta)
  const data = record(node.data)
  const dataConfig = record(data?.config) ?? record(node['data.config'])
  const staticData = Array.isArray(dataConfig?.staticData) ? dataConfig.staticData : []
  const firstRow = record(staticData[0])
  return [
    ...directStrings(node, ['title', 'name', 'label', 'fileDesc', 'shared.title']),
    ...directStrings(props, ['title', 'name', 'label', 'text', 'shared.title']),
    ...directStrings(extra, ['title', 'name', 'label']),
    ...directStrings(extraProps, ['title', 'name', 'label']),
    ...directStrings(meta, ['title', 'name', 'label']),
    ...directStrings(firstRow, ['text']),
  ]
}

function documentNodes(document: unknown): DashboardNode[] {
  const result: DashboardNode[] = []
  const pending: Array<{ value: unknown; inheritedVisibility: boolean; pageId?: string }> = [
    { value: document, inheritedVisibility: true },
  ]
  const visited = new Set<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    const value = current.value
    if (!value || typeof value !== 'object' || visited.has(value)) continue
    visited.add(value)
    if (Array.isArray(value)) {
      pending.push(
        ...value.map(child => ({
          value: child,
          inheritedVisibility: current.inheritedVisibility,
          ...(current.pageId ? { pageId: current.pageId } : {}),
        })),
      )
      continue
    }
    const candidate = value as Record<string, unknown>
    if (typeof candidate.id === 'string' && candidate.id.trim() && typeof candidate.componentName === 'string') {
      const visible = current.inheritedVisibility && record(candidate.extra)?.condition !== false
      const metadataPageId = directStrings(record(record(candidate.meta)?.easyDashboard), ['pageId'])[0]
      const pageId = directStrings(candidate, ['docId'])[0] ?? metadataPageId ?? current.pageId
      result.push({
        id: candidate.id.trim(),
        componentName: candidate.componentName.trim(),
        titles: nodeTitles(candidate),
        visible,
        ...(pageId ? { pageId } : {}),
      })
      pending.push({ value: candidate.children, inheritedVisibility: visible, ...(pageId ? { pageId } : {}) })
      continue
    }
    pending.push(
      ...Object.values(candidate).map(child => ({
        value: child,
        inheritedVisibility: current.inheritedVisibility,
        ...(current.pageId ? { pageId: current.pageId } : {}),
      })),
    )
  }
  return result
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\u3000「」『』“”‘’'"`]/gu, '')
}

function materialKind(componentName: string): MaterialKind {
  const normalized = componentName
    .split('@')[0]
    ?.replace(/^EasyEditorMaterials/iu, '')
    .toLowerCase()
  if (normalized === 'text') return 'text'
  if (normalized === 'numberflip') return 'number_flip'
  if (normalized === 'scrolllist') return 'scroll_list'
  if (normalized === 'datetime') return 'date_time'
  if (normalized === 'root' || normalized === 'page') return 'root'
  return 'other'
}

function uniqueNodeById(nodes: readonly DashboardNode[], id: string, missingCode: AgentSemanticCompileErrorCode) {
  const matches = nodes.filter(node => node.id === id)
  if (matches.length === 0) throw new AgentSemanticCompileError(missingCode, 'The semantic target no longer exists')
  if (matches.length > 1) throw new AgentSemanticCompileError('SELECTION_STALE', 'The semantic target id is ambiguous')
  return matches[0] as DashboardNode
}

function resolveSelectedTarget(nodes: readonly DashboardNode[], selectionContext: SelectionContext | undefined) {
  const selectedRefs = selectionContext?.selectedRefs ?? []
  if (selectedRefs.length === 0) {
    throw new AgentSemanticCompileError('SELECTION_REQUIRED', 'A current editor selection is required')
  }
  if (selectedRefs.length !== 1) {
    throw new AgentSemanticCompileError('SELECTION_AMBIGUOUS', 'The semantic edit requires exactly one selected object')
  }
  return uniqueNodeById(nodes, selectedRefs[0]?.id ?? '', 'SELECTION_STALE')
}

function titleCandidateIds(
  nodes: readonly DashboardNode[],
  selectionContext: SelectionContext | undefined,
  title: string,
  exact: boolean,
): string[] {
  const requested = normalizeTitle(title)
  const matches = (candidate: string) => {
    const normalized = normalizeTitle(candidate)
    if (!normalized) return false
    return exact ? normalized === requested : normalized.includes(requested) || requested.includes(normalized)
  }
  const ids = new Set<string>()
  const visibleIds = new Set(
    nodes
      .filter(
        candidate =>
          candidate.visible &&
          (!selectionContext?.pageId || !candidate.pageId || candidate.pageId === selectionContext.pageId),
      )
      .map(candidate => candidate.id),
  )
  for (const node of nodes) {
    if (!visibleIds.has(node.id)) continue
    if (node.titles.some(matches)) ids.add(node.id)
  }
  for (const reference of selectionContext?.selectedRefs ?? []) {
    if (visibleIds.has(reference.id) && reference.title && matches(reference.title)) ids.add(reference.id)
  }
  return [...ids]
}

function resolveTitleTarget(
  nodes: readonly DashboardNode[],
  selectionContext: SelectionContext | undefined,
  title: string,
) {
  const exact = titleCandidateIds(nodes, selectionContext, title, true)
  if (exact.length > 1) throw new AgentSemanticCompileError('TITLE_AMBIGUOUS', 'More than one object has this title')
  if (exact.length === 1) return uniqueNodeById(nodes, exact[0] as string, 'TITLE_NOT_FOUND')

  const fuzzy = titleCandidateIds(nodes, selectionContext, title, false)
  if (fuzzy.length > 1)
    throw new AgentSemanticCompileError('TITLE_AMBIGUOUS', 'More than one object matches this title')
  if (fuzzy.length === 1) return uniqueNodeById(nodes, fuzzy[0] as string, 'TITLE_NOT_FOUND')
  throw new AgentSemanticCompileError('TITLE_NOT_FOUND', 'No object matches this visible title')
}

function compileTypography(node: DashboardNode, edit: z.infer<typeof setTypographyEditSchema>): Operation[] {
  const kind = materialKind(node.componentName)
  if (!['text', 'number_flip', 'date_time'].includes(kind)) {
    throw new AgentSemanticCompileError('INTENT_UNSUPPORTED', 'This material does not support semantic typography')
  }
  if (kind === 'number_flip' && (edit.emphasis !== undefined || edit.align !== undefined)) {
    throw new AgentSemanticCompileError('INTENT_UNSUPPORTED', 'This NumberFlip typography request is unsupported')
  }
  if (kind !== 'text' && edit.fontSize !== undefined && edit.fontSize > 120) {
    throw new AgentSemanticCompileError('INTENT_UNSUPPORTED', 'This material does not support the requested font size')
  }
  const prefix = kind === 'date_time' ? 'dateTime' : 'props'
  const operations: Operation[] = []
  if (edit.fontSize !== undefined) {
    operations.push({ type: 'set', nodeId: node.id, fieldId: `${prefix}.fontSize`, value: edit.fontSize })
  }
  if (edit.emphasis !== undefined) {
    operations.push({
      type: 'set',
      nodeId: node.id,
      fieldId: `${prefix}.fontWeight`,
      value:
        kind === 'date_time' ? (edit.emphasis === 'bold' ? 700 : 400) : edit.emphasis === 'bold' ? 'bold' : 'normal',
    })
  }
  if (edit.color !== undefined) {
    operations.push({ type: 'set', nodeId: node.id, fieldId: `${prefix}.color`, value: edit.color })
  }
  if (edit.align !== undefined) {
    operations.push({ type: 'set', nodeId: node.id, fieldId: `${prefix}.textAlign`, value: edit.align })
  }
  return operations
}

function compileEdit(node: DashboardNode, edit: z.infer<typeof semanticEditSchema>): Operation[] {
  const kind = materialKind(node.componentName)
  if (edit.kind === 'set_text') {
    if (kind !== 'text') {
      throw new AgentSemanticCompileError('INTENT_UNSUPPORTED', 'Only Text materials support semantic text replacement')
    }
    return [
      {
        type: 'set',
        nodeId: node.id,
        fieldId: 'data.config',
        value: { sourceType: 'static', staticData: [{ text: edit.text }] },
      },
    ]
  }
  if (edit.kind === 'set_visibility') {
    if (kind === 'root') {
      throw new AgentSemanticCompileError('INTENT_UNSUPPORTED', 'The dashboard root visibility cannot be changed')
    }
    return [{ type: 'set', nodeId: node.id, fieldId: 'shared.visibility', value: edit.visible }]
  }
  if (edit.kind === 'set_typography') return compileTypography(node, edit)
  if (edit.kind === 'configure_ranking') {
    if (kind !== 'scroll_list') {
      throw new AgentSemanticCompileError('INTENT_UNSUPPORTED', 'Only ScrollList supports semantic ranking settings')
    }
    const operations: Operation[] = []
    if (edit.maxItems !== undefined) {
      operations.push({ type: 'set', nodeId: node.id, fieldId: 'props.maxItems', value: edit.maxItems })
    }
    if (edit.emphasizeTopThree !== undefined) {
      if (edit.emphasizeTopThree) {
        operations.push({ type: 'set', nodeId: node.id, fieldId: 'props.showRank', value: true })
      }
      operations.push({
        type: 'set',
        nodeId: node.id,
        fieldId: 'props.showMedal',
        value: edit.emphasizeTopThree,
      })
    }
    return operations
  }
  if (kind !== 'date_time') {
    throw new AgentSemanticCompileError('INTENT_UNSUPPORTED', 'Only DateTime supports realtime display settings')
  }
  const operations: Operation[] = []
  for (const field of ['mode', 'locale', 'dateFormat', 'timeFormat', 'hour12', 'timeZone', 'updateInterval'] as const) {
    const value = edit[field]
    if (value !== undefined) {
      operations.push({ type: 'set', nodeId: node.id, fieldId: `dateTime.${field}`, value })
    }
  }
  return operations
}

function operationsEqual(left: Operation, right: Operation): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function compileSemanticDecision(
  decision: z.infer<typeof semanticDecisionSchema>,
  context: AgentSemanticCompileContext,
): AgentExecuteDecision {
  const nodes = documentNodes(context.document)
  const operations: Operation[] = []
  const writes = new Map<string, Operation>()
  for (const change of decision.changes) {
    const node =
      change.target.by === 'selected'
        ? resolveSelectedTarget(nodes, context.selectionContext)
        : resolveTitleTarget(nodes, context.selectionContext, change.target.title)
    for (const operation of compileEdit(node, change.edit)) {
      const key =
        operation.type === 'set' || operation.type === 'unset' ? `${operation.nodeId}:${operation.fieldId}` : ''
      const existing = key ? writes.get(key) : undefined
      if (existing) {
        if (operationsEqual(existing, operation)) continue
        throw new AgentSemanticCompileError('COMPILE_CONFLICT', 'Semantic edits write conflicting values')
      }
      if (key) writes.set(key, operation)
      operations.push(operation)
    }
  }
  return {
    action: 'execute',
    summary: decision.summary,
    plan: decision.plan,
    operations,
  }
}

function targetClarification(
  error: AgentSemanticCompileError,
  decision: z.infer<typeof semanticDecisionSchema>,
): AgentChangeSetModelOutput | null {
  const questionByCode: Partial<Record<AgentSemanticCompileErrorCode, { id: string; message: string; text: string }>> =
    {
      SELECTION_REQUIRED: {
        id: 'semantic-target-required',
        message: '我还不知道你指的是画面中的哪一项。',
        text: '请先选中要修改的内容，或者直接告诉我它在画面上显示的标题。',
      },
      SELECTION_AMBIGUOUS: {
        id: 'semantic-target-ambiguous',
        message: '当前同时选中了多个内容。',
        text: '这次要修改哪一个？可以直接告诉我它在画面上显示的标题。',
      },
      SELECTION_STALE: {
        id: 'semantic-target-stale',
        message: '你刚才选中的内容已经发生变化。',
        text: '请重新选中要修改的内容，再告诉我需要怎么调整。',
      },
      TITLE_NOT_FOUND: {
        id: 'semantic-title-not-found',
        message: '我没有在当前画面中找到对应内容。',
        text: '请选中要修改的内容，或者换用画面上能看到的标题来描述。',
      },
      TITLE_AMBIGUOUS: {
        id: 'semantic-title-ambiguous',
        message: '当前画面中有多个标题相近的内容。',
        text: '你想修改哪一个？可以告诉我它在画面的哪个区域。',
      },
    }
  const question = questionByCode[error.code]
  if (!question) return null
  return {
    action: 'ask_user',
    message: question.message,
    question: { id: question.id, text: question.text },
    plan: decision.plan,
  }
}

/**
 * Deep seam between provider decisions and the authority-minting ChangeSet
 * planner. Semantic output is resolved and lowered atomically; legacy
 * operation output remains a compatibility path for complex composition.
 */
export function materializeAgentDecision(
  value: unknown,
  context: AgentSemanticCompileContext,
): AgentChangeSetModelOutput {
  const semanticCandidate = record(value)?.action === 'execute_semantic'
  const parsed = semanticCandidate
    ? semanticDecisionSchema.safeParse(value)
    : agentChangeSetModelOutputSchema.safeParse(value)
  if (!parsed.success) {
    const issueSummary = parsed.error.issues
      .slice(0, 8)
      .map(issue => `${issue.path.join('.') || '$'}:${issue.code}`)
      .join(', ')
    throw new AgentSemanticCompileError(
      'DECISION_INVALID',
      `Agent decision does not match the semantic contract${issueSummary ? ` (${issueSummary})` : ''}`,
    )
  }
  let output: AgentChangeSetModelOutput
  if (semanticCandidate) {
    const semanticDecision = parsed.data as z.infer<typeof semanticDecisionSchema>
    try {
      output = compileSemanticDecision(semanticDecision, context)
    } catch (error) {
      if (!(error instanceof AgentSemanticCompileError)) throw error
      const clarification = targetClarification(error, semanticDecision)
      if (!clarification) throw error
      output = clarification
    }
  } else {
    output = parsed.data as AgentChangeSetModelOutput
  }
  const validated = agentChangeSetModelOutputSchema.safeParse(output)
  if (!validated.success) {
    throw new AgentSemanticCompileError('DECISION_INVALID', 'Compiled Agent decision is invalid')
  }
  return validated.data
}

export function renderAgentSemanticEditContract(): string {
  return [
    '既有对象优先语义修改，禁止节点标识、字段路径和坐标。JSON：{"action":"execute_semantic","summary":"...","plan":["..."],"changes":[{"target":{"by":"selected"},"edit":{...}}]}。',
    'target 仅 selected（单选）或 visible_title{title}；edit 仅 set_text{text}、set_visibility{visible}、set_typography{fontSize?,emphasis?,color?,align?}、configure_ranking{maxItems?,emphasizeTopThree?}、configure_datetime{mode?,locale?,dateFormat?,timeFormat?,hour12?,timeZone?,updateInterval?}。',
    '新建、布局、图表数据、复杂交互和自定义效果改用 action=execute 与 operations，禁止混用。',
  ].join('')
}
