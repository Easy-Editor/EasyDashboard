import type { ProjectDetail } from '@/api/contracts'
import type { ProjectSchema } from '@easy-editor/core'

const publicApiOrigin = (import.meta.env.VITE_PUBLIC_API_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? ''

type RawPublication = {
  projectId: string
  slug: string
  revisionNumber: number
  schema: ProjectSchema
  name: string
  description: string | null
  publishedAt: string
}

function resolutionFromSchema(schema: ProjectSchema): { width: number; height: number } {
  const rect = schema.componentsTree?.[0]?.$dashboard?.rect
  return {
    width: typeof rect?.width === 'number' ? rect.width : 1920,
    height: typeof rect?.height === 'number' ? rect.height : 1080,
  }
}

export async function getPublishedProject(slug: string): Promise<ProjectDetail<ProjectSchema>> {
  const response = await fetch(`${publicApiOrigin}/api/public/projects/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    const error = payload?.error ?? payload
    throw new Error(error?.message ?? `公开项目加载失败（${response.status}）`)
  }

  const publication = (payload as { project: RawPublication }).project
  return {
    id: publication.projectId,
    name: publication.name,
    description: publication.description ?? '',
    slug: publication.slug,
    state: 'published',
    draftVersion: publication.revisionNumber,
    resolution: resolutionFromSchema(publication.schema),
    updatedAt: publication.publishedAt,
    schema: publication.schema,
  }
}
