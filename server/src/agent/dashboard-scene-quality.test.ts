import { describe, expect, it } from 'vitest'
import { evaluateBankFinancialSceneDecision } from './dashboard-scene-quality.js'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const remoteMaterial = (displayName: string) => `EasyEditorMaterials${displayName}`
const staticData = (rows: Array<Record<string, unknown>>) => ({ sourceType: 'static', staticData: rows })

const insert = (
  componentName: string,
  componentRect: ReturnType<typeof rect>,
  fields: Record<string, unknown> = {},
) => ({
  type: 'insert',
  parentId: 'page-home-root',
  componentName,
  fields: { 'shared.rect': componentRect, ...fields },
})

const localizedAutoScrollSpec = (width: number, height: number) => ({
  version: 1,
  canvas: { width, height },
  header: { title: '', subtitle: '', brand: '', showHeader: false, showClock: false },
  widgets: [
    {
      id: 'rolling-table',
      kind: 'table',
      title: '实时明细',
      rect: { x: 0, y: 0, width, height },
      data: {
        autoScroll: true,
        columns: ['排行', '名称'],
        rows: [
          [1, 'A'],
          [2, 'B'],
          [3, 'C'],
          [4, 'D'],
          [5, 'E'],
        ],
      },
    },
  ],
})

const localizedWidgetSpec = (
  width: number,
  height: number,
  kind: 'combo-map' | 'cluster' | 'line' | 'donut' | 'rank',
  data: Record<string, unknown>,
) => ({
  version: 1,
  canvas: { width, height },
  header: { title: '', subtitle: '', brand: '', showHeader: false, showClock: false },
  widgets: [{ id: `localized-${kind}`, kind, title: '', rect: { x: 0, y: 0, width, height }, data }],
})

const passingDecision = {
  action: 'execute',
  summary: '用可独立选择的物料创建银行年度可视化财报',
  plan: ['建立财报构图', '配置图表与列表数据'],
  operations: [
    { type: 'set', nodeId: 'page-home-root', fieldId: 'props.backgroundColor', value: '#eef3f7' },
    insert('Div', rect(48, 24, 1824, 78), { 'shared.title': 'Header' }),
    insert('Div', rect(48, 126, 1308, 160), { 'shared.title': 'KPI' }),
    insert('Div', rect(48, 314, 864, 390), { 'shared.title': 'Left' }),
    insert('Div', rect(936, 314, 420, 390), { 'shared.title': 'Center' }),
    insert('Div', rect(1380, 126, 492, 578), { 'shared.title': 'Right' }),
    insert('Div', rect(48, 734, 1824, 270), { 'shared.title': 'Bottom' }),
    insert(remoteMaterial('Text'), rect(48, 32, 1300, 64), {
      'data.config': staticData([{ text: '银行2022年度可视化财报' }]),
    }),
    insert(remoteMaterial('Text'), rect(1500, 32, 372, 64), {
      'data.config': staticData([{ text: '2022-12-31 18:30:00' }]),
    }),
    insert(remoteMaterial('NumberFlip'), rect(48, 126, 420, 160), {
      'data.config': staticData([{ value: 3023.34 }]),
    }),
    insert(remoteMaterial('NumberFlip'), rect(492, 126, 420, 160), {
      'data.config': staticData([{ value: 1023.43 }]),
    }),
    insert(remoteMaterial('NumberFlip'), rect(936, 126, 420, 160), {
      'data.config': staticData([{ value: 1124.65 }]),
    }),
    insert(remoteMaterial('GeoMap'), rect(48, 314, 520, 390), {
      'data.config': staticData([{ name: '浙江', value: 605 }]),
    }),
    insert(remoteMaterial('BarChart'), rect(580, 314, 332, 390), {
      'data.config': staticData([{ name: '浙江', value1: 605 }]),
    }),
    insert(remoteMaterial('ScrollList'), rect(936, 314, 420, 390), {
      'data.config': staticData(
        Array.from({ length: 8 }, (_, index) => ({
          rank: index + 1,
          name: `商户${index + 1}`,
          value: 34212 - index * 1000,
        })),
      ),
    }),
    insert(remoteMaterial('Progress'), rect(1380, 126, 492, 578), {
      'data.config': staticData([{ value: 82 }]),
    }),
    insert(remoteMaterial('LineChart'), rect(48, 734, 420, 270), {
      'data.config': staticData([{ name: '1月', value1: 42 }]),
    }),
    insert(remoteMaterial('ScrollList'), rect(492, 734, 420, 270), {
      'data.config': staticData(
        Array.from({ length: 7 }, (_, index) => ({ rank: index + 1, name: `理财${index + 1}`, value: 98 - index })),
      ),
    }),
    insert(remoteMaterial('PieChart'), rect(936, 734, 420, 270), {
      'data.config': staticData([{ name: '手机银行', value: 42 }]),
    }),
    insert(remoteMaterial('Progress'), rect(1380, 734, 492, 270), {
      'data.config': staticData([{ value: 95 }]),
    }),
  ],
}

