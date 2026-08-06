import type { AgentTask } from '@/features/agent'
import { createDashboardRenderModel } from '@/features/rendering/dashboard-render-adapter'

export type AgentCanvasFocusTarget = {
  id: string
  label: string
  rect: { x: number; y: number; width: number; height: number }
}

export type AgentCanvasActivity = {
  label: string
  detail: string
  targets: AgentCanvasFocusTarget[]
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readRect(node: UnknownRecord): AgentCanvasFocusTarget['rect'] | null {
  const dashboard = record(node.$dashboard)
  const rect = record(dashboard?.rect)
  if (!rect) return null
  const x = finiteNumber(rect.x)
  const y = finiteNumber(rect.y)
  const width = finiteNumber(rect.width)
  const height = finiteNumber(rect.height)
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function compactText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  return text ? text.slice(0, 120) : null
}

function nodeLabel(node: UnknownRecord): string {
  const extra = record(node.extra)
  const props = record(node.props)
  return (
    compactText(extra?.title) ??
    compactText(node.title) ??
    compactText(props?.title) ??
    compactText(props?.text) ??
    compactText(node.componentName) ??
    '当前组件'
  )
}

function normalizeMatchText(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s·:：,，。/\\()（）\[\]【】_-]/g, '')
}

function collectIntentTargets(
  value: unknown,
  key = '',
  depth = 0,
  output = { ids: new Set<string>(), names: new Set<string>() },
) {
  if (depth > 5) return output
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach(item => collectIntentTargets(item, key, depth + 1, output))
    return output
  }
  const source = record(value)
  if (!source) return output

  for (const [childKey, childValue] of Object.entries(source)) {
    if (typeof childValue === 'string') {
      const text = compactText(childValue)
      if (!text) continue
      if (/nodeid$/i.test(childKey) || (childKey === 'id' && /selectedrefs?/i.test(key))) output.ids.add(text)
      if (/^(target|targetname|title|component|componenttitle|region|area|description|goal)$/i.test(childKey)) {
        output.names.add(text)
      }
      continue
    }
    collectIntentTargets(childValue, `${key}.${childKey}`, depth + 1, output)
  }
  return output
}

function collectNodes(value: unknown, output: UnknownRecord[] = []): UnknownRecord[] {
  if (Array.isArray(value)) {
    value.forEach(item => collectNodes(item, output))
    return output
  }
  const node = record(value)
  if (!node) return output
  if (typeof node.componentName === 'string') output.push(node)
  if (Array.isArray(node.children)) collectNodes(node.children, output)
  return output
}

export function resolveAgentCanvasActivity(
  task: AgentTask | undefined,
  projectSchema: unknown,
): AgentCanvasActivity | null {
  if (!task || !['running', 'waiting'].includes(task.status)) return null
  const activeStep = (task.activePlan?.steps ?? []).find(step =>
    ['running', 'verifying', 'revising'].includes(step.status),
  )
  if (!activeStep) return null

  let nodes: UnknownRecord[] = []
  try {
    const model = createDashboardRenderModel(projectSchema)
    const activePage = model.document.editorSchema.componentsTree.find(page => page.fileName === model.initialPage)
    nodes = collectNodes(activePage ?? model.document.editorSchema.componentsTree[0])
  } catch {
    nodes = []
  }

  const intentTargets = collectIntentTargets(activeStep.intent)
  const normalizedNames = [...intentTargets.names].map(normalizeMatchText).filter(name => name.length >= 2)
  const targets = nodes
    .flatMap(node => {
      const id = compactText(node.id)
      const rect = readRect(node)
      if (!id || !rect) return []
      const label = nodeLabel(node)
      const normalizedLabel = normalizeMatchText(label)
      const matchesId = intentTargets.ids.has(id)
      const matchesName = normalizedNames.some(name => normalizedLabel.includes(name) || name.includes(normalizedLabel))
      return matchesId || matchesName ? [{ id, label, rect }] : []
    })
    .sort((left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height)
    .slice(0, 3)

  return {
    label: activeStep.title,
    detail: targets.length > 0 ? `正在更新 ${targets.map(target => target.label).join('、')}` : '正在处理当前步骤',
    targets,
  }
}
