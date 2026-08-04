const IMPLEMENTATION_DETAIL_PATTERNS: readonly RegExp[] = [
  /\b(?:node\s*id|field\s*(?:id|path)|component\s*name|parent\s*id|change\s*set|operations?|coordinates?|rect|JSON)\b/iu,
  /\bprops(?:\.|\b)/iu,
  /(?:^|[^\p{L}\p{N}_])["']?(?:x|y|width|height)["']?\s*[:=]\s*-?(?:\d+(?:\.\d+)?|\.\d+)/iu,
  /(?:x|y)\s*(?:坐标|位置|是多少|多少|值)/iu,
  /shared\.rect/iu,
  /[\[{]\s*["'][^"']+["']\s*:/u,
]

export class UnsafeAgentUserFacingTextError extends Error {
  constructor() {
    super('Agent user-facing text contains implementation details')
    this.name = 'UnsafeAgentUserFacingTextError'
  }
}

export function renderAgentConversationPolicy(): string {
  return [
    '用户只用自然语言描述内容，协议和坐标由 Agent 内部处理。',
    '目标按“当前选中对象 > 用户明确提到的标题或区域 > 最近会话中的指代”解析；仅在多个候选会明显改变结果时提问。',
    '仅当缺失信息会改变业务结果、数据范围、授权、成本或高风险操作时提问；否则按当前画面和安全默认值执行。',
    '问题只谈用户可见内容、业务口径、数据范围、目标区域和授权或高风险选择，不让用户定位内部节点。',
    '禁止要求用户提供或确认 x、y、width、height、nodeId、fieldId、componentName、parentId、props、shared.rect、ChangeSet、JSON 等实现细节；这些字段只允许出现在内部 operations 中。',
    'summary、message、question.text 和 plan 只说明可见结果或下一步，不展示协议、坐标、内部标识或原始 JSON。',
  ].join('')
}

export function isAgentConversationImplementationDetailText(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return false
  if (IMPLEMENTATION_DETAIL_PATTERNS.some(pattern => pattern.test(text))) return true
  if (/(?:^|[=:]\s*)\[[^\]]*\]/u.test(text)) return true
  if (!((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) return false
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

function assertTextSafe(value: unknown): void {
  if (isAgentConversationImplementationDetailText(value)) {
    throw new UnsafeAgentUserFacingTextError()
  }
}

export function assertAgentDecisionUserTextSafe(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const decision = value as Record<string, unknown>
  assertTextSafe(decision.summary)
  assertTextSafe(decision.message)
  if (Array.isArray(decision.plan)) decision.plan.forEach(assertTextSafe)
  if (decision.question && typeof decision.question === 'object' && !Array.isArray(decision.question)) {
    assertTextSafe((decision.question as Record<string, unknown>).text)
  }
}