describe('bank financial material-composition quality gate', () => {
  it('passes a bank dashboard composed from multiple selectable material nodes and types', () => {
    const result = evaluateBankFinancialSceneDecision(passingDecision)

    expect(result.failureTags).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.score).toBe(100)
    expect(result.evidence).toMatchObject({
      dashboardSceneCount: 0,
      structuralContainerCount: 6,
      ordinaryMaterialCount: 13,
      distinctOrdinaryMaterialTypeCount: 8,
      chartCount: 3,
      distinctChartTypeCount: 3,
      customMaterialCount: 0,
      unsupportedCustomMaterialCount: 0,
      invalidLocalCustomSpecCount: 0,
      unsafeExistingCustomMutationCount: 0,
      fullCanvasCustomMaterialCount: 0,
      dominantCustomMaterialCount: 0,
      outOfBoundsMaterialCount: 0,
      externalAssetReferenceCount: 0,
    })
    expect(result.evidence.componentCounts).toMatchObject({
      Text: 2,
      NumberFlip: 3,
      GeoMap: 1,
      ScrollList: 2,
      BarChart: 1,
      LineChart: 1,
      PieChart: 1,
      Progress: 2,
    })
  })

  it('requires six structural Div containers for the bank dashboard regions', () => {
    const decision = structuredClone(passingDecision)
    const divIndex = decision.operations.findIndex(
      operation => 'componentName' in operation && operation.componentName === 'Div',
    )
    decision.operations.splice(divIndex, 1)

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toContain('STRUCTURAL_CONTAINER_REQUIRED')
    expect(result.evidence.structuralContainerCount).toBe(5)
    expect(result.evidence.ordinaryMaterialCount).toBe(13)
    expect(result.evidence.customMaterialCount).toBe(0)
  })

  it('keeps legacy short component names compatible with normalized evidence', () => {
    const decision = structuredClone(passingDecision)
    decision.operations = decision.operations.map(operation => {
      if (!('componentName' in operation) || !operation.componentName.startsWith('EasyEditorMaterials'))
        return operation
      return { ...operation, componentName: operation.componentName.replace('EasyEditorMaterials', '') }
    })

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(true)
    expect(result.evidence.componentCounts).toMatchObject({ Text: 2, NumberFlip: 3, ScrollList: 2 })
  })

  it('treats the local DateTime clock as an ordinary dashboard material', () => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(
      insert('DateTime', rect(1540, 32, 260, 52), {
        'dateTime.mode': 'time',
        'dateTime.timeFormat': 'hms',
        'dateTime.timeZone': 'Asia/Shanghai',
      }),
    )

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(true)
    expect(result.evidence.componentCounts.DateTime).toBe(1)
    expect(result.evidence.unsupportedCustomMaterialCount).toBe(0)
  })

  it('rejects one full-canvas DashboardScene even when its internal spec is complete', () => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(
      insert('DashboardScene', rect(0, 0, 1920, 1080), {
        'props.spec': localizedAutoScrollSpec(1920, 1080),
      }),
    )
    decision.plan.push('现有物料不支持连续无缝滚动，因此仅对局部列表使用 DashboardScene')
    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toEqual(
      expect.arrayContaining(['FULL_CANVAS_CUSTOM_MATERIAL', 'DOMINANT_CUSTOM_MATERIAL']),
    )
    expect(result.evidence).toMatchObject({
      dashboardSceneCount: 1,
      ordinaryMaterialCount: 13,
      customMaterialCount: 1,
      fullCanvasCustomMaterialCount: 1,
      dominantCustomMaterialCount: 1,
    })
  })

  it('allows a localized custom material when ordinary materials remain the composition', () => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(
      insert('DashboardScene', rect(1500, 40, 360, 240), { 'props.spec': localizedAutoScrollSpec(360, 240) }),
    )
    decision.plan.push('现有 ScrollList 不支持连续无缝滚动，因此仅对局部列表使用 DashboardScene')

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(true)
    expect(result.evidence).toMatchObject({
      dashboardSceneCount: 1,
      customMaterialCount: 1,
      fullCanvasCustomMaterialCount: 0,
      dominantCustomMaterialCount: 0,
      invalidLocalCustomSpecCount: 0,
    })
  })

  it.each([
    [
      'combo-map',
      localizedWidgetSpec(360, 240, 'combo-map', {
        highlights: ['浙江'],
        chart: [{ label: '02月', profit: 350, revenue: 680 }],
      }),
    ],
    ['cluster', localizedWidgetSpec(360, 240, 'cluster', { items: ['网点优势', '客户基础'] })],
    [
      'line',
      localizedWidgetSpec(360, 240, 'line', {
        xKey: 'label',
        rows: [
          { label: '02月', fixed: 350, current: 680 },
          { label: '04月', fixed: 315, current: 520 },
        ],
        series: [
          { key: 'fixed', label: '定期', color: '#c6a36c' },
          { key: 'current', label: '活期', color: '#b85d5d' },
        ],
        showLegend: true,
        yDomain: [0, 850],
        yTicks: [0, 204, 408, 611, 815],
        verticalGrid: true,
        dotRadius: 3,
        animate: true,
      }),
    ],
    [
      'donut',
      localizedWidgetSpec(360, 240, 'donut', {
        rings: [
          {
            items: [
              ['网上银行', 18],
              ['手机银行', 42],
            ],
            innerRadius: 66,
            outerRadius: 86,
          },
          {
            items: [
              ['微信银行', 22],
              ['电话银行', 11],
            ],
            innerRadius: 38,
            outerRadius: 57,
          },
        ],
      }),
    ],
  ])('allows a localized %s capability-gap widget', (_kind, spec) => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(insert('DashboardScene', rect(1500, 40, 360, 240), { 'props.spec': spec }))
    decision.plan.push('现有物料无法表达该局部复合效果，因此仅对该区域使用 DashboardScene')

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(true)
    expect(result.evidence.invalidLocalCustomSpecCount).toBe(0)
  })

  it('rejects every unknown component instead of treating it as a custom fallback', () => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(insert('CustomReport', rect(100, 100, 240, 180)))

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toContain('UNSUPPORTED_CUSTOM_MATERIAL')
    expect(result.evidence.unsupportedCustomMaterialCount).toBe(1)
  })

  it.each([
    ['missing spec', undefined],
    ['visible header', { ...localizedAutoScrollSpec(360, 240), header: { showHeader: true, showClock: false } }],
    ['mismatched canvas', localizedAutoScrollSpec(480, 280)],
    [
      'non-scrolling widget',
      {
        ...localizedAutoScrollSpec(360, 240),
        widgets: [
          {
            ...localizedAutoScrollSpec(360, 240).widgets[0],
            data: { autoScroll: false, rows: [[1], [2], [3], [4]] },
          },
        ],
      },
    ],
    ['unsupported widget kind', localizedWidgetSpec(360, 240, 'rank', { items: [['A', 10]] })],
    ['empty combo-map data', localizedWidgetSpec(360, 240, 'combo-map', { chart: [] })],
    ['empty cluster data', localizedWidgetSpec(360, 240, 'cluster', { items: [] })],
    ['empty line data', localizedWidgetSpec(360, 240, 'line', { rows: [], series: [] })],
    ['empty donut data', localizedWidgetSpec(360, 240, 'donut', { rings: [] })],
  ])('rejects a localized DashboardScene with %s', (_label, spec) => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(insert('DashboardScene', rect(1500, 40, 360, 240), spec ? { 'props.spec': spec } : {}))
    decision.plan.push('现有 ScrollList 不支持连续无缝滚动，因此仅对局部列表使用 DashboardScene')

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toContain('INVALID_LOCAL_CUSTOM_SPEC')
    expect(result.evidence.invalidLocalCustomSpecCount).toBe(1)
  })

  it('requires an explicit plan rationale for the local capability gap', () => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(
      insert('DashboardScene', rect(1500, 40, 360, 240), { 'props.spec': localizedAutoScrollSpec(360, 240) }),
    )

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toContain('LOCAL_CUSTOM_CAPABILITY_GAP_REQUIRED')
  })

  it('rejects unverifiable set and resize paths that could enlarge an existing DashboardScene', () => {
    const decision = structuredClone(passingDecision)
    const operations = decision.operations as Array<Record<string, unknown>>
    operations.push(
      { type: 'set', nodeId: 'existing-custom', fieldId: 'props.spec', value: localizedAutoScrollSpec(360, 240) },
      { type: 'resize', nodeId: 'existing-custom', rect: rect(0, 0, 1920, 1080) },
    )

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toContain('UNSAFE_EXISTING_CUSTOM_MUTATION')
    expect(result.evidence.unsafeExistingCustomMutationCount).toBe(2)
  })

  it('allows bounded primary widget data overrides on an existing DashboardScene', () => {
    const decision = structuredClone(passingDecision)
    const operations = decision.operations as Array<Record<string, unknown>>
    operations.push({
      type: 'set',
      nodeId: 'existing-custom',
      fieldId: 'props.widgetData',
      value: {
        activeTab: '业绩表现',
        tabViews: {
          业绩表现: { chart: [{ label: '02', profit: 350, revenue: 680 }] },
        },
      },
    })

    const result = evaluateBankFinancialSceneDecision(decision)
    expect(result.evidence.unsafeExistingCustomMutationCount).toBe(0)
    expect(result.failureTags).not.toContain('UNSAFE_EXISTING_CUSTOM_MUTATION')
  })

  it('treats a Div child rect as canvas-global rather than parent-local', () => {
    const decision = structuredClone(passingDecision)
    const nestedMaterial = decision.operations.find(
      operation =>
        'componentName' in operation && operation.componentName === remoteMaterial('Progress') && operation.fields,
    )
    if (!nestedMaterial || !('parentId' in nestedMaterial)) throw new Error('expected nested material fixture')
    nestedMaterial.parentId = 'existing-right-panel'

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(true)
    expect(result.criteria).toContainEqual(
      expect.objectContaining({ id: 'canvas-global-material-bounds', passed: true }),
    )
  })

  it('rejects incomplete compositions and external image dependencies', () => {
    const decision = structuredClone(passingDecision)
    decision.operations = decision.operations.filter(
      operation =>
        !('componentName' in operation) ||
        !['EasyEditorMaterialsGeoMap', 'EasyEditorMaterialsScrollList', 'EasyEditorMaterialsProgress'].includes(
          operation.componentName,
        ),
    )
    decision.operations.push(
      insert('Text', rect(48, 48, 420, 120), { 'props.background': 'https://example.com/report.png' }),
    )

    const result = evaluateBankFinancialSceneDecision(decision)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toEqual(
      expect.arrayContaining([
        'GEO_MAP_REQUIRED',
        'SCROLL_LIST_REQUIRED',
        'PROGRESS_REQUIRED',
        'EXTERNAL_ASSET_REFERENCE',
      ]),
    )
  })
})
