import type { ProjectSchema } from './validation.js'

export interface PublicUser {
  id: string
  email: string | null
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  user: PublicUser
}

export interface AuthService {
  signUp(email: string, password: string): Promise<{ user: PublicUser; session: AuthSession | null }>
  signIn(email: string, password: string): Promise<AuthSession>
  refresh(refreshToken: string): Promise<AuthSession>
  getUser(accessToken: string): Promise<PublicUser | null>
  signOut(accessToken: string | undefined, refreshToken: string | undefined): Promise<void>
}

export interface ProjectRecord {
  id: string
  name: string
  description: string | null
  draftSchema: ProjectSchema
  draftVersion: number
  publicationSlug?: string | null
  publishedRevisionId?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface RevisionRecord {
  id: string
  projectId: string
  revisionNumber: number
  schema: ProjectSchema
  createdAt: Date
}

export interface PublicProject {
  slug: string
  projectId: string
  name: string
  description: string | null
  revisionId: string
  revisionNumber: number
  schema: ProjectSchema
  publishedAt: Date
}

export interface Repository {
  ping(): Promise<void>
  listProjects(actorId: string): Promise<ProjectRecord[]>
  createProject(
    actorId: string,
    input: { name: string; description?: string | null; schema: ProjectSchema },
  ): Promise<ProjectRecord>
  getProject(actorId: string, projectId: string): Promise<ProjectRecord | null>
  updateProject(
    actorId: string,
    projectId: string,
    input: { name?: string; description?: string | null },
  ): Promise<ProjectRecord | null>
  saveDraft(
    actorId: string,
    projectId: string,
    expectedVersion: number,
    schema: ProjectSchema,
  ): Promise<ProjectRecord | 'conflict' | null>
  listRevisions(actorId: string, projectId: string): Promise<RevisionRecord[] | null>
  publish(
    actorId: string,
    projectId: string,
    input: { expectedVersion: number; slug?: string },
  ): Promise<PublicProject | 'conflict' | null>
  rollback(actorId: string, projectId: string, revisionId: string): Promise<PublicProject | null>
  unpublish(actorId: string, projectId: string): Promise<boolean>
  getPublicProject(slug: string): Promise<PublicProject | null>
  listTemplates(): Promise<Array<Record<string, unknown>>>
  getSettings(actorId: string): Promise<Record<string, unknown>>
  updateSettings(actorId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>>
}
