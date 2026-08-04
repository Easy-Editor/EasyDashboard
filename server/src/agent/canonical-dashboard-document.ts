import type { ProjectSchema } from '../validation.js'

export const CANONICAL_DASHBOARD_DOCUMENT_VERSION = 1 as const

const DEFAULT_PRESENTATION_THEME = {
  mode: 'dark',
  tokens: {
    '--dashboard-background': '#080A0D',
    '--dashboard-foreground': '#F1F5F7',
    '--dashboard-accent': '#67C6D9',
  },
} as const

export class InvalidDashboardDocumentError extends Error {
  override readonly name = 'InvalidDashboardDocumentError'
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pageIdentity(page: unknown): string | null {
  const pageRecord = record(page)
  if (!pageRecord) return null
  const easyDashboard = record(record(pageRecord.meta)?.easyDashboard)
  return nonEmptyString(easyDashboard?.pageId) ?? nonEmptyString(pageRecord.docId) ?? nonEmptyString(pageRecord.id)
}

function resolveStartPageId(editorSchema: Record<string, unknown>, requested: unknown): string {
  if (!Array.isArray(editorSchema.componentsTree) || editorSchema.componentsTree.length === 0) {
    throw new InvalidDashboardDocumentError('Dashboard document must contain at least one page')
  }
  if (editorSchema.componentsTree.some(page => !record(page))) {
    throw new InvalidDashboardDocumentError('Dashboard document pages must be objects')
  }

  const identities = editorSchema.componentsTree.map(pageIdentity)
  const requestedStartPageId = nonEmptyString(requested)
  const startPageId = requestedStartPageId ?? identities[0]
  if (!startPageId) {
    throw new InvalidDashboardDocumentError(
      'Dashboard start page cannot be derived; add meta.easyDashboard.pageId, docId, or id to the first page',
    )
  }
  const matches = identities.filter(identity => identity === startPageId).length
  if (matches === 0) {
    throw new InvalidDashboardDocumentError(`Dashboard start page ${startPageId} does not exist`)
  }
  if (matches > 1) {
    throw new InvalidDashboardDocumentError(`Dashboard start page ${startPageId} is ambiguous`)
  }
  return startPageId
}

function isEnvelopeCandidate(schema: ProjectSchema): boolean {
  return 'formatVersion' in schema || 'editorSchema' in schema || 'presentation' in schema
}

/**
 * Preserves valid canonical documents byte-for-byte at the object level and
 * wraps legacy EasyEditor schemas in the canonical envelope expected by the
 * document executor Host.
 */
export function canonicalizeDashboardDocument(schema: ProjectSchema): ProjectSchema {
  if (isEnvelopeCandidate(schema)) {
    if (schema.formatVersion !== CANONICAL_DASHBOARD_DOCUMENT_VERSION) {
      throw new InvalidDashboardDocumentError(
        `Unsupported dashboard document formatVersion: ${String(schema.formatVersion)}`,
      )
    }
    const editorSchema = record(schema.editorSchema)
    const presentation = record(schema.presentation)
    if (!editorSchema || !presentation) {
      throw new InvalidDashboardDocumentError('Canonical dashboard document requires editorSchema and presentation')
    }
    const requestedStartPageId = nonEmptyString(presentation.startPageId)
    if (!requestedStartPageId) {
      throw new InvalidDashboardDocumentError('Canonical dashboard document requires presentation.startPageId')
    }
    resolveStartPageId(editorSchema, requestedStartPageId)
    return schema
  }

  const editorSchema = record(schema)
  if (!editorSchema) throw new InvalidDashboardDocumentError('Dashboard editor schema must be an object')
  const legacyEasyDashboard = record(record(editorSchema.meta)?.easyDashboard)
  const startPageId = resolveStartPageId(editorSchema, legacyEasyDashboard?.startPageId)
  const theme = record(legacyEasyDashboard?.theme)

  return {
    formatVersion: CANONICAL_DASHBOARD_DOCUMENT_VERSION,
    editorSchema: schema,
    presentation: {
      startPageId,
      theme: theme ? structuredClone(theme) : structuredClone(DEFAULT_PRESENTATION_THEME),
    },
  }
}

/**
 * Resolves the page identity that the isolated EasyEditor Host must activate.
 * Legacy schemas are normalized through the same validation path used during
 * project creation so Agent runs cannot accidentally target the project UUID.
 */
export function resolveDashboardStartPageId(schema: ProjectSchema): string {
  const canonical = canonicalizeDashboardDocument(schema)
  const presentation = record(canonical.presentation)
  const startPageId = nonEmptyString(presentation?.startPageId)
  if (!startPageId) {
    throw new InvalidDashboardDocumentError('Canonical dashboard document requires presentation.startPageId')
  }
  return startPageId
}

export function resolveDashboardActiveDocumentId(schema: ProjectSchema): string {
  const canonical = canonicalizeDashboardDocument(schema)
  const editorSchema = record(canonical.editorSchema)
  const startPageId = resolveDashboardStartPageId(canonical)
  const pages = Array.isArray(editorSchema?.componentsTree) ? editorSchema.componentsTree : []
  const activePage = pages.find(page => pageIdentity(page) === startPageId)
  const activePageRecord = record(activePage)
  const documentId = nonEmptyString(activePageRecord?.docId) ?? nonEmptyString(activePageRecord?.id)
  if (!documentId) {
    throw new InvalidDashboardDocumentError(`Dashboard start page ${startPageId} has no editor document identity`)
  }
  return documentId
}

export function resolveDashboardActiveRootNodeId(schema: ProjectSchema): string {
  const canonical = canonicalizeDashboardDocument(schema)
  const editorSchema = record(canonical.editorSchema)
  const startPageId = resolveDashboardStartPageId(canonical)
  const pages = Array.isArray(editorSchema?.componentsTree) ? editorSchema.componentsTree : []
  const activePage = pages.find(page => pageIdentity(page) === startPageId)
  const activePageRecord = record(activePage)
  const rootNodeId = nonEmptyString(activePageRecord?.id)
  if (!rootNodeId) {
    throw new InvalidDashboardDocumentError(`Dashboard start page ${startPageId} has no Root node identity`)
  }
  return rootNodeId
}
