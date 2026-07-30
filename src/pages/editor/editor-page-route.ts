export type EditorRoutePage = {
  pageId: string
  fileName: string
}

export type EditorPageRouteDecision = EditorRoutePage & {
  shouldOpen: boolean
  shouldReplace: boolean
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {}
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
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

export function selectEditorRouteProjectState(
  componentsTree: readonly unknown[],
  projectMeta: unknown,
): {
  pages: EditorRoutePage[]
  startPageId: string | undefined
} {
  const usedPageIds = new Set<string>()
  const usedFileNames = new Set<string>()
  const pages = componentsTree.map((source, index) => {
    const page = record(source)
    const easyDashboard = record(record(page.meta).easyDashboard)
    const fileName = uniqueValue(nonEmptyString(page.fileName) ?? `page-${index + 1}`, usedFileNames)
    const pageId = uniqueValue(
      nonEmptyString(easyDashboard.pageId) ??
        nonEmptyString(page.docId) ??
        nonEmptyString(page.id) ??
        `page-${fileName.replaceAll('/', '-')}`,
      usedPageIds,
    )
    return { pageId, fileName }
  })
  const requestedStartPageId = nonEmptyString(record(record(projectMeta).easyDashboard).startPageId)
  const startPageId =
    requestedStartPageId && pages.some(page => page.pageId === requestedStartPageId)
      ? requestedStartPageId
      : pages[0]?.pageId

  return { pages, startPageId }
}

export function resolveEditorPageRoute({
  pages,
  requestedPageId,
  currentFileName,
  startPageId,
}: {
  pages: readonly EditorRoutePage[]
  requestedPageId: string | null
  currentFileName: string | undefined
  startPageId: string | null | undefined
}): EditorPageRouteDecision | null {
  const requestedPage = pages.find(page => page.pageId === requestedPageId)
  const currentPage = pages.find(page => page.fileName === currentFileName)
  const startPage = pages.find(page => page.pageId === startPageId)
  const resolvedPage = requestedPage ?? currentPage ?? startPage ?? pages[0]

  if (!resolvedPage) return null

  return {
    ...resolvedPage,
    shouldOpen: resolvedPage.fileName !== currentFileName,
    shouldReplace: resolvedPage.pageId !== requestedPageId,
  }
}

export function withEditorPage(searchParams: URLSearchParams, pageId: string): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  next.set('page', pageId)
  return next
}
