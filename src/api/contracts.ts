export type ApiErrorPayload = {
  code: string
  message: string
  details?: unknown
  requestId?: string
}

export type SessionUser = {
  id: string
  email: string | null
}

export type SessionResponse = {
  user: SessionUser | null
}

export type ProjectState = 'draft' | 'published'

export type ProjectSummary = {
  id: string
  name: string
  description: string
  slug: string | null
  state: ProjectState
  draftVersion: number
  resolution: {
    width: number
    height: number
  }
  updatedAt: string
}

export type ProjectDetail<TSchema = unknown> = ProjectSummary & {
  schema: TSchema
}

export type ProjectRevision<TSchema = unknown> = {
  id: string
  revision: number
  schema: TSchema
  createdAt: string
}

export type ProjectListResponse = {
  projects: ProjectSummary[]
}

export type TemplateSummary<TSchema = unknown> = {
  id: string
  name: string
  description: string
  category: string
  resolution: {
    width: number
    height: number
  }
  schema?: TSchema
}

export type TemplateListResponse<TSchema = unknown> = {
  templates: TemplateSummary<TSchema>[]
}

export type SaveDraftResponse = {
  draftVersion: number
  updatedAt: string
}

export type PublishResponse = {
  projectId: string
  revisionId: string
  revision: number
  slug: string
  publishedAt: string
}
