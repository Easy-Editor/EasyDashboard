import { describe, expect, it } from 'vitest'
import {
  type SkillRegistryError,
  createSkillRegistry,
  createSkillTaskManifest,
  resolveBuiltInSkill,
} from './skill-registry.js'

const capabilities = ['project.read', 'datasource.read.existing', 'preview.verify']

function skill(version: string, required = ['project.read'] as string[]) {
  return {
    id: 'gis.audit',
    version,
    title: 'GIS 数据检查',
    description: '检查项目内已有 GIS 数据绑定。',
    instructions: ['读取项目结构', '输出检查结果'],
    capabilities: required,
    source: 'platform' as const,
  }
}

describe('platform Skill registry', () => {
  it('resolves an exact version and defaults to the latest built-in version', () => {
    const registry = createSkillRegistry({
      capabilityCatalog: capabilities,
      skills: [skill('1.2.0'), skill('2.0.0')],
    })

    expect(resolveBuiltInSkill(registry, { id: 'gis.audit', version: '1.2.0' }).auditRef).toBe('gis.audit@1.2.0')
    expect(resolveBuiltInSkill(registry, { id: 'gis.audit' }).auditRef).toBe('gis.audit@2.0.0')
  })

  it('rejects a Skill that declares a capability outside the platform catalog', () => {
    expect(() =>
      createSkillRegistry({
        capabilityCatalog: capabilities,
        skills: [skill('1.0.0', ['project.read', 'external.write:anywhere'])],
      }),
    ).toThrowError(expect.objectContaining<Partial<SkillRegistryError>>({ code: 'UNKNOWN_CAPABILITY' }))
  })

  it('does not let a selected Skill expand the task grant', () => {
    const registry = createSkillRegistry({
      capabilityCatalog: capabilities,
      skills: [skill('1.0.0', ['project.read', 'preview.verify'])],
    })

    expect(() =>
      createSkillTaskManifest({
        registry,
        skills: [{ id: 'gis.audit', version: '1.0.0' }],
        grantedCapabilities: ['project.read'],
      }),
    ).toThrowError(expect.objectContaining<Partial<SkillRegistryError>>({ code: 'SKILL_CAPABILITY_NOT_GRANTED' }))
  })

  it('records the immutable Skill version and only already-granted capabilities', () => {
    const registry = createSkillRegistry({ capabilityCatalog: capabilities, skills: [skill('1.0.0')] })
    const manifest = createSkillTaskManifest({
      registry,
      skills: [{ id: 'gis.audit' }],
      grantedCapabilities: ['project.read'],
    })

    expect(manifest.skills).toEqual([
      expect.objectContaining({ id: 'gis.audit', version: '1.0.0', capabilities: ['project.read'] }),
    ])
  })
})
