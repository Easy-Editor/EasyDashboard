import { defaultAgentComponentsMap } from '@/editor/agent-materials'
import type { ProjectSchema, RootSchema } from '@easy-editor/core'

export const DASHBOARD_PROJECT_DOCUMENT_VERSION = 1 as const

export type DashboardThemeMode = 'light' | 'dark'

export type DashboardTheme = {
  mode: DashboardThemeMode
  tokens: Record<string, string>
}

export type DashboardPageTheme = {
  mode?: DashboardThemeMode
  tokens?: Record<string, string>
}

export const DEFAULT_DASHBOARD_THEME: DashboardTheme = {
  mode: 'dark',
  tokens: {
    '--dashboard-background': '#080A0D',
    '--dashboard-foreground': '#F1F5F7',
    '--dashboard-accent': '#67C6D9',
  },
}

export type DashboardPageSchema = RootSchema & {
  fileName: string
  meta: Record<string, unknown> & {
    easyDashboard: {
      pageId: string
      theme?: DashboardPageTheme
      [key: string]: unknown
    }
  }
}

export type DashboardEditorSchema = ProjectSchema<DashboardPageSchema>

export type DashboardProjectDocument = {
  formatVersion: typeof DASHBOARD_PROJECT_DOCUMENT_VERSION
  editorSchema: DashboardEditorSchema
  presentation: {
    startPageId: string
    theme: DashboardTheme
  }
}

type UnknownRecord = Record<string, unknown>

