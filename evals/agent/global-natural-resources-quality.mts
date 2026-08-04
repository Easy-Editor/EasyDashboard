export type NumericRange = [number, number]

export type GlobalNaturalResourcesQualityBar = {
  ordinaryMaterialCount: number
  distinctOrdinaryMaterialTypeCount: number
  componentCounts: Record<string, number>
  chartCount: number
  distinctChartTypeCount: number
  globeSceneCount: number
  dashboardSceneCountMax: number
  fullCanvasCustomMaterialCount: number
  dominantCustomMaterialCount: number
  outOfBoundsMaterialCount: number
  externalAssetReferenceCount: number
  structuralHardGates: {
    structuralContainerCount: number
    requiredGroups: Array<{ id: string; aliases: string[] }>
    regions: Record<
      string,
      {
        x: NumericRange
        y: NumericRange
        minWidth: number
        minHeight?: number
        maxHeight?: number
      }
    >
    maxLocalizedDashboardSceneAreaRatio: number
    maxTotalDashboardSceneAreaRatio: number
    requiredContentGroups: Array<{
      id: string
      keywords: string[]
      minimumMatches: number
    }>
  }
  visualHardGates: {
    minDarkSurfaceColorCount: number
    minCyanAccentColorCount: number
    minAnimatedMaterialCount: number
    minInteractiveMaterialCount: number
    leftTop5ProgressCount: number
    leftLandUseNumberCount: number
    rightResourceNumberCount: number
    centerBottomNumberCount: number
    globe: {
      minWidth: number
      minHeight: number
      centerX: NumericRange
      centerY: NumericRange
      centerLongitude: NumericRange
      centerLatitude: NumericRange
      introDuration: NumericRange
      globeScale: NumericRange
      minStarDensity: number
      maxStarDensity: number
      minRotationSpeed: number
      requireAutoRotate: boolean
      requireIntroAnimation: boolean
      requireIntroLoop: boolean
      requireAtmosphereColor: boolean
      requireDarkBackground: boolean
      requireSolidColors: boolean
    }
  }
}

export type GlobalNaturalResourcesBenchmark = {
  id: string
  title: string
  inputMode: string
  canvas: { width: number; height: number }
  prompt: string
  qualityBar: GlobalNaturalResourcesQualityBar
}

export type GlobalNaturalResourcesQualityCriterion = {
  id: string
  category: 'structure' | 'visual' | 'safety'
  passed: boolean
  detail: string
}

export type GlobalNaturalResourcesQualityResult = {
  passed: boolean
  score: number
  failureTags: string[]
  criteria: GlobalNaturalResourcesQualityCriterion[]
  hardGateSummary: {
    structure: { passed: number; total: number }
    visual: { passed: number; total: number }
    safety: { passed: number; total: number }
  }
  evidence: {
    structuralContainerCount: number
    matchedStructuralGroups: string[]
    ordinaryMaterialCount: number
    distinctOrdinaryMaterialTypeCount: number
    componentCounts: Record<string, number>
    chartCount: number
    distinctChartTypeCount: number
    globeSceneCount: number
    dashboardSceneCount: number
    unsupportedCustomMaterialCount: number
    imageMaterialCount: number
    fullCanvasCustomMaterialCount: number
    dominantCustomMaterialCount: number
    outOfBoundsMaterialCount: number
    externalAssetReferenceCount: number
    darkSurfaceColorCount: number
    cyanAccentColorCount: number
    animatedMaterialCount: number
    interactiveMaterialCount: number
    moduleCounts: {
      leftTop5Progress: number
      leftLandUseNumbers: number
      rightResourceNumbers: number
      centerBottomNumbers: number
      rightCo2Needles: number
      leftLifeIndexVisuals: number
      rightAtmosphereVisuals: number
    }
  }
}

type JsonRecord = Record<string, unknown>
type Rect = { x: number; y: number; width: number; height: number }
type InsertOperation = JsonRecord & { componentName: string; fields: JsonRecord; rect: Rect | null }
type Rgb = { r: number; g: number; b: number }

