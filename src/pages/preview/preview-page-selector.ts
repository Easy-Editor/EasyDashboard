import { decodeDashboardProjectDocument } from '@/features/projects/project-document'

export type PreviewPageOption = { id: string; label: string }

export type PreviewPageSelection =
  | {
      status: 'empty'
      requestedPageId: string | null
      activePageId: null
      startPageId: null
    }
  | {
      status: 'invalid'
      requestedPageId: string
      activePageId: null
      startPageId: string | null
    }
  | {
      status: 'selected'
      requestedPageId: string | null
      activePageId: string
      startPageId: string
      source: 'requested' | 'start'
    }

export function getPreviewPages(schema: unknown): PreviewPageOption[] {
  const document = decodeDashboardProjectDocument(schema)
  return document.editorSchema.componentsTree.map((page, index) => ({
    id: page.meta.easyDashboard.pageId,
    label: String(page.fileDesc || page.fileName || `页面 ${String(index + 1).padStart(2, '0')}`),
  }))
}

export function resolvePreviewPageSelection(schema: unknown, requestedPageId: string | null): PreviewPageSelection {
  const document = decodeDashboardProjectDocument(schema)
  const pages = document.editorSchema.componentsTree
  const pageIds = new Set(pages.map(page => page.meta.easyDashboard.pageId))
  const configuredStartPageId = document.presentation.startPageId
  const startPageId =
    (configuredStartPageId && pageIds.has(configuredStartPageId) ? configuredStartPageId : null) ??
    pages[0]?.meta.easyDashboard.pageId ??
    null

  if (!startPageId) {
    return {
      status: 'empty',
      requestedPageId,
      activePageId: null,
      startPageId: null,
    }
  }

  if (requestedPageId) {
    if (pageIds.has(requestedPageId)) {
      return {
        status: 'selected',
        requestedPageId,
        activePageId: requestedPageId,
        startPageId,
        source: 'requested',
      }
    }

    return {
      status: 'invalid',
      requestedPageId,
      activePageId: null,
      startPageId,
    }
  }

  return {
    status: 'selected',
    requestedPageId,
    activePageId: startPageId,
    startPageId,
    source: 'start',
  }
}

export function withPreviewPage(searchParams: URLSearchParams, pageId: string): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  next.set('page', pageId)
  return next
}