export class UnsupportedDashboardDocumentVersionError extends Error {
  constructor(readonly formatVersion: unknown) {
    super(`Unsupported dashboard project document version: ${String(formatVersion)}`)
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function collectComponentNames(node: unknown, result: Set<string>): void {
  if (!isRecord(node)) return
  const componentName = nonEmptyString(node.componentName)
  if (componentName) result.add(componentName)
  if (Array.isArray(node.children)) {
    node.children.forEach(child => collectComponentNames(child, result))
  }
}

function agentMaterialAliases(component: (typeof defaultAgentComponentsMap)[number]): string[] {
  return component.globalName === component.componentName
    ? [component.componentName]
    : [component.componentName, component.globalName]
}

function restoreAgentMaterialDescriptors(editorSchema: ProjectSchema): void {
  const usedComponentNames = new Set<string>()
  editorSchema.componentsTree?.forEach(page => collectComponentNames(page, usedComponentNames))

  const pinnedByComponent = new Map(
    defaultAgentComponentsMap.flatMap(component =>
      agentMaterialAliases(component).map(alias => [alias, component] as const),
    ),
  )
  const restoredComponentsMap = (editorSchema.componentsMap ?? []).map(component => {
    const componentName = nonEmptyString(component.componentName)
    const pinned = componentName ? pinnedByComponent.get(componentName) : undefined
    if (!pinned) return component
    if ('package' in component && typeof component.package === 'string') {
      return component
    }
    return { ...pinned, componentName }
  })
  const declaredComponentNames = new Set(
    restoredComponentsMap.map(component => nonEmptyString(component.componentName)).filter(Boolean),
  )

  for (const pinned of defaultAgentComponentsMap) {
    for (const alias of agentMaterialAliases(pinned)) {
      if (!usedComponentNames.has(alias) || declaredComponentNames.has(alias)) continue
      restoredComponentsMap.push({ ...pinned, componentName: alias })
      declaredComponentNames.add(alias)
    }
  }

  editorSchema.componentsMap = restoredComponentsMap
}

function remoteMaterialNpmByComponent(editorSchema: ProjectSchema): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  for (const component of editorSchema.componentsMap ?? []) {
    if (
      component.devMode !== 'proCode' ||
      typeof component.componentName !== 'string' ||
      typeof component.package !== 'string'
    ) {
      continue
    }
    result.set(component.componentName, {
      componentName: component.componentName,
      package: component.package,
      ...(component.version ? { version: component.version } : {}),
      ...(component.globalName ? { globalName: component.globalName } : {}),
      ...(component.destructuring !== undefined ? { destructuring: component.destructuring } : {}),
      ...(component.exportName ? { exportName: component.exportName } : {}),
      ...(component.subName ? { subName: component.subName } : {}),
      ...(component.main ? { main: component.main } : {}),
    })
  }
  return result
}

function hydrateRemoteMaterialNodes(node: unknown, npmByComponent: ReadonlyMap<string, Record<string, unknown>>): void {
  if (!isRecord(node)) return
  const componentName = nonEmptyString(node.componentName)
  const props = isRecord(node.props) ? node.props : undefined
  if (componentName === 'Text' && props && typeof props.text === 'string' && !isRecord(props.$data)) {
    props.$data = createStaticData([{ text: props.text }])
    hydrateAgentTextAppearance(node, props)
  }
  if ((componentName === 'BarChart' || componentName === 'LineChart') && props) {
    hydrateAgentChartProps(componentName, props)
  }
  if (componentName && !isRecord(node.npm)) {
    const npm = npmByComponent.get(componentName)
    if (npm) node.npm = { ...npm }
  }
  if (Array.isArray(node.children)) {
    node.children.forEach(child => hydrateRemoteMaterialNodes(child, npmByComponent))
  }
}

function createStaticData(rows: UnknownRecord[]): UnknownRecord {
  const firstRow = rows[0] ?? {}
  return {
    sourceType: 'static',
    staticData: rows,
    fieldMappings: Object.keys(firstRow).map(field => ({ componentField: field, sourceField: field })),
  }
}

function dashboardRect(node: UnknownRecord): UnknownRecord | undefined {
  const directDashboard = isRecord(node.$dashboard) ? node.$dashboard : undefined
  if (directDashboard && isRecord(directDashboard.rect)) return directDashboard.rect
  const extra = isRecord(node.extra) ? node.extra : undefined
  const nestedDashboard = extra && isRecord(extra.$dashboard) ? extra.$dashboard : undefined
  return nestedDashboard && isRecord(nestedDashboard.rect) ? nestedDashboard.rect : undefined
}

function agentNodeTitle(node: UnknownRecord): string {
  const extra = isRecord(node.extra) ? node.extra : undefined
  return nonEmptyString(node.title) ?? nonEmptyString(extra?.title) ?? ''
}

function hydrateAgentTextAppearance(node: UnknownRecord, props: UnknownRecord): void {
  const rect = dashboardRect(node)
  const y = typeof rect?.y === 'number' ? rect.y : Number.POSITIVE_INFINITY
  const height = typeof rect?.height === 'number' ? rect.height : 0
  const title = agentNodeTitle(node)
  const isPrimaryTitle = /(?:主标题|驾驶舱|大屏标题)/u.test(title) || (y <= 80 && height >= 56)
  const isMetric =
    !isPrimaryTitle &&
    (/(?:总额|完成率|增长率|告警|架次|能耗|收入|数量|指标)/u.test(title) || (y <= 280 && height >= 72))

  if (typeof props.fontSize !== 'number') props.fontSize = isPrimaryTitle ? 38 : isMetric ? 28 : 16
  if (props.fontWeight === undefined && (isPrimaryTitle || isMetric)) props.fontWeight = 'bold'
  if (!nonEmptyString(props.color)) props.color = isPrimaryTitle ? '#eaf8ff' : isMetric ? '#6ee7ff' : '#91a9c2'
  if (!nonEmptyString(props.verticalAlign)) props.verticalAlign = 'middle'
  if (isPrimaryTitle) {
    if (props.glowEnable === undefined) props.glowEnable = true
    if (!nonEmptyString(props.glowColor)) props.glowColor = '#38bdf8'
    if (typeof props.glowIntensity !== 'number') props.glowIntensity = 0.65
  }
  if (isMetric) {
    if (!nonEmptyString(props.background)) props.background = 'rgba(10, 31, 55, 0.86)'
    if (!isRecord(props.style)) {
      props.style = {
        border: '1px solid rgba(56, 189, 248, 0.22)',
        borderRadius: 12,
        boxSizing: 'border-box',
        padding: '0 24px',
      }
    }
  }
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function hydrateAgentChartProps(componentName: 'BarChart' | 'LineChart', props: UnknownRecord): void {
  const rows = Array.isArray(props.data) ? props.data.filter(isRecord) : []
  const xKey = nonEmptyString(props.xKey)
  const series = Array.isArray(props.series) ? props.series.filter(isRecord) : []
  const yFields = series.map(item => nonEmptyString(item.dataKey)).filter((value): value is string => !!value)
  const colors = series.map(item => nonEmptyString(item.color)).filter((value): value is string => !!value)

  if (componentName === 'BarChart' && rows.length > 0 && xKey && yFields.length > 0) {
    // @easy-editor/materials-dashboard-bar-chart@0.0.7 only recognizes the
    // legacy name/value1/value2 row shape even when xField/yFields are set.
    const firstYField = yFields[0]!
    const secondYField = yFields[1]
    const compatibleRows = rows.map(row => {
      const value1 = numberValue(row[firstYField])
      return {
        name: String(row[xKey] ?? ''),
        value1,
        value2: secondYField ? numberValue(row[secondYField]) : value1,
      }
    })
    props.$data = createStaticData(compatibleRows)
    props.xField = 'name'
    props.yFields = secondYField ? ['value1', 'value2'] : ['value1']
    if (props.showLegend === undefined && !secondYField) props.showLegend = false
  } else {
    if (rows.length > 0 && !isRecord(props.$data)) props.$data = createStaticData(rows)
    if (xKey && !nonEmptyString(props.xField)) props.xField = xKey
    if (yFields.length > 0 && !Array.isArray(props.yFields)) props.yFields = yFields
  }

  if (colors.length > 0 && !Array.isArray(props.colors)) props.colors = colors
  if (!nonEmptyString(props.background)) props.background = 'rgba(8, 24, 44, 0.72)'
  if (!isRecord(props.style)) {
    props.style = { border: '1px solid rgba(56, 189, 248, 0.14)', borderRadius: 12 }
  }
}

function uniqueValue(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }

  let suffix = 2
  while (used.has(`${candidate}-${suffix}`)) suffix += 1
  const unique = `${candidate}-${suffix}`
  used.add(unique)
  return unique
}

function stringTokens(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function normalizeTheme(value: unknown): DashboardTheme {
  const source = isRecord(value) ? value : {}
  return {
    mode: source.mode === 'light' || source.mode === 'dark' ? source.mode : DEFAULT_DASHBOARD_THEME.mode,
    tokens: {
      ...DEFAULT_DASHBOARD_THEME.tokens,
      ...stringTokens(source.tokens),
    },
  }
}

function normalizePageTheme(value: unknown): DashboardPageTheme | undefined {
  if (!isRecord(value)) return undefined
  const tokens = stringTokens(value.tokens)
  const mode = value.mode === 'light' || value.mode === 'dark' ? value.mode : undefined
  if (!mode && Object.keys(tokens).length === 0) return undefined
  return {
    ...(mode ? { mode } : {}),
    ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
  }
}

function createFallbackPage(): RootSchema {
  return {
    componentName: 'Root',
    fileName: 'home',
    fileDesc: '首页',
    isRoot: true,
    props: {
      backgroundColor: 'var(--dashboard-background)',
      className: 'page',
    },
    $dashboard: {
      rect: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
    },
    children: [],
  }
}

function readInput(input: unknown): {
  editorSchema: UnknownRecord
  presentation: UnknownRecord
} {
  if (!isRecord(input)) {
    throw new TypeError('Dashboard project document must be an object')
  }

  if ('formatVersion' in input && input.formatVersion !== DASHBOARD_PROJECT_DOCUMENT_VERSION) {
    throw new UnsupportedDashboardDocumentVersionError(input.formatVersion)
  }

  if (isRecord(input.editorSchema)) {
    return {
      editorSchema: input.editorSchema,
      presentation: isRecord(input.presentation) ? input.presentation : {},
    }
  }

  const legacyPresentation = isRecord(input.meta) && isRecord(input.meta.easyDashboard) ? input.meta.easyDashboard : {}
  return {
    editorSchema: input,
    presentation: legacyPresentation,
  }
}

/**
 * Accepts both the current document envelope and a legacy raw EasyEditor
 * ProjectSchema, returning the single canonical in-memory representation.
 */
export function decodeDashboardProjectDocument(input: unknown): DashboardProjectDocument {
  const source = readInput(input)
  const editorSchema = cloneValue(source.editorSchema) as ProjectSchema
  restoreAgentMaterialDescriptors(editorSchema)
  const npmByComponent = remoteMaterialNpmByComponent(editorSchema)
  const rawPages = Array.isArray(editorSchema.componentsTree) ? editorSchema.componentsTree : []
  const pages = rawPages.length > 0 ? rawPages : [createFallbackPage()]
  const usedPageIds = new Set<string>()
  const usedFileNames = new Set<string>()

  const componentsTree: DashboardPageSchema[] = pages.map((rawPage, index) => {
    const page = (isRecord(rawPage) ? rawPage : createFallbackPage()) as RootSchema
    const meta = isRecord(page.meta) ? page.meta : {}
    const easyDashboard = isRecord(meta.easyDashboard) ? meta.easyDashboard : {}
    const fileName = uniqueValue(nonEmptyString(page.fileName) ?? `page-${index + 1}`, usedFileNames)
    const pageIdCandidate =
      nonEmptyString(easyDashboard.pageId) ??
      nonEmptyString(page.docId) ??
      nonEmptyString(page.id) ??
      `page-${fileName.replaceAll('/', '-')}`
    const pageId = uniqueValue(pageIdCandidate, usedPageIds)
    const theme = normalizePageTheme(easyDashboard.theme)

    const normalizedPage = {
      ...page,
      componentName: nonEmptyString(page.componentName) ?? 'Root',
      fileName,
      meta: {
        ...meta,
        easyDashboard: {
          ...easyDashboard,
          pageId,
          ...(theme ? { theme } : {}),
        },
      },
    } as DashboardPageSchema
    hydrateRemoteMaterialNodes(normalizedPage, npmByComponent)
    return normalizedPage
  })

  const requestedStartPageId = nonEmptyString(source.presentation.startPageId)
  const startPageId =
    (requestedStartPageId && usedPageIds.has(requestedStartPageId) ? requestedStartPageId : undefined) ??
    componentsTree[0].meta.easyDashboard.pageId
  const theme = normalizeTheme(source.presentation.theme)
  const projectMeta = isRecord(editorSchema.meta) ? editorSchema.meta : {}
  const legacyEasyDashboard = isRecord(projectMeta.easyDashboard) ? projectMeta.easyDashboard : {}

  return {
    formatVersion: DASHBOARD_PROJECT_DOCUMENT_VERSION,
    editorSchema: {
      ...editorSchema,
      version: nonEmptyString(editorSchema.version) ?? '1.0.0',
      componentsTree,
      meta: {
        ...projectMeta,
        easyDashboard: {
          ...legacyEasyDashboard,
          documentVersion: DASHBOARD_PROJECT_DOCUMENT_VERSION,
          startPageId,
          theme,
        },
      },
    },
    presentation: {
      startPageId,
      theme,
    },
  }
}

export function serializeDashboardProjectDocument(document: DashboardProjectDocument): DashboardProjectDocument {
  return cloneValue(decodeDashboardProjectDocument(document))
}

export function resolvePageFileName(document: DashboardProjectDocument, pageId: string): string | undefined {
  return document.editorSchema.componentsTree.find(page => page.meta.easyDashboard.pageId === pageId)?.fileName
}

export function resolveStartPageFileName(document: DashboardProjectDocument): string | undefined {
  return (
    resolvePageFileName(document, document.presentation.startPageId) ??
    document.editorSchema.componentsTree[0]?.fileName
  )
}

export function resolvePageTheme(document: DashboardProjectDocument, pageId: string): DashboardTheme {
  const pageTheme = document.editorSchema.componentsTree.find(page => page.meta.easyDashboard.pageId === pageId)?.meta
    .easyDashboard.theme

  return {
    mode: pageTheme?.mode ?? document.presentation.theme.mode,
    tokens: {
      ...document.presentation.theme.tokens,
      ...pageTheme?.tokens,
    },
  }
}
