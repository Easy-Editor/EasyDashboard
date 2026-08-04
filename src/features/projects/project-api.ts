import { apiRequest, jsonBody } from '@/api/client'
import type {
  ProjectDetail,
  ProjectListResponse,
  ProjectRevision,
  ProjectSummary,
  PublishResponse,
  SaveDraftResponse,
  TemplateListResponse,
  TemplateSummary,
} from '@/api/contracts'
import { assertProjectSchemaBudget } from '@/api/schema-budget'
import { decodeDashboardProjectDocument } from '@/features/projects/project-document'
import { publishProjectRelease } from '@/features/releases/release-api'
import type { ProjectSchema } from '@easy-editor/core'

type RawProject = {
  id: string
  name: string
  description: string | null
  draftSchema?: ProjectSchema
  schema?: ProjectSchema
  draftVersion: number
  draftSavedAt?: string
  savedAt?: string
  canvasWidth?: number
  canvasHeight?: number
  pageCount?: number
  startPageId?: string | null
  isFavorite?: boolean
  isPublished?: boolean
  deletedAt?: string | null
  thumbnailMode?: 'auto' | 'custom'
  thumbnailStatus?: 'queued' | 'rendering' | 'ready' | 'failed'
  thumbnailUrl?: string | null
  thumbnailDraftVersion?: number | null
  thumbnailErrorCode?: string | null
  coverUrl?: string | null
  updatedAt: string
  slug?: string | null
  publicationSlug?: string | null
  publishedAt?: string | null
  currentReleaseNumber?: number | null
}

type RawRevision = {
  id: string
  revisionNumber: number
  kind?: 'auto' | 'manual' | 'pre_restore' | 'publish' | 'agent'
  schema?: ProjectSchema
  createdAt: string
}

type RawTemplate = {
  id: string
  name: string
  description: string | null
  schema: ProjectSchema
}

function resolutionFromSchema(schema: ProjectSchema): { width: number; height: number } {
  const firstPage = schema.componentsTree?.[0]
  const rect = firstPage?.$dashboard?.rect
  return {
    width: typeof rect?.width === 'number' ? rect.width : 1920,
    height: typeof rect?.height === 'number' ? rect.height : 1080,
  }
}

function toProjectSummary(project: RawProject): ProjectSummary {
  const slug = project.publicationSlug ?? project.slug ?? null
  const legacyResolution = project.draftSchema ? resolutionFromSchema(project.draftSchema) : null
  const deletedAt = project.deletedAt ?? null
  const isPublished = project.isPublished ?? Boolean(slug)
  const savedAt = project.draftSavedAt ?? project.savedAt ?? project.updatedAt
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    slug,
    state: deletedAt ? 'trashed' : isPublished ? 'published' : 'draft',
    draftVersion: project.draftVersion,
    resolution: {
      width: project.canvasWidth ?? legacyResolution?.width ?? 1920,
      height: project.canvasHeight ?? legacyResolution?.height ?? 1080,
    },
    pageCount: project.pageCount ?? project.draftSchema?.componentsTree?.length ?? 1,
    startPageId: project.startPageId ?? null,
    isFavorite: project.isFavorite ?? false,
    thumbnail: {
      mode: project.thumbnailMode ?? (project.coverUrl ? 'custom' : 'auto'),
      status: project.thumbnailStatus ?? (project.thumbnailUrl || project.coverUrl ? 'ready' : 'queued'),
      url: project.thumbnailUrl ?? project.coverUrl ?? null,
      draftVersion: project.thumbnailDraftVersion ?? null,
      errorCode: project.thumbnailErrorCode ?? null,
    },
    savedAt,
    publishedAt: project.publishedAt ?? null,
    currentReleaseNumber: project.currentReleaseNumber ?? null,
    deletedAt,
    updatedAt: project.updatedAt,
  }
}

function toProjectDetail(project: RawProject): ProjectDetail<ProjectSchema> {
  const schema = project.draftSchema ?? project.schema
  if (!schema) throw new Error('项目响应缺少可编辑文档')
  return {
    ...toProjectSummary(project),
    schema: decodeDashboardProjectDocument(schema).editorSchema,
  }
}

export async function listProjects(view: 'active' | 'trash' = 'active'): Promise<ProjectListResponse> {
  const response = await apiRequest<{ projects: RawProject[] }>(`/api/projects?view=${view}`)
  return { projects: response.projects.map(toProjectSummary) }
}

export async function getProject(projectId: string): Promise<ProjectDetail<ProjectSchema>> {
  const response = await apiRequest<{ project: RawProject }>(`/api/projects/${encodeURIComponent(projectId)}`)
  return toProjectDetail(response.project)
}

export async function createProject(input: {
  name: string
  description?: string
  schema: ProjectSchema
}): Promise<ProjectDetail<ProjectSchema>> {
  const response = await apiRequest<{ project: RawProject }>('/api/projects', {
    method: 'POST',
    body: jsonBody(input),
  })
  return toProjectDetail(response.project)
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: jsonBody({ name }),
  })
}

