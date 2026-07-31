import type { ProjectSchema } from './validation.js'

export interface PublicUser {
  id: string
  email: string | null
}

export type OAuthProvider = 'github' | 'google'

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  user: PublicUser
}

export interface AuthService {
  signUp(email: string, password: string): Promise<{ user: PublicUser; session: AuthSession | null }>
  signIn(email: string, password: string): Promise<AuthSession>
  startOAuth(provider: OAuthProvider, redirectTo: string): Promise<{ url: string; codeVerifier: string }>
  exchangeCode(code: string, codeVerifier: string): Promise<AuthSession>
  requestPasswordReset(email: string, redirectTo: string): Promise<{ codeVerifier: string }>
  updatePassword(accessToken: string, refreshToken: string, password: string): Promise<AuthSession>
  refresh(refreshToken: string): Promise<AuthSession>
  getUser(accessToken: string): Promise<PublicUser | null>
  signOut(accessToken: string | undefined, refreshToken: string | undefined): Promise<void>
}

export type PersonalSpaceProvisioner = (user: PublicUser) => Promise<void>

export interface ProjectSummaryRecord {
  id: string
  name: string
  description: string | null
  coverUrl: string | null
  draftVersion: number
  isFavorite: boolean
  pageCount: number
  canvasWidth: number
  canvasHeight: number
  startPageId: string | null
  draftSavedAt: Date
  thumbnailMode: 'auto' | 'custom'
  thumbnailStatus: 'queued' | 'rendering' | 'ready' | 'failed'
  thumbnailPath: string | null
  thumbnailUrl: string | null
  thumbnailDraftVersion: number | null
  thumbnailErrorCode: string | null
  publicationSlug?: string | null
  publishedRevisionId?: string | null
  publishedAt: Date | null
  currentReleaseNumber: number | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ProjectRecord extends ProjectSummaryRecord {
  draftSchema: ProjectSchema
}

export type RevisionKind = 'auto' | 'manual' | 'pre_restore' | 'publish'
export type ThumbnailMode = 'auto' | 'custom'
export type ThumbnailSource = 'renderer' | 'blueprint' | 'custom'

export interface ThumbnailUploadContract {
  bucket: string
  path: string
  signedUrl: string
  token: string
  draftVersion: number
  mode: ThumbnailMode
  contentType: 'image/webp' | 'image/svg+xml'
  maxBytes: number
  expiresIn: number
}

export interface ThumbnailReconcileResult {
  deleted: number
  retryPending: number
}

export interface RevisionRecord {
  id: string
  projectId: string
  revisionNumber: number
  kind: RevisionKind
  label: string | null
  sourceDraftVersion: number
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
  releaseNumber: number
  schema: ProjectSchema
  publishedAt: Date
}

export interface ReleaseRecord {
  projectId: string
  releaseNumber: number
  revisionId: string
  revisionNumber: number
  name: string
  description: string | null
  publishedAt: Date
  slug: string | null
  isCurrent: boolean
  isPublished: boolean
}

export interface Repository {
  ping(): Promise<void>
  ensurePersonalSpace(actorId: string): Promise<string>
  listProjects(actorId: string, scope?: 'active' | 'trashed'): Promise<ProjectSummaryRecord[]>
  createProject(
    actorId: string,
    input: { name: string; description?: string | null; coverUrl?: string | null; schema: ProjectSchema },
  ): Promise<ProjectRecord>
  getProject(actorId: string, projectId: string): Promise<ProjectRecord | null>
  updateProject(
    actorId: string,
    projectId: string,
    input: { name?: string; description?: string | null; coverUrl?: string | null },
  ): Promise<ProjectRecord | null>
  setProjectFavorite(actorId: string, projectId: string, isFavorite: boolean): Promise<ProjectSummaryRecord | null>
  duplicateProject(actorId: string, projectId: string): Promise<ProjectRecord | null>
  trashProject(actorId: string, accessToken: string, projectId: string): Promise<boolean>
  permanentlyDeleteProject(actorId: string, accessToken: string, projectId: string): Promise<true | 'conflict' | null>
  restoreProject(actorId: string, projectId: string): Promise<ProjectRecord | null>
  saveDraft(
    actorId: string,
    projectId: string,
    expectedVersion: number,
    schema: ProjectSchema,
  ): Promise<ProjectRecord | 'conflict' | null>
  listRevisions(actorId: string, projectId: string): Promise<RevisionRecord[] | null>
  listReleases(actorId: string, projectId: string): Promise<ReleaseRecord[] | null>
  createRestorePoint(
    actorId: string,
    projectId: string,
    kind: Extract<RevisionKind, 'manual'>,
    label?: string | null,
  ): Promise<RevisionRecord | null>
  restoreRevision(
    actorId: string,
    projectId: string,
    revisionId: string,
    expectedVersion: number,
  ): Promise<ProjectRecord | 'conflict' | null>
  restoreRelease(
    actorId: string,
    projectId: string,
    releaseNumber: number,
    expectedVersion: number,
  ): Promise<ProjectRecord | 'conflict' | null>
  publish(
    actorId: string,
    projectId: string,
    input: { expectedVersion: number; slug?: string },
  ): Promise<PublicProject | 'conflict' | null>
  unpublish(actorId: string, projectId: string): Promise<boolean>
  isPublicProjectAvailable(slug: string, releaseNumber?: number): Promise<boolean>
  getPublicProject(slug: string): Promise<PublicProject | null>
  getPublicProjectVersion(slug: string, releaseNumber: number): Promise<PublicProject | null>
  createThumbnailUpload(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: {
      draftVersion: number
      mode: ThumbnailMode
      source: ThumbnailSource
      contentType: 'image/webp' | 'image/svg+xml'
      size: number
    },
  ): Promise<ThumbnailUploadContract | 'conflict' | null>
  completeThumbnailUpload(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: { draftVersion: number; path: string },
  ): Promise<ProjectSummaryRecord | 'conflict' | 'invalid' | null>
  failThumbnailUpload(
    actorId: string,
    accessToken: string,
    projectId: string,
    input: { draftVersion: number; path: string; errorCode: string },
  ): Promise<boolean | 'conflict'>
  reconcileThumbnailArtifacts(
    actorId: string,
    accessToken: string,
    projectId: string,
  ): Promise<ThumbnailReconcileResult | null>
  getThumbnailDownloadUrl(actorId: string, accessToken: string, projectId: string): Promise<string | null>
  listTemplates(): Promise<Array<Record<string, unknown>>>
  getSettings(actorId: string): Promise<Record<string, unknown>>
  updateSettings(actorId: string, settings: Record<string, unknown>): Promise<Record<string, unknown>>
}