const REMOTE_MATERIAL_PREFIX = 'EasyEditorMaterials'
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
const EXTERNAL_ASSET_PATTERN =
  /(?:https?:\/\/|data:image\/|file:\/\/|blob:|(?:^|["'\s])\/(?:var|tmp|users)\/|\.(?:avif|gif|jpe?g|png|webp)(?:[?#"'\s]|$))/iu
const SAFE_SOLID_COLOR_PATTERN = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d.%\s,+-]+\)|[a-z]{3,24})$/iu
const SHADER_HEX_COLOR_PATTERN = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu

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

const canonicalComponentName = (value: string) =>
  value.startsWith(REMOTE_MATERIAL_PREFIX) ? value.slice(REMOTE_MATERIAL_PREFIX.length) : value

const normalizedText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, '')

const inRange = (value: number, range: NumericRange) => value >= range[0] && value <= range[1]

const insideCanvas = (rect: Rect, canvas: { width: number; height: number }) =>
  rect.width > 0 &&
  rect.height > 0 &&
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.x + rect.width <= canvas.width &&
  rect.y + rect.height <= canvas.height

const rectAreaRatio = (rect: Rect, canvas: { width: number; height: number }) =>
  (rect.width * rect.height) / (canvas.width * canvas.height)

const operationFields = (operation: JsonRecord) => (isRecord(operation.fields) ? operation.fields : {})

const operationRect = (operation: JsonRecord) => asRect(operationFields(operation)['shared.rect'])

const insertedOperations = (value: unknown): InsertOperation[] => {
  if (!isRecord(value) || !Array.isArray(value.operations)) return []
  return value.operations.flatMap(operation => {
    if (!isRecord(operation) || operation.type !== 'insert' || typeof operation.componentName !== 'string') return []
    return [
      {
        ...operation,
        componentName: canonicalComponentName(operation.componentName),
        fields: operationFields(operation),
        rect: operationRect(operation),
      },
    ]
  })
}

const collectStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings)
  return []
}

const countExternalAssetReferences = (value: unknown) =>
  collectStrings(value).filter(candidate => EXTERNAL_ASSET_PATTERN.test(candidate)).length

const parseHexColor = (hex: string): Rgb | null => {
  const value = hex.slice(1)
  const expanded =
    value.length === 3 ? [...value].map(character => `${character}${character}`).join('') : value.slice(0, 6)
  if (expanded.length !== 6) return null
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

const parseColorSamples = (value: string): Rgb[] => {
  const samples: Rgb[] = []
  for (const match of value.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})(?:[0-9a-f]{2})?\b/giu)) {
    const color = parseHexColor(match[0])
    if (color) samples.push(color)
  }
  for (const match of value.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/giu)) {
    samples.push({
      r: Math.min(255, Number(match[1])),
      g: Math.min(255, Number(match[2])),
      b: Math.min(255, Number(match[3])),
    })
  }
  return samples
}

const colorEvidence = (value: unknown) => {
  let darkSurfaceColorCount = 0
  let cyanAccentColorCount = 0
  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate === 'string') {
      const colors = parseColorSamples(candidate)
      if (/(?:background|surface|border|track)/iu.test(path)) {
        darkSurfaceColorCount += colors.filter(color => color.r <= 72 && color.g <= 82 && color.b <= 102).length
      }
      cyanAccentColorCount += colors.filter(
        color => color.b >= 120 && color.g >= 90 && color.b > color.r * 1.25 && color.g > color.r * 1.08,
      ).length
      if (/cyan|aqua/iu.test(candidate)) cyanAccentColorCount += 1
      return
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((child, index) => visit(child, `${path}[${index}]`))
      return
    }
    if (isRecord(candidate)) {
      Object.entries(candidate).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key))
    }
  }
  visit(value, '')
  return { darkSurfaceColorCount, cyanAccentColorCount }
}

