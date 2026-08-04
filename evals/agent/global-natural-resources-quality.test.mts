import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type GlobalNaturalResourcesBenchmark,
  evaluateGlobalNaturalResourcesDecision,
} from './global-natural-resources-quality.mts'

const benchmark = JSON.parse(
  readFileSync(new URL('./cases/global-natural-resources-v1.json', import.meta.url), 'utf8'),
) as GlobalNaturalResourcesBenchmark

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const material = (name: string) => `EasyEditorMaterials${name}`
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

const group = (title: string, componentRect: ReturnType<typeof rect>) =>
  insert('Div', componentRect, {
    'shared.title': title,
    'props.background': 'linear-gradient(135deg, #031428, #071c34)',
    'props.borderColor': '#21c9ff',
    'div.enterAnimation': 'fade',
    'div.enterDuration': 620,
  })

const text = (label: string, componentRect: ReturnType<typeof rect>) =>
  insert(material('Text'), componentRect, {
    'data.config': staticData([{ text: label }]),
    'props.color': '#d9f4ff',
  })

const number = (value: number, label: string, componentRect: ReturnType<typeof rect>) =>
  insert(material('NumberFlip'), componentRect, {
    'shared.title': label,
    'data.config': staticData([{ value }]),
    'props.color': '#8ee7ff',
  })

const progress = (value: number, label: string, componentRect: ReturnType<typeof rect>) =>
  insert(material('Progress'), componentRect, {
    'data.config': staticData([{ value }]),
    'props.label': label,
    'props.progressColor': '#24c9ff',
    'props.trackColor': '#102944',
  })

