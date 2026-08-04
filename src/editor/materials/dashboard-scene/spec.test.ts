import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import componentSource from './component.tsx?raw'
import {
  DASHBOARD_SCENE_MAX_WIDGETS,
  applyDashboardScenePrimaryWidgetData,
  bankFinancialSceneDemoSpec,
  defaultLocalizedDashboardSceneSpec,
  normalizeDashboardSceneSpec,
  resolveDashboardSceneComboMapData,
} from './spec'

const dataOf = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const stylesSource = readFileSync(new URL('./component.css', import.meta.url), 'utf8')

describe('DashboardScene spec', () => {
  it('ships a complete text-driven bank financial report benchmark', () => {
    const scene = bankFinancialSceneDemoSpec
    const kinds = scene.widgets.map(widget => widget.kind)
    const rollingTables = scene.widgets.filter(widget => widget.kind === 'table' && dataOf(widget.data).scroll === true)

    expect(scene.header.title).toBe('银行2022年度可视化财报')
    expect(scene.header.showHeader).toBe(true)
    expect(scene.header.showClock).toBe(true)
    expect(scene.widgets.filter(widget => widget.kind === 'kpi')).toHaveLength(3)
    expect(kinds).toEqual(expect.arrayContaining(['combo-map', 'table', 'rank', 'line', 'donut', 'cluster']))
    expect(rollingTables).toHaveLength(2)
    expect(scene.widgets.every(widget => widget.rect.x + widget.rect.width <= 1920)).toBe(true)
    expect(scene.widgets.every(widget => widget.rect.y + widget.rect.height <= 1080)).toBe(true)
    expect(JSON.stringify(scene)).not.toMatch(/https?:\/\/|data:image|\.png/iu)
  })

  it('defaults to one localized headerless auto-scrolling table', () => {
    const scene = defaultLocalizedDashboardSceneSpec
    const widget = scene.widgets[0]
    const data = dataOf(widget.data)

    expect(scene.canvas).toEqual({ width: 480, height: 280 })
    expect(scene.header).toMatchObject({ showHeader: false, showClock: false })
    expect(scene.widgets).toHaveLength(1)
    expect(widget).toMatchObject({ kind: 'table', rect: { x: 0, y: 0, width: 480, height: 280 } })
    expect(data.autoScroll).toBe(true)
    expect(data.rows).toHaveLength(6)
    expect(normalizeDashboardSceneSpec(undefined)).toMatchObject({
      canvas: { width: 480, height: 280 },
      header: { showHeader: true, showClock: true },
    })
  })

  it('normalizes a localized canvas and optional header', () => {
    const scene = normalizeDashboardSceneSpec({
      canvas: { width: 640, height: 360 },
      header: { showHeader: false, showClock: false },
      widgets: [
        {
          id: 'localized-kpi',
          kind: 'kpi',
          title: '局部指标',
          rect: { x: 600, y: 320, width: 200, height: 100 },
        },
      ],
    })

    expect(scene.canvas).toEqual({ width: 640, height: 360 })
    expect(scene.header.showHeader).toBe(false)
    expect(scene.header.showClock).toBe(false)
    expect(scene.widgets[0].rect).toEqual({ x: 600, y: 320, width: 40, height: 40 })
  })

  it('bounds malformed Agent input and accepts compact flattened widget fields', () => {
    const scene = normalizeDashboardSceneSpec({
      header: { title: 'x'.repeat(500), showClock: 'yes' },
      theme: { background: 'url(https://example.com/reference.png)', accent: '#cab078' },
      widgets: Array.from({ length: 100 }, (_, index) => ({
        id: `widget-${index}`,
        kind: index === 0 ? 'kpi' : index === 1 ? 'unknown' : 'table',
        title: 'y'.repeat(500),
        rect: { x: -100, y: 5_000, width: 9_000, height: Number.POSITIVE_INFINITY },
        value: 3023.34,
        rows: Array.from({ length: 100 }, () => ['a'.repeat(900)]),
        __proto__: { polluted: true },
      })),
    })

    expect(scene.header.title).toHaveLength(120)
    expect(scene.header.showClock).toBe(true)
    expect(scene.theme.background).toBe('#eef3f7')
    expect(scene.theme.accent).toBe('#cab078')
    expect(scene.widgets.length).toBeLessThanOrEqual(DASHBOARD_SCENE_MAX_WIDGETS)
    expect(scene.widgets.some(widget => widget.kind === 'kpi' && dataOf(widget.data).value === 3023.34)).toBe(true)
    expect(scene.widgets.some(widget => widget.kind === ('unknown' as never))).toBe(false)
    expect(scene.widgets.every(widget => widget.rect.x >= 0 && widget.rect.y >= 0)).toBe(true)
    expect(scene.widgets.every(widget => widget.rect.x + widget.rect.width <= 480)).toBe(true)
    expect(scene.widgets.every(widget => widget.rect.y + widget.rect.height <= 280)).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('keeps localized map, dual-ring, cluster, and dense-table data contracts renderable', () => {
    const scene = normalizeDashboardSceneSpec({
      widgets: [
        {
          id: 'map',
          kind: 'combo-map',
          data: {
            mapScale: 1.2,
            mapWidthPercent: 56,
            chartYDomain: [0, 900],
            chartYTicks: [0, 204, 408, 611, 815],
            regions: [{ name: '四川省', label: '四川', fill: '#d7192d', emphasis: true }],
            tabs: ['本月'],
            activeTab: '本月',
            legend: [{ label: '重点区域', color: '#d7192d' }],
            provinceTabs: ['四川省'],
            selectedProvince: '四川省',
            tabViews: {
              本月: {
                chart: [{ label: '02月', profit: 320, revenue: 680 }],
                legend: [{ label: '净利润', color: '#c6a36c' }],
              },
            },
            provinceViews: {
              四川省: { highlights: ['四川省'], regions: [{ name: '四川省', fill: '#d7192d' }] },
            },
          },
        },
        {
          id: 'donut',
          kind: 'donut',
          data: {
            rings: [{ items: [['外环', 60]] }, { items: [['内环', 40]] }],
            legendItems: [['合计', 100]],
            chartWidthPercent: 74,
            legendFontSize: 15,
          },
        },
        {
          id: 'cluster',
          kind: 'cluster',
          data: {
            centerItem: 'B',
            motion: 'none',
            items: [
              { id: 'A', label: 'A', x: 18, y: 30, size: 62, color: '#9ba5b4' },
              {
                id: 'B',
                label: 'B',
                x: 49,
                y: 52,
                size: 82,
                color: '#c6a36c',
                layers: [{ rotation: 45, scale: 1, opacity: 0.88 }],
              },
              'C',
            ],
          },
        },
        { id: 'table', kind: 'table', data: { rowHeight: 36, headerHeight: 34, fontSize: 16, rankIcons: true } },
      ],
    })

    expect(dataOf(scene.widgets[0].data)).toMatchObject({
      activeTab: '本月',
      selectedProvince: '四川省',
      mapScale: 1.2,
      mapWidthPercent: 56,
      chartYDomain: [0, 900],
      chartYTicks: [0, 204, 408, 611, 815],
    })
    expect(dataOf(dataOf(scene.widgets[0].data).tabViews).本月).toMatchObject({
      chart: [{ label: '02月', profit: 320, revenue: 680 }],
    })
    expect(dataOf(dataOf(scene.widgets[0].data).provinceViews).四川省).toMatchObject({ highlights: ['四川省'] })
    expect(dataOf(scene.widgets[1].data).rings).toHaveLength(2)
    expect(dataOf(scene.widgets[1].data)).toMatchObject({ chartWidthPercent: 74, legendFontSize: 15 })
    expect(dataOf(scene.widgets[2].data).centerItem).toBe('B')
    expect(dataOf(scene.widgets[2].data)).toMatchObject({
      motion: 'none',
      items: [
        { id: 'A', x: 18, y: 30, size: 62, color: '#9ba5b4' },
        { id: 'B', x: 49, y: 52, size: 82, color: '#c6a36c' },
        'C',
      ],
    })
    expect(dataOf(scene.widgets[3].data)).toMatchObject({
      rowHeight: 36,
      headerHeight: 34,
      fontSize: 16,
      rankIcons: true,
    })
    expect(componentSource).toMatch(/style=\{region\?\.fill \? \{ fill: region\.fill \} : undefined\}/u)
    expect(componentSource).toMatch(/boundedNumber\(data\.mapScale, 1, 1, 1\.25\)[\s\S]*scale\(\$\{mapScale\}\)/u)
    expect(componentSource).toMatch(
      /boundedNumber\(activeData\.mapWidthPercent, 55, 45, 68\)[\s\S]*chartYDomain[\s\S]*chartYTicks[\s\S]*--ds-combo-map-width/u,
    )
    expect(componentSource).toMatch(
      /dashboard-scene-combo-chart-panel[\s\S]*dashboard-scene-combo-tabs[\s\S]*CompactLegend[\s\S]*dashboard-scene-combo-chart/u,
    )
    expect(componentSource).toMatch(
      /aria-pressed=\{active === item\.key \|\| active === item\.label\}[\s\S]*onClick=\{\(\) => onChange\(item\.key\)\}/u,
    )
    expect(componentSource).toMatch(
      /resolveDashboardSceneComboMapData\(data,[\s\S]*MapView map=\{map\} data=\{activeData\}/u,
    )
    expect(stylesSource).toMatch(
      /dashboard-scene-combo-tabs button:focus-visible,[\s\S]*dashboard-scene-province-tabs button:focus-visible/u,
    )
    expect(componentSource).toMatch(/array\(data\.rings\)[\s\S]*slice\(0, 2\)/u)
    expect(componentSource).toMatch(/boundedNumber\(data\.chartWidthPercent, 66, 45, 85\)[\s\S]*legendFontSize/u)
    expect(componentSource).toMatch(/slice\(0, 7\)[\s\S]*centerItem[\s\S]*configuredLayers/u)
    expect(stylesSource).toMatch(/--ds-row-height[\s\S]*--ds-header-height/u)
    expect(stylesSource).toMatch(/font-size:\s*var\(--ds-table-font-size, 13px\)/u)
    expect(componentSource).toMatch(
      /import \{ Crown \} from 'lucide-react'[\s\S]*rankIcons[\s\S]*dashboard-scene-table-rank/u,
    )
    expect(stylesSource).toMatch(
      /dashboard-scene-table-rank[\s\S]*fill:\s*color-mix\(in srgb, currentColor 82%[\s\S]*dashboard-scene-table-row \.dashboard-scene-table-rank\.is-rank-1[\s\S]*#d1aa59/u,
    )
    expect(stylesSource).toMatch(/--ds-donut-legend-font-size/u)
    expect(stylesSource).toMatch(
      /dashboard-scene-cluster-layer[\s\S]*--ds-cluster-layer-size[\s\S]*--ds-cluster-layer-rotation[\s\S]*--ds-cluster-layer-scale/u,
    )
    expect(componentSource).toMatch(
      /boundedNumber\(item\.input\.x,[\s\S]*boundedNumber\(item\.input\.size,[\s\S]*layers\.map/u,
    )
  })

  it('resolves interactive combo-map views while preserving legacy data and province precedence', () => {
    const legacyChart = [{ label: '一月', profit: 1, revenue: 2 }]
    const resolved = resolveDashboardSceneComboMapData(
      {
        chart: legacyChart,
        legend: ['默认'],
        highlights: ['默认区域'],
        tabViews: {
          solvency: { chart: [{ label: '一月', profit: 20, revenue: 30 }], legend: ['偿债能力'] },
        },
        provinceViews: {
          浙江: { highlights: ['浙江'], legend: ['浙江口径'] },
        },
      },
      { tabKey: 'solvency', tabLabel: '偿债能力', provinceKey: 'zhejiang', provinceLabel: '浙江' },
    )

    expect(resolved).toMatchObject({
      chart: [{ label: '一月', profit: 20, revenue: 30 }],
      legend: ['浙江口径'],
      highlights: ['浙江'],
    })
    expect(resolveDashboardSceneComboMapData({ chart: legacyChart }, {})).toMatchObject({ chart: legacyChart })
  })

  it('safely overrides only primary widget data without replacing the scene spec', () => {
    const scene = normalizeDashboardSceneSpec({
      canvas: { width: 960, height: 540 },
      header: { title: '保留标题', showHeader: false },
      theme: { accent: '#d7192d' },
      widgets: [
        {
          id: 'primary-map',
          kind: 'combo-map',
          title: '地图图表',
          rect: { x: 20, y: 30, width: 600, height: 420 },
          data: { chart: [{ label: '基础', profit: 1 }], activeTab: '业绩表现' },
        },
        {
          id: 'secondary-table',
          kind: 'table',
          title: '明细',
          rect: { x: 640, y: 30, width: 280, height: 420 },
          data: { rows: [['保留']] },
        },
      ],
    })

    const result = applyDashboardScenePrimaryWidgetData(scene, {
      ...JSON.parse('{"__proto__":{"polluted":true}}'),
      activeTab: '偿债能力',
      tabViews: { solvency: { chart: [{ label: '一月', profit: 20 }] } },
      provinceViews: { 浙江: { highlights: ['浙江'] } },
      oversized: 'x'.repeat(900),
    })

    expect(result).not.toBe(scene)
    expect(result.canvas).toBe(scene.canvas)
    expect(result.header).toBe(scene.header)
    expect(result.theme).toBe(scene.theme)
    expect(result.map).toBe(scene.map)
    expect(result.widgets[0]).toMatchObject({
      id: 'primary-map',
      kind: 'combo-map',
      title: '地图图表',
      rect: { x: 20, y: 30, width: 600, height: 420 },
      data: {
        chart: [{ label: '基础', profit: 1 }],
        activeTab: '偿债能力',
        tabViews: { solvency: { chart: [{ label: '一月', profit: 20 }] } },
        provinceViews: { 浙江: { highlights: ['浙江'] } },
        oversized: 'x'.repeat(512),
      },
    })
    expect(result.widgets[0].rect).toBe(scene.widgets[0].rect)
    expect(result.widgets[1]).toBe(scene.widgets[1])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('preserves optional line detail controls and supports chrome-free line and donut widgets', () => {
    const scene = normalizeDashboardSceneSpec({
      widgets: [
        {
          id: 'line-detail',
          kind: 'line',
          title: '趋势',
          chrome: 'none',
          showLegend: true,
          showYAxis: false,
          showAllXTicks: true,
          horizontalGrid: false,
          yDomain: [0, 100],
          yTicks: [0, 25, 50, 75, 100],
          verticalGrid: true,
          dotRadius: 5,
          series: [{ key: 'value', label: '余额', color: '#d7192d' }],
          rows: [{ label: '一月', value: 42 }],
        },
        { id: 'donut-detail', kind: 'donut', title: '结构', chrome: 'none', data: { items: [['存款', 60]] } },
        { id: 'legacy-line', kind: 'line', title: '旧折线', categories: ['一月'], series: [{ values: [1] }] },
      ],
    })

    expect(scene.widgets[0].chrome).toBe('none')
    expect(dataOf(scene.widgets[0].data)).toMatchObject({
      showLegend: true,
      showYAxis: false,
      showAllXTicks: true,
      horizontalGrid: false,
      yDomain: [0, 100],
      yTicks: [0, 25, 50, 75, 100],
      verticalGrid: true,
      dotRadius: 5,
    })
    expect(dataOf(scene.widgets[0].data).chrome).toBeUndefined()
    expect(scene.widgets[1].chrome).toBe('none')
    expect(scene.widgets[2].chrome).toBeUndefined()
    expect(dataOf(scene.widgets[2].data)).toMatchObject({ categories: ['一月'], series: [{ values: [1] }] })
    expect(dataOf(scene.widgets[2].data).chrome).toBeUndefined()
    expect(componentSource).toMatch(/showLegend[\s\S]*dashboard-scene-line-legend[\s\S]*item\.color[\s\S]*item\.label/u)
    expect(componentSource).toMatch(/horizontal=\{horizontalGrid\}[\s\S]*interval=\{showAllXTicks \? 0 : undefined\}/u)
    expect(componentSource).toMatch(
      /showYAxis \? \([\s\S]*domain=\{yDomain\}[\s\S]*interval=\{yTicks\.length \? 0 : undefined\}[\s\S]*ticks=\{yTicks\.length[\s\S]*dot=\{\{ r: dotRadius \}\}/u,
    )
    expect(componentSource).toMatch(/data-dashboard-scene-chrome=\{widget\.chrome \?\? 'default'\}/u)
    expect(stylesSource).toMatch(
      /dashboard-scene-widget\.is-chrome-none\[data-dashboard-scene-chrome="none"\][\s\S]*padding:\s*0[\s\S]*border:\s*0[\s\S]*background:\s*transparent[\s\S]*box-shadow:\s*none/u,
    )
    expect(stylesSource).toMatch(
      /dashboard-scene-widget\.is-chrome-none \.dashboard-scene-widget-heading[\s\S]*display:\s*none/u,
    )
    expect(stylesSource).toMatch(
      /dashboard-scene-widget\.is-chrome-none \.dashboard-scene-chart[\s\S]*height:\s*100%[\s\S]*padding-top:\s*0/u,
    )
  })
})
