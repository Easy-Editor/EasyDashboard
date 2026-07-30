import { apiRequest, jsonBody } from '@/api/client'

export type ProjectRelease = {
  projectId: string
  releaseNumber: number
  revisionId: string
  revisionNumber: number
  publishedAt: string
  slug: string | null
  stablePath: string | null
  versionPath: string | null
  isCurrent: boolean
  isPublished: boolean
}

export type PublishedProjectRelease = ProjectRelease & {
  slug: string
  stablePath: string
  versionPath: string
  isCurrent: true
  isPublished: true
}

type RawRelease = {
  projectId: string
  releaseNumber: number
  revisionId: string
  revisionNumber: number
  publishedAt: string
  slug?: string | null
  stableUrl?: string | null
  versionUrl?: string | null
  isCurrent?: boolean
  isPublished?: boolean
}

function slugFromRelease(release: RawRelease): string | null {
  if (release.slug) return release.slug
  if (!release.stableUrl) return null

  const pathname = release.stableUrl.startsWith('http')
    ? new URL(release.stableUrl).pathname
    : release.stableUrl.split(/[?#]/, 1)[0]
  const encodedSlug = pathname.split('/').filter(Boolean).at(-1)
  return encodedSlug ? decodeURIComponent(encodedSlug) : null
}

function viewerPaths(slug: string | null, releaseNumber: number) {
  if (!slug) return { stablePath: null, versionPath: null }
  const encodedSlug = encodeURIComponent(slug)
  const stablePath = `/view/${encodedSlug}`
  return {
    stablePath,
    versionPath: `${stablePath}/versions/${releaseNumber}`,
  }
}

function toRelease(release: RawRelease): ProjectRelease {
  const slug = slugFromRelease(release)
  return {
    projectId: release.projectId,
    releaseNumber: release.releaseNumber,
    revisionId: release.revisionId,
    revisionNumber: release.revisionNumber,
    publishedAt: release.publishedAt,
    slug,
    ...viewerPaths(slug, release.releaseNumber),
    isCurrent: release.isCurrent ?? false,
    isPublished: release.isPublished ?? false,
  }
}

export async function listProjectReleases(projectId: string): Promise<ProjectRelease[]> {
  const response = await apiRequest<{ releases: RawRelease[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/releases`,
  )
  return response.releases.map(toRelease)
}

export async function publishProjectRelease(
  projectId: string,
  expectedVersion: number,
): Promise<PublishedProjectRelease> {
  const response = await apiRequest<{ publication: RawRelease }>(
    `/api/projects/${encodeURIComponent(projectId)}/publish`,
    {
      method: 'POST',
      body: jsonBody({ expectedVersion }),
    },
  )
  const release = toRelease({
    ...response.publication,
    isCurrent: true,
    isPublished: true,
  })
  if (!release.slug || !release.stablePath || !release.versionPath) {
    throw new Error('发布响应缺少公开访问地址')
  }
  return {
    ...release,
    slug: release.slug,
    stablePath: release.stablePath,
    versionPath: release.versionPath,
    isCurrent: true,
    isPublished: true,
  }
}

export async function unpublishProjectRelease(projectId: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/unpublish`, {
    method: 'POST',
    body: jsonBody({}),
  })
}