const passingDecision = {
  action: 'execute',
  summary: '用可编辑物料和可复用地球创建全球自然资源数据大屏',
  plan: ['按六个可见区域建立语义分组', '组合常规物料并加入可交互旋转地球'],
  operations: [
    { type: 'set', nodeId: 'page-home-root', fieldId: 'props.backgroundColor', value: '#020814' },
    group('页面装饰层', rect(0, 0, 1920, 1080)),
    group('头部', rect(40, 56, 1840, 104)),
    group('左侧数据', rect(40, 180, 470, 820)),
    group('中央地球', rect(510, 180, 900, 800)),
    group('右侧数据', rect(1420, 180, 460, 820)),
    group('底部指标', rect(800, 872, 610, 110)),
    text('全球自然资源数据可视化大屏', rect(270, 76, 900, 64)),
    text('国土面积TOP5', rect(72, 198, 340, 44)),
    text('用地详情 工业用地 农业用地 国家征用', rect(72, 492, 390, 44)),
    text('地球生命指数 哺乳动物 鱼类 两栖类 爬虫 鸟类', rect(72, 718, 390, 44)),
    text('自然资源 最长海岸线 最多岛屿 矿产价值 森林总量', rect(1450, 198, 390, 44)),
    text('CO2排放量 2014 2016 2018 2020 大气指数 氧气 气压 甲烷 酸雨', rect(1450, 480, 390, 52)),
    insert('DateTime', rect(1540, 82, 300, 48), {
      'shared.title': '实时日期时间',
      'dateTime.mode': 'datetime',
      'dateTime.timeFormat': 'hms',
      'dateTime.updateInterval': 'second',
      'dateTime.color': '#b9efff',
    }),
    progress(1707.5, '俄罗斯', rect(72, 250, 380, 38)),
    progress(997.1, '加拿大', rect(72, 296, 380, 38)),
    progress(960.1, '中国', rect(72, 342, 380, 38)),
    progress(936.4, '美国', rect(72, 388, 380, 38)),
    progress(854.7, '巴西', rect(72, 434, 380, 38)),
    number(1235, '工业用地', rect(72, 546, 120, 132)),
    number(1235, '农业用地', rect(216, 546, 120, 132)),
    number(1235, '国家征用', rect(360, 546, 120, 132)),
    insert(material('PieChart'), rect(72, 758, 398, 210), {
      'shared.title': '地球生命指数',
      'data.config': staticData([
        { name: '哺乳动物', value: 11 },
        { name: '鱼类', value: 25 },
        { name: '两栖类', value: 13 },
        { name: '爬虫', value: 17 },
        { name: '鸟类', value: 34 },
      ]),
      'props.innerRadius': 55,
      'props.showTooltip': true,
      'props.colors': ['#84e8ff', '#36bbff', '#49d7bd', '#8aa9bd', '#b8ec68'],
    }),
    insert('GlobeScene', rect(510, 180, 900, 760), {
      'shared.title': '亚洲视角旋转地球',
      'globeScene.background': '#020817',
      'globeScene.starDensity': 0.72,
      'globeScene.oceanColor': '#071d3d',
      'globeScene.landColor': '#17466b',
      'globeScene.atmosphereColor': '#34cfff',
      'globeScene.autoRotate': true,
      'globeScene.rotationSpeed': 0.8,
      'globeScene.introAnimation': true,
      'globeScene.introDuration': 2700,
      'globeScene.introLoop': false,
      'globeScene.centerLongitude': 105,
      'globeScene.centerLatitude': 28,
      'globeScene.globeScale': 1.08,
      'globeScene.markers': [],
    }),
    number(51006.79, '地球总面积', rect(930, 808, 310, 80)),
    number(14832, '陆地', rect(800, 892, 180, 74)),
    number(36175, '海洋', rect(1000, 892, 180, 74)),
    number(12756, '直径', rect(1200, 892, 180, 74)),
    number(9.09, '最长海岸线', rect(1450, 250, 190, 112)),
    number(22.18, '最多岛屿', rect(1660, 250, 190, 112)),
    number(28, '矿产价值', rect(1450, 380, 190, 112)),
    number(116.4, '森林总量', rect(1660, 380, 190, 112)),
    progress(328.4, '2014', rect(1450, 548, 78, 220)),
    progress(330.5, '2016', rect(1550, 548, 78, 220)),
    progress(340.5, '2018', rect(1650, 548, 78, 220)),
    progress(319.8, '2020', rect(1750, 548, 78, 220)),
    insert(material('PieChart'), rect(1460, 786, 380, 194), {
      'shared.title': '大气指数 氧气',
      'data.config': staticData([
        { name: '氧气', value: 78.2 },
        { name: '其他', value: 21.8 },
      ]),
      'props.innerRadius': 62,
      'props.showTooltip': true,
      'props.colors': ['#b9f36b', '#1e9fff'],
    }),
  ],
}

