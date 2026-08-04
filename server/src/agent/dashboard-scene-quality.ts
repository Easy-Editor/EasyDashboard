export type DashboardSceneQualityFailureTag =
  | 'STRUCTURAL_CONTAINER_REQUIRED'
  | 'ORDINARY_MATERIAL_COMPOSITION_REQUIRED'
  | 'INSUFFICIENT_DISTINCT_MATERIAL_TYPES'
  | 'TEXT_REQUIRED'
  | 'NUMBER_FLIP_REQUIRED'
  | 'GEO_MAP_REQUIRED'
  | 'SCROLL_LIST_REQUIRED'
  | 'CHART_COMPOSITION_REQUIRED'
  | 'PROGRESS_REQUIRED'
  | 'UNSUPPORTED_CUSTOM_MATERIAL'
  | 'INVALID_LOCAL_CUSTOM_SPEC'
  | 'LOCAL_CUSTOM_CAPABILITY_GAP_REQUIRED'
  | 'UNSAFE_EXISTING_CUSTOM_MUTATION'
  | 'FULL_CANVAS_CUSTOM_MATERIAL'
  | 'DOMINANT_CUSTOM_MATERIAL'
  | 'MATERIAL_OUT_OF_BOUNDS'
  | 'EXTERNAL_ASSET_REFERENCE'

export type DashboardSceneQualityCriterion = {
  id: string
  passed: boolean
  failureTag: DashboardSceneQualityFailureTag
  detail: string
}

export type DashboardSceneQualityResult = {
  passed: boolean
  score: number
  failureTags: DashboardSceneQualityFailureTag[]
  criteria: DashboardSceneQualityCriterion[]
  evidence: {
    dashboardSceneCount: number
    structuralContainerCount: number
    ordinaryMaterialCount: number
    distinctOrdinaryMaterialTypeCount: number
    componentCounts: Record<string, number>
    chartCount: number
    distinctChartTypeCount: number
    customMaterialCount: number
    unsupportedCustomMaterialCount: number
    invalidLocalCustomSpecCount: number
    unsafeExistingCustomMutationCount: number
    fullCanvasCustomMaterialCount: number
    dominantCustomMaterialCount: number
    outOfBoundsMaterialCount: number
    externalAssetReferenceCount: number
  }
}

type JsonRecord = Record<string, unknown>
type Rect = { x: number; y: number; width: number; height: number }

