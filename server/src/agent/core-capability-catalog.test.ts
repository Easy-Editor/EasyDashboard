import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_AGENT_CORE_CAPABILITIES,
  renderDashboardAgentCoreCapabilities,
  selectDashboardAgentSkillManifest,
} from './core-capability-catalog.js'

describe('Dashboard Agent capability boundaries', () => {
  it('treats attachments and visual references as core capabilities instead of Skills', () => {
    expect(DASHBOARD_AGENT_CORE_CAPABILITIES.map(capability => capability.id)).toContain('reference-understanding')
    expect(renderDashboardAgentCoreCapabilities()).toContain('附件和参考图')
    expect(selectDashboardAgentSkillManifest('参考这张图片调整大屏').skills).toEqual([])
  })

  it('keeps only low-frequency specialist work in the Skill catalog', () => {
    expect(selectDashboardAgentSkillManifest('接入实时 API 数据源').skills.map(skill => skill.id)).toEqual([
      'data-source-design',
    ])
    expect(selectDashboardAgentSkillManifest('制作 GIS 三维地图').skills.map(skill => skill.id)).toEqual([
      'gis-3d-design',
    ])
    expect(selectDashboardAgentSkillManifest('用沙箱自定义组件实现特殊效果').skills.map(skill => skill.id)).toEqual([
      'sandbox-custom-component',
    ])
    expect(selectDashboardAgentSkillManifest('发布这个大屏').skills.map(skill => skill.id)).toEqual([
      'dashboard-publishing',
    ])
    expect(selectDashboardAgentSkillManifest('清洗这批异常明细数据').skills.map(skill => skill.id)).toEqual([
      'specialized-data-cleaning',
    ])
  })

  it('does not route negated data-source phrases to the specialist', () => {
    const prompts = [
      '使用清晰的演示数据，不得声称接入真实接口',
      '暂不接入 API 数据源，先把大屏布局完成',
      '当前无需配置数据库',
      '真实接口尚未接入',
    ]

    for (const prompt of prompts) {
      expect(selectDashboardAgentSkillManifest(prompt).skills).toEqual([])
    }

    expect(
      selectDashboardAgentSkillManifest(
        '创建全球自然资源数据可视化大屏，使用清晰的演示数据，不得声称接入真实接口',
      ).skills.map(skill => skill.id),
    ).toEqual(['gis-3d-design'])

    expect(
      selectDashboardAgentSkillManifest('不要伪造真实接口，改为接入 CSV 数据源').skills.map(skill => skill.id),
    ).toEqual(['data-source-design'])
  })

  it('routes explicit globe and spatial-stage requests to the GIS/3D specialist', () => {
    const prompts = [
      '中央放一个缓慢自转、带大气层的地球',
      '做一个星空粒子里的三维球体主视觉',
      '展示全球资源',
      '创建全球自然资源数据可视化大屏',
      '构建 GIS 空间场景并展示资源点',
    ]

    for (const prompt of prompts) {
      const manifest = selectDashboardAgentSkillManifest(prompt)
      expect(manifest.skills.map(skill => `${skill.id}@${skill.version}`)).toEqual(['gis-3d-design@1.1.0'])
      expect(manifest.skills[0]?.instructions).toEqual(
        expect.arrayContaining([
          expect.stringContaining('普通世界地图使用 GeoMap'),
          expect.stringContaining('优先使用 GlobeScene'),
          expect.stringContaining('只承载中央地球舞台'),
          expect.stringContaining('局部 DashboardScene'),
          expect.stringContaining('禁止用整屏自定义组件'),
        ]),
      )
    }
  })

  it('keeps ordinary world maps and non-spatial global summaries on core materials', () => {
    const prompts = [
      '制作普通世界地图，展示各国销售额',
      '世界地图加散点',
      '全球销售额世界地图',
      '全球资源排名表',
      '全球自然资源数据统计表',
    ]

    for (const prompt of prompts) {
      expect(selectDashboardAgentSkillManifest(prompt).skills).toEqual([])
    }
  })
})
