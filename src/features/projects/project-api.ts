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
import type { ProjectSchema } from '@easy-editor/core'

type RawProject = {
  id: string
  name: string
  description: string | null
  draftSchema: ProjectSchema
  draftVersion: number
  updatedAt: string
  slug?: string | null
  publicationSlug?: string | null
}

type RawRevision = {
  id: string
  revisionNumber: number
  schema: ProjectSchema
  createdAt: string
}

type RawPublication = {
  projectId: string
  slug: string
  revisionId: string
  revisionNumber: number
  schema: ProjectSchema
  name: string
  description: string | null
  publishedAt: string
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
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    slug,
    state: slug ? 'published' : 'draft',
    draftVersion: project.draftVersion,
    resolution: resolutionFromSchema(project.draftSchema),
    updatedAt: project.updatedAt,
  }
}

function toProjectDetail(project: RawProject): ProjectDetail<ProjectSchema> {
  return {
    ...toProjectSummary(project),
    schema: project.draftSchema,
  }
}

export async function listProjects(): Promise<ProjectListResponse> {
  const response = await apiRequest<{ projects: RawProject[] }>('/api/projects')
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

  const response = await apiRequest<{ project: RawProject }>(`/api/projects/${encodeURIComponent(projectId)}/draft`, {
    method: 'PUT',
    body: jsonBody({ schema, expectedVersion }),
  })
  return {
    draftVersion: response.project.draftVersion,
    updatedAt: response.project.updatedAt,
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
      schema: revision.schema,
      createdAt: revision.createdAt,
    })),
  }
}

export async function publishProject(projectId: string, expectedVersion: number): Promise<PublishResponse> {
  const response = await apiRequest<{ publication: RawPublication }>(
    `/api/projects/${encodeURIComponent(projectId)}/publish`,
    {
      method: 'POST',
      body: jsonBody({ expectedVersion }),
    },
  )
  return {
    projectId: response.publication.projectId,
    revisionId: response.publication.revisionId,
    revision: response.publication.revisionNumber,
    slug: response.publication.slug,
    publishedAt: response.publication.publishedAt,
  }
}

export async function rollbackProject(projectId: string, revisionId: string): Promise<PublishResponse> {
  const response = await apiRequest<{ publication: RawPublication }>(
    `/api/projects/${encodeURIComponent(projectId)}/rollback`,
    {
      method: 'POST',
      body: jsonBody({ revisionId }),
    },
  )
  return {
    projectId: response.publication.projectId,
    revisionId: response.publication.revisionId,
    revision: response.publication.revisionNumber,
    slug: response.publication.slug,
    publishedAt: response.publication.publishedAt,
  }
}

export async function unpublishProject(projectId: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/unpublish`, {
    method: 'POST',
    body: jsonBody({}),
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
