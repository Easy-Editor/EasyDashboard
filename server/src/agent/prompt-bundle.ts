import { createHash } from 'node:crypto'

export const PROMPT_BUNDLE_SCHEMA_VERSION = 1 as const

export type PromptModule = {
  id: string
  version: string
  content: string
}

export type PromptBundleInput = {
  id: string
  version: string
  modules: readonly PromptModule[]
}

export type PromptBundle = PromptBundleInput & {
  schemaVersion: typeof PROMPT_BUNDLE_SCHEMA_VERSION
  hash: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} must not be empty`)
  return normalized
}

function canonicalBundle(input: PromptBundleInput): PromptBundleInput & { schemaVersion: 1 } {
  const moduleIds = new Set<string>()
  const modules = input.modules.map((module, index) => {
    const id = required(module.id, `modules[${index}].id`)
    if (moduleIds.has(id)) throw new Error(`Prompt module IDs must be unique: ${id}`)
    moduleIds.add(id)
    return {
      id,
      version: required(module.version, `modules[${index}].version`),
      content: required(module.content, `modules[${index}].content`),
    }
  })

  if (modules.length === 0) throw new Error('PromptBundle must contain at least one module')
  return {
    schemaVersion: PROMPT_BUNDLE_SCHEMA_VERSION,
    id: required(input.id, 'id'),
    version: required(input.version, 'version'),
    modules,
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function hashPromptBundle(input: PromptBundleInput): string {
  return sha256(JSON.stringify(canonicalBundle(input)))
}

export function createPromptBundle(input: PromptBundleInput): PromptBundle {
  const canonical = canonicalBundle(input)
  return {
    ...canonical,
    hash: sha256(JSON.stringify(canonical)),
  }
}

export function verifyPromptBundle(bundle: PromptBundle): boolean {
  return bundle.schemaVersion === PROMPT_BUNDLE_SCHEMA_VERSION && hashPromptBundle(bundle) === bundle.hash
}

export function renderPromptBundle(bundle: PromptBundle): string {
  if (!verifyPromptBundle(bundle)) throw new Error('PromptBundle hash verification failed')
  return bundle.modules.map(module => `<!-- ${module.id}@${module.version} -->\n${module.content}`).join('\n\n')
}
