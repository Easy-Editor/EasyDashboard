import { getPublishedProjectUrl } from './public-viewer'

type HomePreviewProject = {
  id: string
  slug?: string | null
}

export type HomePreviewLink = {
  href: string
  label: '查看发布页' | '打开预览'
  target: '_blank'
  rel: 'noreferrer'
}

export function getDraftPreviewHref(projectId: string, pageId?: string | null): string {
  const pathname = `/projects/${encodeURIComponent(projectId)}/preview`
  return pageId ? `${pathname}?page=${encodeURIComponent(pageId)}` : pathname
}

export function getHomePreviewLink(project: HomePreviewProject): HomePreviewLink {
  const publishedHref = project.slug ? getPublishedProjectUrl(project.slug) : null
  return {
    href: publishedHref ?? getDraftPreviewHref(project.id),
    label: publishedHref ? '查看发布页' : '打开预览',
    target: '_blank',
    rel: 'noreferrer',
  }
}