const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080
const CANVAS_AREA = CANVAS_WIDTH * CANVAS_HEIGHT
const MAX_LOCAL_CUSTOM_AREA_RATIO = 0.25
const MAX_TOTAL_CUSTOM_AREA_RATIO = 0.35
const EXTERNAL_ASSET_PATTERN =
  /(?:https?:\/\/|data:image\/|file:\/\/|blob:|(?:^|["'\s])\/(?:var|tmp|users)\/|\.(?:avif|gif|jpe?g|png|webp)(?:[?#"'\s]|$))/iu

const ORDINARY_MATERIALS = new Set([
  'Text',
  'DateTime',
  'BarChart',
  'LineChart',
  'PieChart',
  'NumberFlip',
  'Progress',
  'ScrollList',
  'GeoMap',
])

const CHART_MATERIALS = new Set(['BarChart', 'LineChart', 'PieChart'])
const REMOTE_MATERIAL_NAME_PREFIX = 'EasyEditorMaterials'
const STRUCTURAL_CONTAINER_NAME = 'Div'
const CUSTOM_COMPONENT_NAME = 'DashboardScene'
const CUSTOM_SPEC_FIELD_ID = 'props.spec'

const canonicalOrdinaryMaterialName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const displayName = value.startsWith(REMOTE_MATERIAL_NAME_PREFIX)
    ? value.slice(REMOTE_MATERIAL_NAME_PREFIX.length)
    : value
  return ORDINARY_MATERIALS.has(displayName) ? displayName : null
}

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const asRect = (value: unknown): Rect | null => {
  if (!isRecord(value)) return null
  const { x, y, width, height } = value
  return finiteNumber(x) && finiteNumber(y) && finiteNumber(width) && finiteNumber(height)
    ? { x, y, width, height }
    : null
}

const operationRect = (operation: JsonRecord) => {
  const fields = isRecord(operation.fields) ? operation.fields : {}
  return asRect(fields['shared.rect'])
}

const isInsideRect = (rect: Rect, width: number, height: number) =>
  rect.width > 0 &&
  rect.height > 0 &&
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.x + rect.width <= width &&
  rect.y + rect.height <= height

const isInsideCanvas = (rect: Rect) => isInsideRect(rect, CANVAS_WIDTH, CANVAS_HEIGHT)

const areaRatio = (rect: Rect) => (rect.width * rect.height) / CANVAS_AREA

const hasItems = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0

const localDashboardSceneSpecIsValid = (operation: JsonRecord): boolean => {
  const rect = operationRect(operation)
  const fields = isRecord(operation.fields) ? operation.fields : {}
  const spec = isRecord(fields[CUSTOM_SPEC_FIELD_ID]) ? fields[CUSTOM_SPEC_FIELD_ID] : null
  if (!rect || !spec || spec.version !== 1) return false

  const canvas = isRecord(spec.canvas) ? spec.canvas : null
  if (!canvas || canvas.width !== rect.width || canvas.height !== rect.height) return false

  const header = isRecord(spec.header) ? spec.header : null
  if (!header || header.showHeader !== false || header.showClock !== false) return false

  if (!Array.isArray(spec.widgets) || spec.widgets.length !== 1) return false
  const widget = isRecord(spec.widgets[0]) ? spec.widgets[0] : null
  if (!widget || !['table', 'combo-map', 'cluster', 'line', 'donut'].includes(String(widget.kind))) return false

  const widgetRect = asRect(widget.rect)
  if (!widgetRect || !isInsideRect(widgetRect, rect.width, rect.height)) return false

  const data = isRecord(widget.data) ? widget.data : null
  if (!data) return false
  if (widget.kind === 'table') return data.autoScroll === true && hasItems(data.rows) && data.rows.length > 3
  if (widget.kind === 'combo-map') {
    return hasItems(data.chart) || (hasItems(data.categories) && (hasItems(data.bars) || hasItems(data.lines)))
  }
  if (widget.kind === 'line') {
    return hasItems(data.rows) && data.rows.length > 1 && hasItems(data.series)
  }
  if (widget.kind === 'donut') {
    if (hasItems(data.rings)) {
      return data.rings.length <= 2 && data.rings.every(ring => isRecord(ring) && hasItems(ring.items))
    }
    return hasItems(data.items) || hasItems(data.segments)
  }
  return hasItems(data.items)
}

const scanExternalAssetReferences = (value: unknown): number => {
  let count = 0
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'string') {
      if (EXTERNAL_ASSET_PATTERN.test(candidate)) count += 1
      return
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit)
      return
    }
    if (isRecord(candidate)) Object.values(candidate).forEach(visit)
  }
  visit(value)
  return count
}

const hasLocalCustomCapabilityGapRationale = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.plan)) return false
  return value.plan.some(item => {
    if (typeof item !== 'string') return false
    return /(?:现有物料|ScrollList).*(?:无法|不能|不支持|缺少|能力缺口)/u.test(item)
  })
}

const isUnsafeExistingCustomMutation = (operation: JsonRecord) => {
  if (operation.type === 'resize') return true
  if (operation.type !== 'set' && operation.type !== 'unset') return false
  return operation.fieldId === CUSTOM_SPEC_FIELD_ID || operation.fieldId === 'shared.rect'
}

function criterion(
  id: string,
  passed: boolean,
  failureTag: DashboardSceneQualityFailureTag,
  detail: string,
): DashboardSceneQualityCriterion {
  return { id, passed, failureTag, detail }
}

/**
 * Evaluates whether the bank benchmark is composed from independently
 * selectable dashboard materials. DashboardScene is accepted only as a small,
 * explicit, headerless fallback for a small allowlist of effects that ordinary
 * materials cannot express locally.
 */
