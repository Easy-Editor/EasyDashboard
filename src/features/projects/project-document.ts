import type { ProjectSchema, RootSchema } from '@easy-editor/core'

export const DASHBOARD_PROJECT_DOCUMENT_VERSION = 1 as const

export type DashboardThemeMode = 'light' | 'dark'

export type DashboardTheme = {
  mode: DashboardThemeMode
  tokens: Record<string, string>
}

export type DashboardPageTheme = {
  mode?: DashboardThemeMode
  tokens?: Record<string, string>
}

export const DEFAULT_DASHBOARD_THEME: DashboardTheme = {
  mode: 'dark',
  tokens: {
    '--dashboard-background': '#080A0D',
    '--dashboard-foreground': '#F1F5F7',
    '--dashboard-accent': '#67C6D9',
  },
}

export type DashboardPageSchema = RootSchema & {
  fileName: string
  meta: Record<string, unknown> & {
    easyDashboard: {
      pageId: string
      theme?: DashboardPageTheme
      [key: string]: unknown
    }
  }
}

export type DashboardEditorSchema = ProjectSchema<DashboardPageSchema>

export type DashboardProjectDocument = {
  formatVersion: typeof DASHBOARD_PROJECT_DOCUMENT_VERSION
  editorSchema: DashboardEditorSchema
  presentation: {
    startPageId: string
    theme: DashboardTheme
  }
}

type UnknownRecord = Record<string, unknown>

