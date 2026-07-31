import type { ProjectDetail } from '@/api/contracts'
import { decodeDashboardProjectDocument } from '@/features/projects/project-document'
import type { ProjectSchema } from '@easy-editor/core'

const publicApiOrigin = (import.meta.env.VITE_PUBLIC_API_ORIGIN as string | undefined)?.replace(/\/$/, '') ?? ''

type RawPublication = {
  projectId: string
  slug: string
  revisionNumber?: number
  releaseNumber?: number
  version?: number
  schema?: unknown
  document?: unknown
  projectDocument?: unknown
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

export class PublicProjectNotFoundError extends Error {
  override name = 'PublicProjectNotFoundError'
}

export async function getPublishedProject(
  slug: string,
  releaseNumber?: number | null,
): Promise<ProjectDetail<unknown>> {
  const versionPath = releaseNumber == null ? '' : `/versions/${releaseNumber}`
  const response = await fetch(`${publicApiOrigin}/api/public/projects/${encodeURIComponent(slug)}${versionPath}`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  })
  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    const error = payload?.error ?? payload
    const message = error?.message ?? `公开项目加载失败（${response.status}）`
    if (response.status === 404) throw new PublicProjectNotFoundError(message)
    throw new Error(message)
  }

  const publication =
    (payload as { project?: RawPublication; publication?: RawPublication }).project ??
    (payload as { publication?: RawPublication }).publication
  const rawDocument = publication?.document ?? publication?.projectDocument ?? publication?.schema
  if (!publication || !rawDocument) throw new Error('公开项目响应缺少可渲染文档')
  const document = decodeDashboardProjectDocument(rawDocument)
  const publishedVersion =
    publication.releaseNumber ?? publication.version ?? publication.revisionNumber ?? releaseNumber ?? 0
  return {
    id: publication.projectId,
    name: publication.name,
    description: publication.description ?? '',
    slug: publication.slug,
    state: 'published',
    draftVersion: publishedVersion,
    resolution: resolutionFromSchema(document.editorSchema),
    pageCount: document.editorSchema.componentsTree.length,
    startPageId: document.presentation.startPageId,
    isFavorite: false,
    thumbnail: {
      mode: 'auto',
      status: 'queued',
      url: null,
      draftVersion: null,
      errorCode: null,
    },
    savedAt: publication.publishedAt,
    publishedAt: publication.publishedAt,
    currentReleaseNumber: publishedVersion,
    deletedAt: null,
    updatedAt: publication.publishedAt,
    schema: document,
  }
}
