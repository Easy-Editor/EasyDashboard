import { decodeDashboardProjectDocument } from '@/features/projects/project-document'

export type PreviewPageOption = { id: string; label: string }

export function getPreviewPages(schema: unknown): PreviewPageOption[] {
  const document = decodeDashboardProjectDocument(schema)
  return document.editorSchema.componentsTree.map((page, index) => ({
    id: page.meta.easyDashboard.pageId,
    label: String(page.fileDesc || page.fileName || `页面 ${String(index + 1).padStart(2, '0')}`),
  }))
}

export function resolvePreviewPage(schema: unknown, requestedPageId: string | null): string | null {
  const document = decodeDashboardProjectDocument(schema)
  const pages = document.editorSchema.componentsTree
  if (pages.some(page => page.meta.easyDashboard.pageId === requestedPageId)) return requestedPageId
  return document.presentation.startPageId || pages[0]?.meta.easyDashboard.pageId || null
}

export function withPreviewPage(searchParams: URLSearchParams, pageId: string): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  next.set('page', pageId)
  return next
}