describe('global natural resources generation quality gate', () => {
  it('passes a three-column natural-resources cockpit composed from editable materials and GlobeScene', () => {
    const result = evaluateGlobalNaturalResourcesDecision(passingDecision, benchmark)

    expect(result.failureTags).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.score).toBe(100)
    expect(result.hardGateSummary).toEqual({
      structure: { passed: expect.any(Number), total: expect.any(Number) },
      visual: { passed: expect.any(Number), total: expect.any(Number) },
      safety: { passed: expect.any(Number), total: expect.any(Number) },
    })
    expect(result.evidence).toMatchObject({
      structuralContainerCount: 6,
      matchedStructuralGroups: ['decoration', 'header', 'left-data', 'center-globe', 'right-data', 'bottom-metrics'],
      globeSceneCount: 1,
      dashboardSceneCount: 0,
      fullCanvasCustomMaterialCount: 0,
      dominantCustomMaterialCount: 0,
      outOfBoundsMaterialCount: 0,
      externalAssetReferenceCount: 0,
    })
  })

  it('reads machine thresholds from the case qualityBar instead of using hidden constants', () => {
    const stricterBenchmark = structuredClone(benchmark)
    stricterBenchmark.qualityBar.ordinaryMaterialCount = 99
    stricterBenchmark.qualityBar.visualHardGates.minAnimatedMaterialCount = 99

    const result = evaluateGlobalNaturalResourcesDecision(passingDecision, stricterBenchmark)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toEqual(
      expect.arrayContaining(['structure:ordinary-material-count', 'visual:animated-charts-and-numbers']),
    )
  })

  it('fails when the reusable globe omits the Asia camera, halo, starfield, and 2.7 second motion contract', () => {
    const decision = structuredClone(passingDecision)
    const globe = decision.operations.find(
      operation => 'componentName' in operation && operation.componentName === 'GlobeScene',
    )
    expect(globe && 'fields' in globe).toBe(true)
    if (!globe || !('fields' in globe)) return
    globe.fields['globeScene.centerLongitude'] = -100
    globe.fields['globeScene.atmosphereColor'] = ''
    globe.fields['globeScene.starDensity'] = 0
    globe.fields['globeScene.introDuration'] = 900
    globe.fields['globeScene.introLoop'] = false

    const result = evaluateGlobalNaturalResourcesDecision(decision, benchmark)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toEqual(
      expect.arrayContaining([
        'visual:globe-asia-camera',
        'visual:globe-atmosphere-halo',
        'visual:globe-starfield',
        'visual:globe-intro-motion',
      ]),
    )
  })

  it('reads the normalized 0..1 star-density threshold at its boundary', () => {
    const belowThreshold = structuredClone(passingDecision)
    const belowThresholdGlobe = belowThreshold.operations.find(
      operation => 'componentName' in operation && operation.componentName === 'GlobeScene',
    )
    expect(belowThresholdGlobe && 'fields' in belowThresholdGlobe).toBe(true)
    if (!belowThresholdGlobe || !('fields' in belowThresholdGlobe)) return
    belowThresholdGlobe.fields['globeScene.starDensity'] = 0.59

    const failed = evaluateGlobalNaturalResourcesDecision(belowThreshold, benchmark)
    expect(failed.failureTags).toContain('visual:globe-starfield')

    belowThresholdGlobe.fields['globeScene.starDensity'] = 1.01
    const failedAboveCatalogMaximum = evaluateGlobalNaturalResourcesDecision(belowThreshold, benchmark)
    expect(failedAboveCatalogMaximum.failureTags).toContain('visual:globe-starfield')

    belowThresholdGlobe.fields['globeScene.starDensity'] = 0.6
    const passedAtBoundary = evaluateGlobalNaturalResourcesDecision(belowThreshold, benchmark)
    expect(passedAtBoundary.failureTags).not.toContain('visual:globe-starfield')
    expect(passedAtBoundary.passed).toBe(true)
  })

  it('rejects gradients in GlobeScene color fields and keeps them on the surrounding Div', () => {
    const decision = structuredClone(passingDecision)
    const globe = decision.operations.find(
      operation => 'componentName' in operation && operation.componentName === 'GlobeScene',
    )
    expect(globe && 'fields' in globe).toBe(true)
    if (!globe || !('fields' in globe)) return
    globe.fields['globeScene.background'] = 'radial-gradient(circle at 50% 48%, #071B35 0%, #030B19 48%, #01040C 100%)'

    const result = evaluateGlobalNaturalResourcesDecision(decision, benchmark)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toContain('visual:globe-solid-color-contract')
  })

  it('rejects an image-backed or full-canvas custom shortcut', () => {
    const decision = structuredClone(passingDecision)
    decision.operations.push(
      insert('DashboardScene', rect(0, 0, 1920, 1080), {
        'props.spec': {
          version: 1,
          canvas: { width: 1920, height: 1080 },
          header: { showHeader: false, showClock: false },
          widgets: [{ kind: 'donut', data: { rings: [] } }],
        },
      }),
      insert('Image', rect(0, 0, 1920, 1080), { 'props.src': 'https://example.com/reference.png' }),
    )

    const result = evaluateGlobalNaturalResourcesDecision(decision, benchmark)

    expect(result.passed).toBe(false)
    expect(result.failureTags).toEqual(
      expect.arrayContaining([
        'structure:dashboard-scenes-localized',
        'safety:no-full-canvas-custom-material',
        'safety:asset-independent-output',
        'safety:no-image-material',
        'safety:no-unsupported-custom-material',
      ]),
    )
  })
})