export function evaluateBankFinancialSceneDecision(value: unknown): DashboardSceneQualityResult {
  const operations = isRecord(value) && Array.isArray(value.operations) ? value.operations.filter(isRecord) : []
  const inserts = operations.filter(
    operation => operation.type === 'insert' && typeof operation.componentName === 'string',
  )
  const ordinaryMaterials = inserts.flatMap(operation => {
    const displayName = canonicalOrdinaryMaterialName(operation.componentName)
    return displayName ? [{ operation, displayName }] : []
  })
  const structuralContainers = inserts.filter(operation => operation.componentName === STRUCTURAL_CONTAINER_NAME)
  const dashboardScenes = inserts.filter(operation => operation.componentName === CUSTOM_COMPONENT_NAME)
  const unsupportedCustomMaterials = inserts.filter(
    operation =>
      operation.componentName !== STRUCTURAL_CONTAINER_NAME &&
      operation.componentName !== CUSTOM_COMPONENT_NAME &&
      !canonicalOrdinaryMaterialName(operation.componentName),
  )
  const customMaterials = [...dashboardScenes, ...unsupportedCustomMaterials]
  const componentCounts = ordinaryMaterials.reduce<Record<string, number>>((counts, material) => {
    counts[material.displayName] = (counts[material.displayName] ?? 0) + 1
    return counts
  }, {})
  const count = (componentName: string) => componentCounts[componentName] ?? 0
  const chartTypes = [...CHART_MATERIALS].filter(componentName => count(componentName) > 0)
  const chartCount = chartTypes.reduce((total, componentName) => total + count(componentName), 0)
  const customRects = dashboardScenes.map(operation => operationRect(operation))
  const fullCanvasCustomMaterialCount = customRects.filter(rect => rect && areaRatio(rect) >= 0.98).length
  const totalCustomAreaRatio = customRects.reduce((total, rect) => total + (rect ? areaRatio(rect) : 1), 0)
  const dominantCustomMaterialCount = customRects.filter(
    rect => !rect || areaRatio(rect) > MAX_LOCAL_CUSTOM_AREA_RATIO,
  ).length
  const invalidRects = inserts.filter(operation => {
    const rect = operationRect(operation)
    return !rect || !isInsideCanvas(rect)
  })
  const invalidLocalCustomSpecCount = dashboardScenes.filter(
    operation => !localDashboardSceneSpecIsValid(operation),
  ).length
  const unsafeExistingCustomMutationCount = operations.filter(isUnsafeExistingCustomMutation).length
  const externalAssetReferenceCount = scanExternalAssetReferences(value)
  const customMaterialsAreLocalized =
    unsupportedCustomMaterials.length === 0 &&
    invalidLocalCustomSpecCount === 0 &&
    dominantCustomMaterialCount === 0 &&
    fullCanvasCustomMaterialCount === 0 &&
    totalCustomAreaRatio <= MAX_TOTAL_CUSTOM_AREA_RATIO &&
    dashboardScenes.length < ordinaryMaterials.length
  const customCapabilityGapIsExplained = dashboardScenes.length === 0 || hasLocalCustomCapabilityGapRationale(value)

  const criteria = [
    criterion(
      'structural-containers',
      structuralContainers.length >= 6,
      'STRUCTURAL_CONTAINER_REQUIRED',
      `${structuralContainers.length}/6 structural Div containers`,
    ),
    criterion(
      'ordinary-material-composition',
      ordinaryMaterials.length >= 12,
      'ORDINARY_MATERIAL_COMPOSITION_REQUIRED',
      `${ordinaryMaterials.length}/12 ordinary material nodes`,
    ),
    criterion(
      'distinct-material-types',
      Object.keys(componentCounts).length >= 7,
      'INSUFFICIENT_DISTINCT_MATERIAL_TYPES',
      `${Object.keys(componentCounts).length}/7 distinct ordinary material types`,
    ),
    criterion('text', count('Text') >= 2, 'TEXT_REQUIRED', `${count('Text')}/2`),
    criterion('number-flip', count('NumberFlip') >= 3, 'NUMBER_FLIP_REQUIRED', `${count('NumberFlip')}/3`),
    criterion('geo-map', count('GeoMap') >= 1, 'GEO_MAP_REQUIRED', `${count('GeoMap')}/1`),
    criterion('scroll-list', count('ScrollList') >= 1, 'SCROLL_LIST_REQUIRED', `${count('ScrollList')}/1`),
    criterion(
      'charts',
      chartCount >= 3 && chartTypes.length >= 2,
      'CHART_COMPOSITION_REQUIRED',
      `${chartCount}/3 chart nodes across ${chartTypes.length}/2 chart types`,
    ),
    criterion('progress', count('Progress') >= 1, 'PROGRESS_REQUIRED', `${count('Progress')}/1`),
    criterion(
      'supported-custom-component',
      unsupportedCustomMaterials.length === 0,
      'UNSUPPORTED_CUSTOM_MATERIAL',
      `${unsupportedCustomMaterials.length} unsupported custom material nodes`,
    ),
    criterion(
      'valid-local-custom-spec',
      invalidLocalCustomSpecCount === 0,
      'INVALID_LOCAL_CUSTOM_SPEC',
      `${invalidLocalCustomSpecCount} invalid localized DashboardScene specs`,
    ),
    criterion(
      'local-custom-capability-gap',
      customCapabilityGapIsExplained,
      'LOCAL_CUSTOM_CAPABILITY_GAP_REQUIRED',
      customCapabilityGapIsExplained ? 'capability gap explained or no custom fallback used' : 'missing plan rationale',
    ),
    criterion(
      'no-unsafe-existing-custom-mutation',
      unsafeExistingCustomMutationCount === 0,
      'UNSAFE_EXISTING_CUSTOM_MUTATION',
      `${unsafeExistingCustomMutationCount} unverifiable existing-node spec/rect mutations`,
    ),
    criterion(
      'no-full-canvas-custom-material',
      fullCanvasCustomMaterialCount === 0,
      'FULL_CANVAS_CUSTOM_MATERIAL',
      `${fullCanvasCustomMaterialCount} full-canvas custom material nodes`,
    ),
    criterion(
      'custom-materials-localized',
      customMaterialsAreLocalized,
      'DOMINANT_CUSTOM_MATERIAL',
      `${dashboardScenes.length} DashboardScene nodes, ${Math.round(totalCustomAreaRatio * 100)}% aggregate canvas area`,
    ),
    criterion(
      'canvas-global-material-bounds',
      invalidRects.length === 0,
      'MATERIAL_OUT_OF_BOUNDS',
      `${invalidRects.length} invalid or out-of-bounds canvas-global material rects`,
    ),
    criterion(
      'asset-independent',
      externalAssetReferenceCount === 0,
      'EXTERNAL_ASSET_REFERENCE',
      `${externalAssetReferenceCount}`,
    ),
  ]
  const passedCount = criteria.filter(item => item.passed).length
  const failureTags = [...new Set(criteria.filter(item => !item.passed).map(item => item.failureTag))]

  return {
    passed: failureTags.length === 0,
    score: Math.round((passedCount / criteria.length) * 100),
    failureTags,
    criteria,
    evidence: {
      dashboardSceneCount: dashboardScenes.length,
      structuralContainerCount: structuralContainers.length,
      ordinaryMaterialCount: ordinaryMaterials.length,
      distinctOrdinaryMaterialTypeCount: Object.keys(componentCounts).length,
      componentCounts,
      chartCount,
      distinctChartTypeCount: chartTypes.length,
      customMaterialCount: customMaterials.length,
      unsupportedCustomMaterialCount: unsupportedCustomMaterials.length,
      invalidLocalCustomSpecCount,
      unsafeExistingCustomMutationCount,
      fullCanvasCustomMaterialCount,
      dominantCustomMaterialCount,
      outOfBoundsMaterialCount: invalidRects.length,
      externalAssetReferenceCount,
    },
  }
}