const findNestedProperty = (value: unknown, name: string, depth = 0): unknown => {
  if (depth > 6 || !isRecord(value)) return undefined
  if (value[name] !== undefined) return value[name]
  for (const child of Object.values(value)) {
    const found = findNestedProperty(child, name, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

const globeField = (operation: InsertOperation | undefined, name: string): unknown => {
  if (!operation) return undefined
  const directKeys = [`globeScene.${name}`, `props.${name}`, name]
  for (const key of directKeys) {
    if (operation.fields[key] !== undefined) return operation.fields[key]
  }
  for (const specKey of ['globeScene.spec', 'props.spec', 'props.config']) {
    const found = findNestedProperty(operation.fields[specKey], name)
    if (found !== undefined) return found
  }
  return undefined
}

const operationTitle = (operation: InsertOperation) =>
  normalizedText(
    operation.fields['shared.title'] ??
      operation.fields['props.title'] ??
      operation.fields.name ??
      operation.title ??
      operation.name ??
      '',
  )

const regionMatches = (
  operation: InsertOperation | undefined,
  gate: GlobalNaturalResourcesQualityBar['structuralHardGates']['regions'][string],
) => {
  const rect = operation?.rect
  if (!rect) return false
  return (
    inRange(rect.x, gate.x) &&
    inRange(rect.y, gate.y) &&
    rect.width >= gate.minWidth &&
    (gate.minHeight === undefined || rect.height >= gate.minHeight) &&
    (gate.maxHeight === undefined || rect.height <= gate.maxHeight)
  )
}

const rectCenter = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

const hasBoolean = (value: unknown, expected: boolean) => value === expected

const numericFieldInRange = (value: unknown, range: NumericRange) => finiteNumber(value) && inRange(value, range)

const textContainsAll = (value: unknown, keywords: string[]) => {
  const haystack = normalizedText(JSON.stringify(value))
  return keywords.filter(keyword => haystack.includes(normalizedText(keyword))).length
}

const localizedDashboardScenePlacementIsAllowed = (operation: InsertOperation) => {
  const rect = operation.rect
  if (!rect) return false
  const center = rectCenter(rect)
  const inLeftLifeIndex = center.x <= 620 && center.y >= 650
  const inRightSpecialVisuals = center.x >= 1320 && center.y >= 420
  return inLeftLifeIndex || inRightSpecialVisuals
}

const dashboardSceneHasWidgetKind = (operation: InsertOperation, allowedKinds: string[]) => {
  const spec = operation.fields['props.spec']
  if (
    !operation.rect ||
    !isRecord(spec) ||
    spec.version !== 1 ||
    !Array.isArray(spec.widgets) ||
    spec.widgets.length !== 1
  )
    return false
  const canvas = asRect({ x: 0, y: 0, ...(isRecord(spec.canvas) ? spec.canvas : {}) })
  const header = isRecord(spec.header) ? spec.header : null
  if (
    !canvas ||
    canvas.width !== operation.rect.width ||
    canvas.height !== operation.rect.height ||
    !header ||
    header.showHeader !== false ||
    header.showClock !== false
  )
    return false
  return spec.widgets.every(widget => {
    if (!isRecord(widget) || typeof widget.kind !== 'string') return false
    return allowedKinds.includes(widget.kind)
  })
}

const chartIsInteractive = (operation: InsertOperation) => operation.fields['props.showTooltip'] !== false

const dashboardSceneIsInteractive = (operation: InsertOperation) => {
  const strings = collectStrings(operation.fields).join(' ')
  return /(?:tabViews|provinceViews|selected|activeTab|tooltip|interaction)/u.test(strings)
}

export function evaluateGlobalNaturalResourcesDecision(
  value: unknown,
  benchmark: Pick<GlobalNaturalResourcesBenchmark, 'canvas' | 'qualityBar'>,
): GlobalNaturalResourcesQualityResult {
  const { canvas, qualityBar } = benchmark
  const inserts = insertedOperations(value)
  const componentCounts = inserts.reduce<Record<string, number>>((counts, operation) => {
    counts[operation.componentName] = (counts[operation.componentName] ?? 0) + 1
    return counts
  }, {})
  const count = (componentName: string) => componentCounts[componentName] ?? 0
  const ordinaryMaterials = inserts.filter(operation => ORDINARY_MATERIALS.has(operation.componentName))
  const distinctOrdinaryTypes = [...new Set(ordinaryMaterials.map(operation => operation.componentName))]
  const chartTypes = distinctOrdinaryTypes.filter(componentName => CHART_MATERIALS.has(componentName))
  const chartCount = chartTypes.reduce((total, componentName) => total + count(componentName), 0)
  const structuralContainers = inserts.filter(operation => operation.componentName === 'Div')
  const globeScenes = inserts.filter(operation => operation.componentName === 'GlobeScene')
  const globe = globeScenes[0]
  const dashboardScenes = inserts.filter(operation => operation.componentName === 'DashboardScene')
  const supportedNames = new Set([...ORDINARY_MATERIALS, 'Div', 'GlobeScene', 'DashboardScene'])
  const unsupportedCustomMaterials = inserts.filter(operation => !supportedNames.has(operation.componentName))
  const imageMaterials = inserts.filter(operation => /(?:^|material)image$/iu.test(operation.componentName))
  const invalidRects = inserts.filter(operation => !operation.rect || !insideCanvas(operation.rect, canvas))
  const dashboardSceneAreaRatios = dashboardScenes.map(operation =>
    operation.rect ? rectAreaRatio(operation.rect, canvas) : 1,
  )
  const fullCanvasCustomMaterialCount = dashboardSceneAreaRatios.filter(ratio => ratio >= 0.98).length
  const dominantCustomMaterialCount = dashboardSceneAreaRatios.filter(
    ratio => ratio > qualityBar.structuralHardGates.maxLocalizedDashboardSceneAreaRatio,
  ).length
  const totalDashboardSceneAreaRatio = dashboardSceneAreaRatios.reduce((total, ratio) => total + ratio, 0)
  const externalAssetReferenceCount = countExternalAssetReferences(value)
  const { darkSurfaceColorCount, cyanAccentColorCount } = colorEvidence(value)

  const matchedGroups = new Map<string, InsertOperation>()
  for (const group of qualityBar.structuralHardGates.requiredGroups) {
    const matchingGroup = structuralContainers.find(operation => {
      const title = operationTitle(operation)
      return group.aliases.some(alias => title.includes(normalizedText(alias)))
    })
    if (matchingGroup) matchedGroups.set(group.id, matchingGroup)
  }

  const withRect = (componentName: string) =>
    inserts.filter((operation): operation is InsertOperation & { rect: Rect } =>
      Boolean(operation.componentName === componentName && operation.rect),
    )
  const progressNodes = withRect('Progress')
  const numberNodes = withRect('NumberFlip')
  const chartNodes = inserts.filter(operation => CHART_MATERIALS.has(operation.componentName))
  const leftTop5Progress = progressNodes.filter(operation => {
    const center = rectCenter(operation.rect)
    return center.x <= 620 && center.y >= 180 && center.y <= 540
  })
  const leftLandUseNumbers = numberNodes.filter(operation => {
    const center = rectCenter(operation.rect)
    return center.x <= 620 && center.y >= 480 && center.y <= 820
  })
  const rightResourceNumbers = numberNodes.filter(operation => {
    const center = rectCenter(operation.rect)
    return center.x >= 1320 && center.y >= 180 && center.y <= 560
  })
  const centerBottomNumbers = numberNodes.filter(operation => {
    const center = rectCenter(operation.rect)
    return center.x >= 620 && center.x <= 1480 && center.y >= 780
  })
  const rightCo2Needles = progressNodes.filter(operation => {
    const center = rectCenter(operation.rect)
    return center.x >= 1320 && center.y >= 440 && center.y <= 850
  })
  const leftLifeIndexVisuals = [...chartNodes, ...dashboardScenes].filter(operation => {
    if (!operation.rect) return false
    const center = rectCenter(operation.rect)
    return center.x <= 620 && center.y >= 650
  })
  const rightAtmosphereVisuals = [...chartNodes, ...dashboardScenes].filter(operation => {
    if (!operation.rect) return false
    const center = rectCenter(operation.rect)
    return center.x >= 1320 && center.y >= 740
  })
  const rightCo2CustomVisuals = dashboardScenes.filter(operation => {
    if (!operation.rect) return false
    const center = rectCenter(operation.rect)
    return center.x >= 1320 && center.y >= 420 && center.y <= 850
  })

  const divEnterAnimationCount = structuralContainers.filter(operation => {
    const animation = operation.fields['div.enterAnimation'] ?? operation.fields['props.enterAnimation']
    const duration = operation.fields['div.enterDuration'] ?? operation.fields['props.enterDuration']
    return typeof animation === 'string' && animation !== 'none' && (!finiteNumber(duration) || duration > 0)
  }).length
  const animatedMaterialCount =
    count('NumberFlip') + count('Progress') + chartCount + divEnterAnimationCount + (globeScenes.length ? 1 : 0)
  const interactiveMaterialCount =
    chartNodes.filter(chartIsInteractive).length + dashboardScenes.filter(dashboardSceneIsInteractive).length

  const criteria: GlobalNaturalResourcesQualityCriterion[] = []
  const add = (
    category: GlobalNaturalResourcesQualityCriterion['category'],
    id: string,
    passed: boolean,
    detail: string,
  ) => criteria.push({ category, id: `${category}:${id}`, passed, detail })

  add(
    'structure',
    'structural-container-count',
    structuralContainers.length >= qualityBar.structuralHardGates.structuralContainerCount,
    `${structuralContainers.length}/${qualityBar.structuralHardGates.structuralContainerCount}`,
  )
  for (const group of qualityBar.structuralHardGates.requiredGroups) {
    add(
      'structure',
      `group:${group.id}`,
      matchedGroups.has(group.id),
      matchedGroups.has(group.id) ? 'present' : 'missing',
    )
  }
  for (const [regionId, gate] of Object.entries(qualityBar.structuralHardGates.regions)) {
    const region = matchedGroups.get(regionId)
    add(
      'structure',
      `region:${regionId}`,
      regionMatches(region, gate),
      region?.rect ? JSON.stringify(region.rect) : 'missing group or rect',
    )
  }
  add(
    'structure',
    'ordinary-material-count',
    ordinaryMaterials.length >= qualityBar.ordinaryMaterialCount,
    `${ordinaryMaterials.length}/${qualityBar.ordinaryMaterialCount}`,
  )
  add(
    'structure',
    'distinct-ordinary-material-types',
    distinctOrdinaryTypes.length >= qualityBar.distinctOrdinaryMaterialTypeCount,
    `${distinctOrdinaryTypes.length}/${qualityBar.distinctOrdinaryMaterialTypeCount}`,
  )
  for (const [componentName, minimum] of Object.entries(qualityBar.componentCounts)) {
    add(
      'structure',
      `component:${componentName}`,
      count(componentName) >= minimum,
      `${count(componentName)}/${minimum}`,
    )
  }
  add('structure', 'chart-count', chartCount >= qualityBar.chartCount, `${chartCount}/${qualityBar.chartCount}`)
  add(
    'structure',
    'distinct-chart-types',
    chartTypes.length >= qualityBar.distinctChartTypeCount,
    `${chartTypes.length}/${qualityBar.distinctChartTypeCount}`,
  )
  add(
    'structure',
    'globe-scene-count',
    globeScenes.length === qualityBar.globeSceneCount,
    `${globeScenes.length}/${qualityBar.globeSceneCount}`,
  )
  add(
    'structure',
    'dashboard-scene-count',
    dashboardScenes.length <= qualityBar.dashboardSceneCountMax,
    `${dashboardScenes.length}/${qualityBar.dashboardSceneCountMax} max`,
  )
  add(
    'structure',
    'dashboard-scenes-localized',
    dominantCustomMaterialCount === qualityBar.dominantCustomMaterialCount &&
      totalDashboardSceneAreaRatio <= qualityBar.structuralHardGates.maxTotalDashboardSceneAreaRatio,
    `${dominantCustomMaterialCount} dominant, ${Math.round(totalDashboardSceneAreaRatio * 100)}% total area`,
  )
  add(
    'structure',
    'dashboard-scenes-only-special-regions',
    dashboardScenes.every(
      operation =>
        localizedDashboardScenePlacementIsAllowed(operation) &&
        dashboardSceneHasWidgetKind(operation, ['donut', 'needle', 'needle-bars', 'co2-needles']),
    ),
    `${dashboardScenes.filter(localizedDashboardScenePlacementIsAllowed).length}/${dashboardScenes.length} localized`,
  )
  for (const group of qualityBar.structuralHardGates.requiredContentGroups) {
    const matches = textContainsAll(value, group.keywords)
    add('structure', `content:${group.id}`, matches >= group.minimumMatches, `${matches}/${group.minimumMatches}`)
  }

  const globeRect = globe?.rect
  const globeCenter = globeRect ? rectCenter(globeRect) : null
  const globeBar = qualityBar.visualHardGates.globe
  const globeBackground = globeField(globe, 'background')
  const globeSolidBackground = globeField(globe, 'background')
  const globeShaderColors = ['oceanColor', 'landColor', 'atmosphereColor'].map(name => globeField(globe, name))
  const globeBackgroundColors = typeof globeBackground === 'string' ? parseColorSamples(globeBackground) : []
  const globeBackgroundIsDark = globeBackgroundColors.some(color => color.r <= 45 && color.g <= 60 && color.b <= 82)
  add(
    'visual',
    'dark-control-room-palette',
    darkSurfaceColorCount >= qualityBar.visualHardGates.minDarkSurfaceColorCount,
    `${darkSurfaceColorCount}/${qualityBar.visualHardGates.minDarkSurfaceColorCount}`,
  )
  add(
    'visual',
    'cyan-accent-palette',
    cyanAccentColorCount >= qualityBar.visualHardGates.minCyanAccentColorCount,
    `${cyanAccentColorCount}/${qualityBar.visualHardGates.minCyanAccentColorCount}`,
  )
  add(
    'visual',
    'globe-size-and-position',
    Boolean(
      globeRect &&
        globeCenter &&
        globeRect.width >= globeBar.minWidth &&
        globeRect.height >= globeBar.minHeight &&
        inRange(globeCenter.x, globeBar.centerX) &&
        inRange(globeCenter.y, globeBar.centerY),
    ),
    globeRect ? JSON.stringify(globeRect) : 'missing globe rect',
  )
  add(
    'visual',
    'globe-asia-camera',
    numericFieldInRange(globeField(globe, 'centerLongitude'), globeBar.centerLongitude) &&
      numericFieldInRange(globeField(globe, 'centerLatitude'), globeBar.centerLatitude),
    `longitude=${String(globeField(globe, 'centerLongitude'))}, latitude=${String(globeField(globe, 'centerLatitude'))}`,
  )
  add(
    'visual',
    'globe-starfield',
    finiteNumber(globeField(globe, 'starDensity')) &&
      (globeField(globe, 'starDensity') as number) >= globeBar.minStarDensity &&
      (globeField(globe, 'starDensity') as number) <= globeBar.maxStarDensity,
    `${String(globeField(globe, 'starDensity'))} in ${globeBar.minStarDensity}..${globeBar.maxStarDensity}`,
  )
  add(
    'visual',
    'globe-atmosphere-halo',
    !globeBar.requireAtmosphereColor ||
      (typeof globeField(globe, 'atmosphereColor') === 'string' &&
        String(globeField(globe, 'atmosphereColor')).trim().length > 0),
    String(globeField(globe, 'atmosphereColor') ?? 'missing'),
  )
  add(
    'visual',
    'globe-dark-background',
    !globeBar.requireDarkBackground || globeBackgroundIsDark,
    String(globeBackground ?? 'missing'),
  )
  add(
    'visual',
    'globe-solid-color-contract',
    !globeBar.requireSolidColors ||
      (typeof globeSolidBackground === 'string' &&
        SAFE_SOLID_COLOR_PATTERN.test(globeSolidBackground.trim()) &&
        globeShaderColors.every(value => typeof value === 'string' && SHADER_HEX_COLOR_PATTERN.test(value.trim()))),
    [globeSolidBackground, ...globeShaderColors].map(value => String(value ?? 'missing')).join(', '),
  )
  add(
    'visual',
    'globe-auto-rotate',
    (!globeBar.requireAutoRotate || hasBoolean(globeField(globe, 'autoRotate'), true)) &&
      finiteNumber(globeField(globe, 'rotationSpeed')) &&
      Math.abs(globeField(globe, 'rotationSpeed') as number) >= globeBar.minRotationSpeed,
    `autoRotate=${String(globeField(globe, 'autoRotate'))}, speed=${String(globeField(globe, 'rotationSpeed'))}`,
  )
  add(
    'visual',
    'globe-intro-motion',
    (!globeBar.requireIntroAnimation || hasBoolean(globeField(globe, 'introAnimation'), true)) &&
      (!globeBar.requireIntroLoop || hasBoolean(globeField(globe, 'introLoop'), true)) &&
      numericFieldInRange(globeField(globe, 'introDuration'), globeBar.introDuration),
    `animation=${String(globeField(globe, 'introAnimation'))}, loop=${String(globeField(globe, 'introLoop'))}, duration=${String(globeField(globe, 'introDuration'))}`,
  )
  add(
    'visual',
    'globe-scale',
    numericFieldInRange(globeField(globe, 'globeScale'), globeBar.globeScale),
    `${String(globeField(globe, 'globeScale'))} in ${globeBar.globeScale.join('..')}`,
  )
  add(
    'visual',
    'real-time-clock',
    count('DateTime') >= (qualityBar.componentCounts.DateTime ?? 1),
    `${count('DateTime')}/${qualityBar.componentCounts.DateTime ?? 1}`,
  )
  add(
    'visual',
    'left-top5-tracks',
    leftTop5Progress.length >= qualityBar.visualHardGates.leftTop5ProgressCount,
    `${leftTop5Progress.length}/${qualityBar.visualHardGates.leftTop5ProgressCount}`,
  )
  add(
    'visual',
    'left-land-use-cards',
    leftLandUseNumbers.length >= qualityBar.visualHardGates.leftLandUseNumberCount,
    `${leftLandUseNumbers.length}/${qualityBar.visualHardGates.leftLandUseNumberCount}`,
  )
  add('visual', 'left-life-index-rings', leftLifeIndexVisuals.length >= 1, `${leftLifeIndexVisuals.length}/1`)
  add(
    'visual',
    'right-resource-grid',
    rightResourceNumbers.length >= qualityBar.visualHardGates.rightResourceNumberCount,
    `${rightResourceNumbers.length}/${qualityBar.visualHardGates.rightResourceNumberCount}`,
  )
  add(
    'visual',
    'right-co2-needles',
    rightCo2Needles.length >= 4 || rightCo2CustomVisuals.length >= 1,
    `${rightCo2Needles.length} Progress, ${rightCo2CustomVisuals.length} localized custom`,
  )
  add('visual', 'right-atmosphere-ring', rightAtmosphereVisuals.length >= 1, `${rightAtmosphereVisuals.length}/1`)
  add(
    'visual',
    'center-bottom-earth-metrics',
    centerBottomNumbers.length >= qualityBar.visualHardGates.centerBottomNumberCount,
    `${centerBottomNumbers.length}/${qualityBar.visualHardGates.centerBottomNumberCount}`,
  )
  add(
    'visual',
    'animated-charts-and-numbers',
    animatedMaterialCount >= qualityBar.visualHardGates.minAnimatedMaterialCount,
    `${animatedMaterialCount}/${qualityBar.visualHardGates.minAnimatedMaterialCount}`,
  )
  add(
    'visual',
    'basic-interactions',
    interactiveMaterialCount >= qualityBar.visualHardGates.minInteractiveMaterialCount,
    `${interactiveMaterialCount}/${qualityBar.visualHardGates.minInteractiveMaterialCount}`,
  )

  add(
    'safety',
    'no-full-canvas-custom-material',
    fullCanvasCustomMaterialCount === qualityBar.fullCanvasCustomMaterialCount,
    `${fullCanvasCustomMaterialCount}/${qualityBar.fullCanvasCustomMaterialCount}`,
  )
  add(
    'safety',
    'no-dominant-custom-material',
    dominantCustomMaterialCount === qualityBar.dominantCustomMaterialCount,
    `${dominantCustomMaterialCount}/${qualityBar.dominantCustomMaterialCount}`,
  )
  add(
    'safety',
    'canvas-bounds',
    invalidRects.length === qualityBar.outOfBoundsMaterialCount,
    `${invalidRects.length}/${qualityBar.outOfBoundsMaterialCount}`,
  )
  add(
    'safety',
    'asset-independent-output',
    externalAssetReferenceCount === qualityBar.externalAssetReferenceCount,
    `${externalAssetReferenceCount}/${qualityBar.externalAssetReferenceCount}`,
  )
  add('safety', 'no-image-material', imageMaterials.length === 0, `${imageMaterials.length}/0`)
  add(
    'safety',
    'no-unsupported-custom-material',
    unsupportedCustomMaterials.length === 0,
    `${unsupportedCustomMaterials.length}/0`,
  )

  const hardGateSummary = (['structure', 'visual', 'safety'] as const).reduce(
    (summary, category) => {
      const categoryCriteria = criteria.filter(criterion => criterion.category === category)
      summary[category] = {
        passed: categoryCriteria.filter(criterion => criterion.passed).length,
        total: categoryCriteria.length,
      }
      return summary
    },
    {
      structure: { passed: 0, total: 0 },
      visual: { passed: 0, total: 0 },
      safety: { passed: 0, total: 0 },
    },
  )
  const passedCount = criteria.filter(criterion => criterion.passed).length
  const failureTags = criteria.filter(criterion => !criterion.passed).map(criterion => criterion.id)

  return {
    passed: failureTags.length === 0,
    score: criteria.length ? Math.round((passedCount / criteria.length) * 100) : 0,
    failureTags,
    criteria,
    hardGateSummary,
    evidence: {
      structuralContainerCount: structuralContainers.length,
      matchedStructuralGroups: [...matchedGroups.keys()],
      ordinaryMaterialCount: ordinaryMaterials.length,
      distinctOrdinaryMaterialTypeCount: distinctOrdinaryTypes.length,
      componentCounts,
      chartCount,
      distinctChartTypeCount: chartTypes.length,
      globeSceneCount: globeScenes.length,
      dashboardSceneCount: dashboardScenes.length,
      unsupportedCustomMaterialCount: unsupportedCustomMaterials.length,
      imageMaterialCount: imageMaterials.length,
      fullCanvasCustomMaterialCount,
      dominantCustomMaterialCount,
      outOfBoundsMaterialCount: invalidRects.length,
      externalAssetReferenceCount,
      darkSurfaceColorCount,
      cyanAccentColorCount,
      animatedMaterialCount,
      interactiveMaterialCount,
      moduleCounts: {
        leftTop5Progress: leftTop5Progress.length,
        leftLandUseNumbers: leftLandUseNumbers.length,
        rightResourceNumbers: rightResourceNumbers.length,
        centerBottomNumbers: centerBottomNumbers.length,
        rightCo2Needles: rightCo2Needles.length,
        leftLifeIndexVisuals: leftLifeIndexVisuals.length,
        rightAtmosphereVisuals: rightAtmosphereVisuals.length,
      },
    },
  }
}
