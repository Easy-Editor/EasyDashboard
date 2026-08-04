import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_AGENT_LINKED_PIE_CHART_CATALOG_VERSION,
  DASHBOARD_AGENT_MATERIAL_CATALOG,
  DASHBOARD_AGENT_MATERIAL_CATALOG_VERSION,
  renderDashboardAgentMaterialCatalog,
} from './dashboard-material-catalog.js'

describe('dashboard Agent material catalog', () => {
  it('exposes GlobeScene as a strict central-stage material rather than an image or whole-screen fallback', () => {
    const globe = DASHBOARD_AGENT_MATERIAL_CATALOG.materials.find(material => material.componentName === 'GlobeScene')

    expect(DASHBOARD_AGENT_MATERIAL_CATALOG_VERSION).toBe('3.10.0')
    expect(globe).toMatchObject({
      category: 'map-stage',
      insertable: true,
      writableFields: {
        'globeScene.markers': {
          type: 'array',
          maxItems: 24,
        },
        'globeScene.surfaceBrightness': { minimum: 0.35, maximum: 1.2 },
        'globeScene.ambientLight': { minimum: 0.04, maximum: 0.5 },
        'globeScene.daylightIntensity': { minimum: 0.3, maximum: 1.4 },
        'globeScene.lightAzimuth': { minimum: -180, maximum: 180 },
        'shared.rect': expect.any(Object),
        'shared.title': expect.any(Object),
        'shared.visibility': expect.any(Object),
      },
    })
    expect(globe && 'guidance' in globe ? globe.guidance.join(' ') : '').toContain('只用于中央地球舞台')
    expect(globe && 'guidance' in globe ? globe.guidance.join(' ') : '').toContain('禁止把 GlobeScene 拉伸为整屏背景')
  })

  it('renders the strict marker contract and staged Div entrance fields for the model', () => {
    const rendered = renderDashboardAgentMaterialCatalog()

    expect(rendered).toContain('GlobeScene[insertable,map-stage]')
    expect(rendered).toContain('globeScene.markers<array<=24 of strict object')
    expect(rendered).toContain('no additional fields, URLs, paths, shader or JavaScript')
    expect(rendered).toContain('div.enterAnimation<string,enum="none"|"fade"|"slide-left"|"slide-right"|"rise">')
    expect(rendered).toContain('div.enterDuration<number,range=100..10000,multipleOf=50>')
    expect(rendered).toContain('div.visualPreset<string,enum="none"|"hud-panel"|"metric-axis"|"corner-frame">')
    expect(rendered).toContain('DashboardIcon[insertable]')
    expect(rendered).toContain('dashboardIcon.icon<string,enum="factory"|"sprout"|"government"')
    expect(rendered).toContain('props.displayStyle<string,enum="standard"|"ranking-track">')
    expect(rendered).not.toContain('concentric-rings')
    expect(rendered).not.toContain('tilted-donut')
    expect(rendered).not.toContain('props.ringWidth')
    expect(rendered).not.toContain('props.tiltRatio')
    expect(rendered).toContain('HUD 不得作为 GlobeScene 子内容随地球缩放')
    expect(rendered).toContain('lightAzimuth<number,range=-180..180,multipleOf=1>')
    expect(rendered).toContain('需要 GIF 式强昼夜层次时')
    expect(rendered).toContain(
      'globeScene.background<safe-solid-color only; use outer Div props.background for gradients; never use linear-gradient or radial-gradient>',
    )
    expect(rendered).toContain(
      'globeScene.atmosphereColor<hex-color only (#RGB, #RGBA, #RRGGBB or #RRGGBBAA); never use rgb, hsl or gradients>',
    )
    expect(rendered).toContain('禁止把 gradient 写入 GlobeScene 颜色字段')
  })

  it('exposes PieChart 0.0.8-only styles only for the explicit linked-material capability', () => {
    const rendered = renderDashboardAgentMaterialCatalog({ linkedPieChartStyles: true })

    expect(rendered).toContain(`version=${DASHBOARD_AGENT_LINKED_PIE_CHART_CATALOG_VERSION}`)
    expect(rendered).toContain('props.displayStyle<string,enum="standard"|"concentric-rings"|"tilted-donut">')
    expect(rendered).toContain('props.ringWidth<number,range=1..18,multipleOf=1>')
    expect(rendered).toContain('props.tiltRatio<number,range=0.25..1,multipleOf=0.05>')
    expect(rendered).toContain('Use displayStyle=concentric-rings')
    expect(rendered).toContain('Use displayStyle=tilted-donut')
  })
})
