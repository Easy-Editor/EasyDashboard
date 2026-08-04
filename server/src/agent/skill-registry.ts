export const SKILL_REGISTRY_CONTRACT_VERSION = 'easy-dashboard.skill-registry.v1' as const

export type SkillCapability = string

export type BuiltInSkillDefinition = {
  id: string
  version: string
  title: string
  description: string
  instructions: readonly string[]
  capabilities: readonly SkillCapability[]
  source: 'platform'
}

export type SkillReference = {
  id: string
  version?: string
}

export type SkillRegistry = {
  contractVersion: typeof SKILL_REGISTRY_CONTRACT_VERSION
  capabilityCatalog: readonly SkillCapability[]
  skills: readonly BuiltInSkillDefinition[]
}

export type ResolvedSkill = BuiltInSkillDefinition & {
  auditRef: `${string}@${string}`
}

export type SkillTaskManifest = {
  contractVersion: typeof SKILL_REGISTRY_CONTRACT_VERSION
  skills: Array<{
    id: string
    version: string
    title: string
    description: string
    instructions: string[]
    capabilities: string[]
  }>
}

export type SkillRegistryErrorCode =
  | 'INVALID_SKILL_DEFINITION'
  | 'DUPLICATE_CAPABILITY'
  | 'DUPLICATE_SKILL_VERSION'
  | 'UNKNOWN_CAPABILITY'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_CAPABILITY_NOT_GRANTED'

export class SkillRegistryError extends Error {
  constructor(
    public readonly code: SkillRegistryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SkillRegistryError'
  }
}

const identifierPattern = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new SkillRegistryError('INVALID_SKILL_DEFINITION', `${label} must be a stable lowercase identifier`)
  }
}

function assertSkillDefinition(skill: BuiltInSkillDefinition): void {
  assertIdentifier(skill.id, 'Skill id')
  if (!versionPattern.test(skill.version)) {
    throw new SkillRegistryError('INVALID_SKILL_DEFINITION', `Skill ${skill.id} has an invalid semantic version`)
  }
  if (skill.source !== 'platform' || !skill.title.trim() || !skill.description.trim()) {
    throw new SkillRegistryError(
      'INVALID_SKILL_DEFINITION',
      `Skill ${skill.id}@${skill.version} must be a described platform skill`,
    )
  }
  if (skill.instructions.length === 0 || skill.instructions.some(instruction => !instruction.trim())) {
    throw new SkillRegistryError(
      'INVALID_SKILL_DEFINITION',
      `Skill ${skill.id}@${skill.version} must contain auditable instructions`,
    )
  }
}

function cloneSkill(skill: BuiltInSkillDefinition): BuiltInSkillDefinition {
  return {
    ...skill,
    instructions: [...skill.instructions],
    capabilities: [...skill.capabilities],
  }
}

export function createSkillRegistry(input: {
  capabilityCatalog: readonly SkillCapability[]
  skills: readonly BuiltInSkillDefinition[]
}): SkillRegistry {
  const capabilities = new Set<string>()
  for (const capability of input.capabilityCatalog) {
    assertIdentifier(capability, 'Capability')
    if (capabilities.has(capability)) {
      throw new SkillRegistryError('DUPLICATE_CAPABILITY', `Duplicate capability: ${capability}`)
    }
    capabilities.add(capability)
  }

  const skillVersions = new Set<string>()
  const skills = input.skills.map(skill => {
    assertSkillDefinition(skill)
    const key = `${skill.id}@${skill.version}`
    if (skillVersions.has(key)) {
      throw new SkillRegistryError('DUPLICATE_SKILL_VERSION', `Duplicate skill version: ${key}`)
    }
    skillVersions.add(key)

    const declared = new Set<string>()
    for (const capability of skill.capabilities) {
      if (!capabilities.has(capability)) {
        throw new SkillRegistryError(
          'UNKNOWN_CAPABILITY',
          `Skill ${key} cannot declare unknown capability ${capability}`,
        )
      }
      if (declared.has(capability)) {
        throw new SkillRegistryError('INVALID_SKILL_DEFINITION', `Skill ${key} repeats capability ${capability}`)
      }
      declared.add(capability)
    }
    return cloneSkill(skill)
  })

  return {
    contractVersion: SKILL_REGISTRY_CONTRACT_VERSION,
    capabilityCatalog: [...capabilities],
    skills,
  }
}

function compareVersions(left: string, right: string): number {
  const [leftCore = '', leftPrerelease] = left.split('-', 2)
  const [rightCore = '', rightPrerelease] = right.split('-', 2)
  const leftParts = leftCore.split('.').map(Number)
  const rightParts = rightCore.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  if (leftPrerelease === undefined && rightPrerelease !== undefined) return 1
  if (leftPrerelease !== undefined && rightPrerelease === undefined) return -1
  return (leftPrerelease ?? '').localeCompare(rightPrerelease ?? '')
}

export function resolveBuiltInSkill(registry: SkillRegistry, reference: SkillReference): ResolvedSkill {
  const candidates = registry.skills.filter(
    skill => skill.id === reference.id && (reference.version === undefined || skill.version === reference.version),
  )
  const selected = candidates.reduce<BuiltInSkillDefinition | undefined>((latest, skill) => {
    if (!latest || compareVersions(skill.version, latest.version) > 0) return skill
    return latest
  }, undefined)
  if (!selected) {
    throw new SkillRegistryError(
      'SKILL_NOT_FOUND',
      `Platform skill not found: ${reference.id}${reference.version ? `@${reference.version}` : ''}`,
    )
  }
  return {
    ...cloneSkill(selected),
    auditRef: `${selected.id}@${selected.version}`,
  }
}

export function createSkillTaskManifest(input: {
  registry: SkillRegistry
  skills: readonly SkillReference[]
  grantedCapabilities: readonly SkillCapability[]
}): SkillTaskManifest {
  const granted = new Set(input.grantedCapabilities)
  const resolved = input.skills.map(reference => resolveBuiltInSkill(input.registry, reference))
  const seen = new Set<string>()

  return {
    contractVersion: SKILL_REGISTRY_CONTRACT_VERSION,
    skills: resolved.flatMap(skill => {
      if (seen.has(skill.auditRef)) return []
      seen.add(skill.auditRef)
      for (const capability of skill.capabilities) {
        if (!granted.has(capability)) {
          throw new SkillRegistryError(
            'SKILL_CAPABILITY_NOT_GRANTED',
            `Skill ${skill.auditRef} cannot expand task authority with ${capability}`,
          )
        }
      }
      return [
        {
          id: skill.id,
          version: skill.version,
          title: skill.title,
          description: skill.description,
          instructions: [...skill.instructions],
          capabilities: [...skill.capabilities],
        },
      ]
    }),
  }
}
