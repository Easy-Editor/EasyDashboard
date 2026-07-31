import { nanoid } from 'nanoid'

import {
  type DashboardPageSchema,
  type DashboardPageTheme,
  type DashboardProjectDocument,
  serializeDashboardProjectDocument,
} from './project-document'

export class DashboardPageConflictError extends Error {}

export class DashboardPageNotFoundError extends Error {
  constructor(pageId: string) {
    super(`Unknown dashboard page: ${pageId}`)
  }
}

type CreateDashboardPageInput = {
  pageId?: string
  fileName: string
  fileDesc: string
  theme?: DashboardPageTheme
}

type DuplicateDashboardPageOptions = {
  pageId?: string
  fileName?: string
  fileDesc?: string
}

function pageIdOf(page: DashboardPageSchema): string {
  return page.meta.easyDashboard.pageId
}

function requirePageIndex(document: DashboardProjectDocument, pageId: string): number {
  const index = document.editorSchema.componentsTree.findIndex(page => pageIdOf(page) === pageId)
  if (index < 0) throw new DashboardPageNotFoundError(pageId)
  return index
}

function normalizedRequiredValue(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${label} must not be empty`)
  return normalized
}

function assertUniquePageIdentity(document: DashboardProjectDocument, pageId: string, fileName: string): void {
  if (document.editorSchema.componentsTree.some(page => pageIdOf(page) === pageId)) {
    throw new DashboardPageConflictError(`Dashboard page id already exists: ${pageId}`)
  }
  if (document.editorSchema.componentsTree.some(page => page.fileName === fileName)) {
    throw new DashboardPageConflictError(`Dashboard page path already exists: ${fileName}`)
  }
}

function copyDocument(document: DashboardProjectDocument): DashboardProjectDocument {
  return serializeDashboardProjectDocument(document)
}

function nextCopyFileName(document: DashboardProjectDocument, sourceFileName: string): string {
  const used = new Set(document.editorSchema.componentsTree.map(page => page.fileName))
  const candidate = `${sourceFileName}-copy`
  if (!used.has(candidate)) return candidate

  let suffix = 2
  while (used.has(`${candidate}-${suffix}`)) suffix += 1
  return `${candidate}-${suffix}`
}

function createBlankPage(
  input: Required<Pick<CreateDashboardPageInput, 'pageId' | 'fileName' | 'fileDesc'>> & {
    theme?: DashboardPageTheme
  },
): DashboardPageSchema {
  return {
    id: `${input.pageId}-root`,
    docId: input.pageId,
    componentName: 'Root',
    fileName: input.fileName,
    fileDesc: input.fileDesc,
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
    meta: {
      easyDashboard: {
        pageId: input.pageId,
        ...(input.theme ? { theme: input.theme } : {}),
      },
    },
  }
}

export function createDashboardPage(
  document: DashboardProjectDocument,
  input: CreateDashboardPageInput,
): DashboardProjectDocument {
  const next = copyDocument(document)
  const pageId = normalizedRequiredValue(input.pageId ?? `page-${nanoid(10)}`, 'pageId')
  const fileName = normalizedRequiredValue(input.fileName, 'fileName')
  const fileDesc = normalizedRequiredValue(input.fileDesc, 'fileDesc')
  assertUniquePageIdentity(next, pageId, fileName)

  next.editorSchema.componentsTree.push(
    createBlankPage({
      pageId,
      fileName,
      fileDesc,
      ...(input.theme ? { theme: input.theme } : {}),
    }),
  )
  return next
}

export function renameDashboardPage(
  document: DashboardProjectDocument,
  pageId: string,
  fileDesc: string,
): DashboardProjectDocument {
  const next = copyDocument(document)
  const pageIndex = requirePageIndex(next, pageId)
  next.editorSchema.componentsTree[pageIndex].fileDesc = normalizedRequiredValue(fileDesc, 'fileDesc')
  return next
}

export function duplicateDashboardPage(
  document: DashboardProjectDocument,
  pageId: string,
  options: DuplicateDashboardPageOptions = {},
): DashboardProjectDocument {
  const next = copyDocument(document)
  const sourceIndex = requirePageIndex(next, pageId)
  const source = next.editorSchema.componentsTree[sourceIndex]
  const duplicatePageId = normalizedRequiredValue(options.pageId ?? `page-${nanoid(10)}`, 'pageId')
  const duplicateFileName = normalizedRequiredValue(
    options.fileName ?? nextCopyFileName(next, source.fileName),
    'fileName',
  )
  assertUniquePageIdentity(next, duplicatePageId, duplicateFileName)

  const duplicate = structuredClone(source)
  duplicate.id = source.id === pageId ? duplicatePageId : `${duplicatePageId}-root`
  duplicate.docId = duplicatePageId
  duplicate.fileName = duplicateFileName
  duplicate.fileDesc = normalizedRequiredValue(
    options.fileDesc ?? `${String(source.fileDesc ?? source.fileName)} 副本`,
    'fileDesc',
  )
  duplicate.meta = {
    ...duplicate.meta,
    easyDashboard: {
      ...duplicate.meta.easyDashboard,
      pageId: duplicatePageId,
    },
  }

  next.editorSchema.componentsTree.splice(sourceIndex + 1, 0, duplicate)
  return next
}

export function reorderDashboardPage(
  document: DashboardProjectDocument,
  pageId: string,
  toIndex: number,
): DashboardProjectDocument {
  const next = copyDocument(document)
  const sourceIndex = requirePageIndex(next, pageId)
  const targetIndex = Math.max(0, Math.min(Math.trunc(toIndex), next.editorSchema.componentsTree.length - 1))
  if (sourceIndex === targetIndex) return next

  const [page] = next.editorSchema.componentsTree.splice(sourceIndex, 1)
  next.editorSchema.componentsTree.splice(targetIndex, 0, page)
  return next
}

export function deleteDashboardPage(document: DashboardProjectDocument, pageId: string): DashboardProjectDocument {
  const next = copyDocument(document)
  if (next.editorSchema.componentsTree.length === 1) {
    throw new Error('A dashboard project must contain at least one page')
  }

  const pageIndex = requirePageIndex(next, pageId)
  next.editorSchema.componentsTree.splice(pageIndex, 1)
  if (next.presentation.startPageId === pageId) {
    next.presentation.startPageId = pageIdOf(next.editorSchema.componentsTree[0])
  }
  return next
}

export function setDashboardStartPage(document: DashboardProjectDocument, pageId: string): DashboardProjectDocument {
  const next = copyDocument(document)
  requirePageIndex(next, pageId)
  next.presentation.startPageId = pageId
  return next
}