export async function saveProjectDraft(
  projectId: string,
  schema: ProjectSchema,
  expectedVersion: number,
): Promise<SaveDraftResponse> {
  assertProjectSchemaBudget(schema)

  const response = await apiRequest<{
    project?: RawProject
    draftVersion?: number
    savedAt?: string
    updatedAt?: string
  }>(`/api/projects/${encodeURIComponent(projectId)}/draft`, {
    method: 'PUT',
    body: jsonBody({ schema, expectedVersion }),
  })
  const draftVersion = response.draftVersion ?? response.project?.draftVersion
  const savedAt =
    response.savedAt ?? response.updatedAt ?? response.project?.draftSavedAt ?? response.project?.updatedAt
  if (draftVersion === undefined || !savedAt) throw new Error('保存响应缺少版本或保存时间')
  return {
    draftVersion,
    savedAt,
    updatedAt: savedAt,
  }
}

export async function listProjectRestorePoints(projectId: string): Promise<{
  restorePoints: ProjectRevision<ProjectSchema | undefined>[]
}> {
  const response = await apiRequest<{ revisions: RawRevision[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/restore-points`,
  )
  return {
    restorePoints: response.revisions.map(revision => ({
      id: revision.id,
      revision: revision.revisionNumber,
      kind: revision.kind ?? 'manual',
      schema: revision.schema,
      createdAt: revision.createdAt,
    })),
  }
}

export async function listProjectRevisions(projectId: string): Promise<{
  revisions: ProjectRevision<ProjectSchema>[]
}> {
  const response = await apiRequest<{ revisions: RawRevision[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/revisions`,
  )
  return {
    revisions: response.revisions.map(revision => ({
      id: revision.id,
      revision: revision.revisionNumber,
      kind: revision.kind ?? 'publish',
      schema: revision.schema ?? { version: '1.0.0', componentsTree: [] },
      createdAt: revision.createdAt,
    })),
  }
}

export async function createProjectRestorePoint(
  projectId: string,
): Promise<ProjectRevision<ProjectSchema | undefined>> {
  const response = await apiRequest<{ revision: RawRevision }>(
    `/api/projects/${encodeURIComponent(projectId)}/restore-points`,
    {
      method: 'POST',
      body: jsonBody({}),
    },
  )
  return {
    id: response.revision.id,
    revision: response.revision.revisionNumber,
    kind: response.revision.kind ?? 'manual',
    schema: response.revision.schema,
    createdAt: response.revision.createdAt,
  }
}

export async function restoreProjectRevision(
  projectId: string,
  revisionId: string,
  expectedVersion: number,
): Promise<SaveDraftResponse> {
  const response = await apiRequest<{
    project?: RawProject
    draftVersion?: number
    savedAt?: string
    updatedAt?: string
  }>(`/api/projects/${encodeURIComponent(projectId)}/restore-points/${encodeURIComponent(revisionId)}/restore`, {
    method: 'POST',
    body: jsonBody({ expectedVersion }),
  })
  const draftVersion = response.draftVersion ?? response.project?.draftVersion
  const savedAt =
    response.savedAt ?? response.updatedAt ?? response.project?.draftSavedAt ?? response.project?.updatedAt
  if (draftVersion === undefined || !savedAt) throw new Error('恢复响应缺少版本或保存时间')
  return { draftVersion, savedAt, updatedAt: savedAt }
}

export async function publishProject(projectId: string, expectedVersion: number): Promise<PublishResponse> {
  const publication = await publishProjectRelease(projectId, expectedVersion)
  return {
    projectId: publication.projectId,
    revisionId: publication.revisionId,
    revision: publication.revisionNumber,
    releaseNumber: publication.releaseNumber,
    slug: publication.slug,
    stablePath: publication.stablePath,
    versionPath: publication.versionPath,
    publishedAt: publication.publishedAt,
  }
}

export async function unpublishProject(projectId: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/unpublish`, {
    method: 'POST',
    body: jsonBody({}),
  })
}

export async function setProjectFavorite(projectId: string, favorite: boolean): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/favorite`, {
    method: favorite ? 'PUT' : 'DELETE',
    body: favorite ? jsonBody({}) : undefined,
  })
}

export async function duplicateProject(projectId: string): Promise<ProjectDetail<ProjectSchema>> {
  const response = await apiRequest<{ project: RawProject }>(
    `/api/projects/${encodeURIComponent(projectId)}/duplicate`,
    {
      method: 'POST',
      body: jsonBody({}),
    },
  )
  return toProjectDetail(response.project)
}

export async function trashProject(projectId: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  })
}

export async function restoreProject(projectId: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/restore`, {
    method: 'POST',
    body: jsonBody({}),
  })
}

export async function deleteProjectPermanently(projectId: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/permanent`, {
    method: 'DELETE',
  })
}

export async function listTemplates(): Promise<TemplateListResponse<ProjectSchema>> {
  const response = await apiRequest<{ templates: RawTemplate[] }>('/api/templates')
  const templates: TemplateSummary<ProjectSchema>[] = response.templates.map(template => {
    const resolution = resolutionFromSchema(template.schema)
    return {
      id: template.id,
      name: template.name,
      description: template.description ?? '',
      category: '官方模板',
      resolution,
      schema: template.schema,
    }
  })
  return { templates }
}