export class UnsupportedDashboardDocumentVersionError extends Error {
  constructor(readonly formatVersion: unknown) {
    super(`Unsupported dashboard project document version: ${String(formatVersion)}`)
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function uniqueValue(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }

  let suffix = 2
  while (used.has(`${candidate}-${suffix}`)) suffix += 1
  const unique = `${candidate}-${suffix}`
  used.add(unique)
  return unique
}

function stringTokens(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function normalizeTheme(value: unknown): DashboardTheme {
  const source = isRecord(value) ? value : {}
  return {
    mode: source.mode === 'light' || source.mode === 'dark' ? source.mode : DEFAULT_DASHBOARD_THEME.mode,
    tokens: {
      ...DEFAULT_DASHBOARD_THEME.tokens,
      ...stringTokens(source.tokens),
    },
  }
}

function normalizePageTheme(value: unknown): DashboardPageTheme | undefined {
  if (!isRecord(value)) return undefined
  const tokens = stringTokens(value.tokens)
  const mode = value.mode === 'light' || value.mode === 'dark' ? value.mode : undefined
  if (!mode && Object.keys(tokens).length === 0) return undefined
  return {
    ...(mode ? { mode } : {}),
    ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
  }
}

function createFallbackPage(): RootSchema {
  return {
    componentName: 'Root',
    fileName: 'home',
    fileDesc: '首页',
    isRoot: true,
    props: {
      backgroundColor: 'var(--dashboard-background)',
      className: 'page',
    },
    $dashboard: {
      rect: {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
    },
    children: [],
  }
}

function readInput(input: unknown): {
  editorSchema: UnknownRecord
  presentation: UnknownRecord
} {
  if (!isRecord(input)) {
    throw new TypeError('Dashboard project document must be an object')
  }

  if ('formatVersion' in input && input.formatVersion !== DASHBOARD_PROJECT_DOCUMENT_VERSION) {
    throw new UnsupportedDashboardDocumentVersionError(input.formatVersion)
  }

  if (isRecord(input.editorSchema)) {
    return {
      editorSchema: input.editorSchema,
      presentation: isRecord(input.presentation) ? input.presentation : {},
    }
  }

  const legacyPresentation = isRecord(input.meta) && isRecord(input.meta.easyDashboard) ? input.meta.easyDashboard : {}
  return {
    editorSchema: input,
    presentation: legacyPresentation,
  }
}

/**
 * Accepts both the current document envelope and a legacy raw EasyEditor
 * ProjectSchema, returning the single canonical in-memory representation.
 */
export function decodeDashboardProjectDocument(input: unknown): DashboardProjectDocument {
  const source = readInput(input)
  const editorSchema = cloneValue(source.editorSchema) as ProjectSchema
  const rawPages = Array.isArray(editorSchema.componentsTree) ? editorSchema.componentsTree : []
  const pages = rawPages.length > 0 ? rawPages : [createFallbackPage()]
  const usedPageIds = new Set<string>()
  const usedFileNames = new Set<string>()

  const componentsTree: DashboardPageSchema[] = pages.map((rawPage, index) => {
    const page = (isRecord(rawPage) ? rawPage : createFallbackPage()) as RootSchema
    const meta = isRecord(page.meta) ? page.meta : {}
    const easyDashboard = isRecord(meta.easyDashboard) ? meta.easyDashboard : {}
    const fileName = uniqueValue(nonEmptyString(page.fileName) ?? `page-${index + 1}`, usedFileNames)
    const pageIdCandidate =
      nonEmptyString(easyDashboard.pageId) ??
      nonEmptyString(page.docId) ??
      nonEmptyString(page.id) ??
      `page-${fileName.replaceAll('/', '-')}`
    const pageId = uniqueValue(pageIdCandidate, usedPageIds)
    const theme = normalizePageTheme(easyDashboard.theme)

    return {
      ...page,
      componentName: nonEmptyString(page.componentName) ?? 'Root',
      fileName,
      meta: {
        ...meta,
        easyDashboard: {
          ...easyDashboard,
          pageId,
          ...(theme ? { theme } : {}),
        },
      },
    } as DashboardPageSchema
  })

  const requestedStartPageId = nonEmptyString(source.presentation.startPageId)
  const startPageId =
    (requestedStartPageId && usedPageIds.has(requestedStartPageId) ? requestedStartPageId : undefined) ??
    componentsTree[0].meta.easyDashboard.pageId
  const theme = normalizeTheme(source.presentation.theme)
  const projectMeta = isRecord(editorSchema.meta) ? editorSchema.meta : {}
  const legacyEasyDashboard = isRecord(projectMeta.easyDashboard) ? projectMeta.easyDashboard : {}

  return {
    formatVersion: DASHBOARD_PROJECT_DOCUMENT_VERSION,
    editorSchema: {
      ...editorSchema,
      version: nonEmptyString(editorSchema.version) ?? '1.0.0',
      componentsTree,
      meta: {
        ...projectMeta,
        easyDashboard: {
          ...legacyEasyDashboard,
          documentVersion: DASHBOARD_PROJECT_DOCUMENT_VERSION,
          startPageId,
          theme,
        },
      },
    },
    presentation: {
      startPageId,
      theme,
    },
  }
}

export function serializeDashboardProjectDocument(document: DashboardProjectDocument): DashboardProjectDocument {
  return cloneValue(decodeDashboardProjectDocument(document))
}

export function resolvePageFileName(document: DashboardProjectDocument, pageId: string): string | undefined {
  return document.editorSchema.componentsTree.find(page => page.meta.easyDashboard.pageId === pageId)?.fileName
}

export function resolveStartPageFileName(document: DashboardProjectDocument): string | undefined {
  return (
    resolvePageFileName(document, document.presentation.startPageId) ??
    document.editorSchema.componentsTree[0]?.fileName
  )
}

export function resolvePageTheme(document: DashboardProjectDocument, pageId: string): DashboardTheme {
  const pageTheme = document.editorSchema.componentsTree.find(page => page.meta.easyDashboard.pageId === pageId)?.meta
    .easyDashboard.theme

  return {
    mode: pageTheme?.mode ?? document.presentation.theme.mode,
    tokens: {
      ...document.presentation.theme.tokens,
      ...pageTheme?.tokens,
    },
  }
}
