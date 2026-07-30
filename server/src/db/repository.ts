import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { and, asc, desc, eq, isNotNull, isNull, lte, max, ne, or, sql } from 'drizzle-orm'
import type { AppEnv } from '../env.js'
import type { PublicProject, Repository } from '../types.js'
import type { ProjectSchema } from '../validation.js'
import { createDatabase } from './client.js'
import {
  projectFavorites,
  projectPublications,
  projectReleases,
  projectRevisions,
  projectThumbnailArtifacts,
  projects,
  spaceMembers,
  spaces,
  templates,
  userSettings,
} from './schema.js'

const THUMBNAIL_BUCKET = 'easy-dashboard-thumbnails'
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024
const THUMBNAIL_UPLOAD_EXPIRES_MS = 2 * 60 * 60 * 1000
const THUMBNAIL_UPLOAD_EXPIRY_SAFETY_MS = 60 * 1000
const THUMBNAIL_UPLOAD_STAGING_EXPIRES_MS = 24 * 60 * 60 * 1000
const THUMBNAIL_CLEANUP_RETRY_MS = 5 * 60 * 1000

class ThumbnailConflictRollback extends Error {
  override readonly name = 'ThumbnailConflictRollback'
}

export function signedThumbnailUploadCleanupExpiry(token: string, signedAt = Date.now()): Date {
  const documentedExpiry = signedAt + THUMBNAIL_UPLOAD_EXPIRES_MS
  let tokenExpiry = 0
  try {
    const payload = token.split('.')[1]
    if (payload) {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
      if (typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)) {
        tokenExpiry = decoded.exp * 1000
      }
    }
  } catch {
    // Supabase currently returns a JWT, but the documented two-hour lifetime
    // remains the conservative fallback if its token representation changes.
  }
  return new Date(Math.max(documentedExpiry, tokenExpiry) + THUMBNAIL_UPLOAD_EXPIRY_SAFETY_MS)
}

export function thumbnailRequestedVersionCase(nextDraftVersion: number) {
  return sql<number>`case
    when ${projects.thumbnailMode} = 'auto' then cast(${nextDraftVersion} as integer)
    else null
  end`
}

function projectMetadata(schema: ProjectSchema): {
  pageCount: number
  canvasWidth: number
  canvasHeight: number
  startPageId: string | null
} {
  const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const envelope = record(schema)
  const editorSchema = record(envelope?.editorSchema) ?? envelope
  const presentation = record(envelope?.presentation)
  const pages = Array.isArray(editorSchema?.componentsTree) ? editorSchema.componentsTree : []
  const requestedStartPageId =
    typeof presentation?.startPageId === 'string' && presentation.startPageId ? presentation.startPageId : null
  const pageId = (page: unknown): string | null => {
    const pageRecord = record(page)
    const meta = record(pageRecord?.meta)
    const easyDashboard = record(meta?.easyDashboard)
    for (const candidate of [easyDashboard?.pageId, pageRecord?.docId, pageRecord?.id]) {
      if (typeof candidate === 'string' && candidate) return candidate
    }
    return null
  }
  const startPage = pages.find(page => pageId(page) === requestedStartPageId) ?? pages[0]
  const startPageRecord = record(startPage)
  const dashboard = record(startPageRecord?.$dashboard)
  const rect = record(dashboard?.rect)
  return {
    pageCount: Math.max(1, pages.length),
    canvasWidth: typeof rect?.width === 'number' && rect.width > 0 ? Math.round(rect.width) : 1920,
    canvasHeight: typeof rect?.height === 'number' && rect.height > 0 ? Math.round(rect.height) : 1080,
    startPageId: requestedStartPageId ?? pageId(startPage),
  }
}

function slugify(value: string, id: string): string {
  const base = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 54)
  return `${base || 'dashboard'}-${id.slice(0, 8)}`
}

export function createPgRepository(env: AppEnv): Repository {
  const { db, pool } = createDatabase(env)
  const withActor = <T>(
    actorId: string,
    run: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  ) =>
    db.transaction(async tx => {
      await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`)
      return run(tx)
    })

  const ensurePersonalSpaceWithTx = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
  ): Promise<string> => {
    const [created] = await tx
      .insert(spaces)
      .values({
        kind: 'personal',
        name: 'Personal space',
        personalOwnerId: actorId,
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: spaces.id })
    const [space] = created
      ? [created]
      : await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.personalOwnerId, actorId)).limit(1)
    if (!space) throw new Error('Personal space provisioning returned no row')
    await tx
      .insert(spaceMembers)
      .values({ spaceId: space.id, userId: actorId, role: 'owner' })
      .onConflictDoNothing({ target: [spaceMembers.spaceId, spaceMembers.userId] })
    return space.id
  }

  const projectSummarySelection = (actorId: string) => ({
    id: projects.id,
    name: projects.name,
    description: projects.description,
    coverUrl: projects.coverUrl,
    draftVersion: projects.draftVersion,
    isFavorite: sql<boolean>`exists (
      select 1 from ${projectFavorites}
      where ${projectFavorites.projectId} = ${projects.id}
        and ${projectFavorites.userId} = ${actorId}
    )`,
    pageCount: projects.pageCount,
    canvasWidth: projects.canvasWidth,
    canvasHeight: projects.canvasHeight,
    startPageId: projects.startPageId,
    draftSavedAt: projects.draftSavedAt,
    thumbnailMode: projects.thumbnailMode,
    thumbnailStatus: projects.thumbnailStatus,
    thumbnailPath: projects.thumbnailPath,
    thumbnailUrl: projects.thumbnailUrl,
    thumbnailDraftVersion: projects.thumbnailDraftVersion,
    thumbnailErrorCode: projects.thumbnailErrorCode,
    publicationSlug: projectPublications.slug,
    publishedRevisionId: projectPublications.revisionId,
    deletedAt: projects.deletedAt,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
  })

  const projectDetailSelection = (actorId: string) => ({
    ...projectSummarySelection(actorId),
    draftSchema: projects.draftSchema,
  })

  const canReadProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${spaceMembers}
    where ${spaceMembers.spaceId} = ${projects.spaceId}
      and ${spaceMembers.userId} = ${actorId}
  )`

  const canEditProject = (actorId: string) => sql<boolean>`exists (
    select 1 from ${spaceMembers}
    where ${spaceMembers.spaceId} = ${projects.spaceId}
      and ${spaceMembers.userId} = ${actorId}
      and ${spaceMembers.role} in ('owner', 'editor')
  )`

  const thumbnailStorage = (accessToken: string) =>
    createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }).storage.from(THUMBNAIL_BUCKET)

  const selectProjectDetail = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    actorId: string,
    projectId: string,
    deleted: 'active' | 'trashed' = 'active',
  ) => {
    const [project] = await tx
      .select(projectDetailSelection(actorId))
      .from(projects)
      .leftJoin(
        projectPublications,
        and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
      )
      .where(
        and(
          eq(projects.id, projectId),
          canReadProject(actorId),
          deleted === 'active' ? isNull(projects.deletedAt) : isNotNull(projects.deletedAt),
        ),
      )
      .limit(1)
    return project ?? null
  }

  const insertRevision = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    input: {
      actorId: string
      projectId: string
      schema: ProjectSchema
      kind: 'auto' | 'manual' | 'pre_restore' | 'publish'
      sourceDraftVersion: number
      label?: string | null
    },
  ) => {
    const [latest] = await tx
      .select({ value: max(projectRevisions.revisionNumber) })
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, input.projectId))
    const [revision] = await tx
      .insert(projectRevisions)
      .values({
        projectId: input.projectId,
        revisionNumber: (latest?.value ?? 0) + 1,
        schema: input.schema,
        kind: input.kind,
        sourceDraftVersion: input.sourceDraftVersion,
        label: input.label ?? null,
        createdBy: input.actorId,
      })
      .returning()
    if (!revision) throw new Error('Revision insert returned no row')
    return revision
  }

  const toPublicProject = (row: {
    slug: string
    projectId: string
    name: string
    description: string | null
    revisionId: string
    revisionNumber: number
    releaseNumber: number
    schema: ProjectSchema
    publishedAt: Date
  }): PublicProject => row

  const reconcileThumbnailArtifacts = async (actorId: string, accessToken: string, projectId: string) => {
    const now = new Date()
    const candidates = await withActor(actorId, async tx => {
      const [project] = await tx
        .select({
          id: projects.id,
          deletedAt: projects.deletedAt,
          currentPath: projects.thumbnailPath,
          pendingPath: projects.thumbnailPendingPath,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), canEditProject(actorId)))
        .for('update')
        .limit(1)
      if (!project) return null

      await tx
        .update(projectThumbnailArtifacts)
        .set({
          status: 'cleanup_pending',
          nextCleanupAt: now,
          lastError: 'upload-expired',
          updatedAt: now,
        })
        .where(
          and(
            eq(projectThumbnailArtifacts.projectId, projectId),
            eq(projectThumbnailArtifacts.status, 'pending'),
            lte(projectThumbnailArtifacts.expiresAt, now),
          ),
        )

      if (project.pendingPath) {
        const [pending] = await tx
          .select({ status: projectThumbnailArtifacts.status })
          .from(projectThumbnailArtifacts)
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, project.pendingPath),
            ),
          )
          .limit(1)
        if (pending?.status === 'cleanup_pending') {
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-expired',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(and(eq(projects.id, projectId), eq(projects.thumbnailPendingPath, project.pendingPath)))
        }
      }

      if (project.deletedAt) {
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, ${now})`,
            updatedAt: now,
          })
          .where(
            and(eq(projectThumbnailArtifacts.projectId, projectId), ne(projectThumbnailArtifacts.status, 'deleted')),
          )
        await tx
          .update(projects)
          .set({
            thumbnailPath: null,
            thumbnailUrl: null,
            thumbnailDraftVersion: null,
            thumbnailStatus: 'queued',
            thumbnailErrorCode: null,
            thumbnailRequestedVersion: null,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
          })
          .where(eq(projects.id, projectId))
      }

      return tx
        .select({ path: projectThumbnailArtifacts.path })
        .from(projectThumbnailArtifacts)
        .where(
          and(
            eq(projectThumbnailArtifacts.projectId, projectId),
            eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
            or(isNull(projectThumbnailArtifacts.nextCleanupAt), lte(projectThumbnailArtifacts.nextCleanupAt, now)),
            project.deletedAt || !project.currentPath
              ? undefined
              : ne(projectThumbnailArtifacts.path, project.currentPath),
          ),
        )
    })
    if (!candidates) return null

    let deleted = 0
    let retryPending = 0
    for (const candidate of candidates) {
      const { error } = await thumbnailStorage(accessToken).remove([candidate.path])
      if (!error) {
        const removed = await withActor(actorId, async tx => {
          const [artifact] = await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'deleted',
              deletedAt: new Date(),
              nextCleanupAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, candidate.path),
                eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
                sql`not exists (
                  select 1 from ${projects}
                  where ${projects.id} = ${projectId}
                    and ${projects.thumbnailPath} = ${candidate.path}
                )`,
              ),
            )
            .returning({ id: projectThumbnailArtifacts.id })
          return Boolean(artifact)
        })
        if (removed) deleted += 1
        continue
      }

      retryPending += 1
      await withActor(actorId, async tx => {
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            cleanupAttempts: sql`${projectThumbnailArtifacts.cleanupAttempts} + 1`,
            nextCleanupAt: new Date(Date.now() + THUMBNAIL_CLEANUP_RETRY_MS),
            lastError: error.message.slice(0, 500),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, candidate.path),
              eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
            ),
          )
      })
    }
    return { deleted, retryPending }
  }

  return {
    async ping() {
      await pool.query(`
        select
          releases.release_number,
          releases.name,
          releases.description,
          thumbnail_artifacts.path,
          thumbnail_artifacts.status
        from app.project_releases as releases
        cross join app.project_thumbnail_artifacts as thumbnail_artifacts
        limit 0
      `)
    },
    ensurePersonalSpace(actorId) {
      return withActor(actorId, tx => ensurePersonalSpaceWithTx(tx, actorId))
    },
    listProjects(actorId, scope = 'active') {
      return withActor(actorId, tx =>
        tx
          .select(projectSummarySelection(actorId))
          .from(projects)
          .leftJoin(
            projectPublications,
            and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
          )
          .where(
            and(
              canReadProject(actorId),
              scope === 'trashed' ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt),
            ),
          )
          .orderBy(
            desc(sql<boolean>`exists (
              select 1 from ${projectFavorites}
              where ${projectFavorites.projectId} = ${projects.id}
                and ${projectFavorites.userId} = ${actorId}
            )`),
            desc(projects.updatedAt),
          ),
      )
    },
    createProject(actorId, input) {
      return withActor(actorId, async tx => {
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const metadata = projectMetadata(input.schema)
        const [created] = await tx
          .insert(projects)
          .values({
            ownerId: actorId,
            spaceId,
            name: input.name,
            description: input.description ?? null,
            coverUrl: input.coverUrl ?? null,
            draftSchema: input.schema,
            ...metadata,
          })
          .returning({ id: projects.id })
        if (!created) throw new Error('Project insert returned no row')
        const project = await selectProjectDetail(tx, actorId, created.id)
        if (!project) throw new Error('Created project could not be read')
        return project
      })
    },
    getProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        return selectProjectDetail(tx, actorId, projectId)
      })
    },
    updateProject(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        return updated ? selectProjectDetail(tx, actorId, projectId) : null
      })
    },
    setProjectFavorite(actorId, projectId, isFavorite) {
      return withActor(actorId, async tx => {
        const [visible] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!visible) return null
        if (isFavorite) {
          await tx
            .insert(projectFavorites)
            .values({ projectId, userId: actorId })
            .onConflictDoNothing({ target: [projectFavorites.projectId, projectFavorites.userId] })
        } else {
          await tx
            .delete(projectFavorites)
            .where(and(eq(projectFavorites.projectId, projectId), eq(projectFavorites.userId, actorId)))
        }
        const [project] = await tx
          .select(projectSummarySelection(actorId))
          .from(projects)
          .leftJoin(
            projectPublications,
            and(eq(projectPublications.projectId, projects.id), eq(projectPublications.isPublished, true)),
          )
          .where(eq(projects.id, projectId))
          .limit(1)
        return project ?? null
      })
    },
    duplicateProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [source] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!source) return null
        const spaceId = await ensurePersonalSpaceWithTx(tx, actorId)
        const [copy] = await tx
          .insert(projects)
          .values({
            ownerId: actorId,
            spaceId,
            name: `${source.name} copy`.slice(0, 120),
            description: source.description,
            coverUrl: source.coverUrl,
            draftSchema: source.draftSchema,
            ...projectMetadata(source.draftSchema),
          })
          .returning({ id: projects.id })
        if (!copy) throw new Error('Project duplicate returned no row')
        return selectProjectDetail(tx, actorId, copy.id)
      })
    },
    async trashProject(actorId, accessToken, projectId) {
      const trashed = await withActor(actorId, async tx => {
        const now = new Date()
        const [project] = await tx
          .update(projects)
          .set({
            deletedAt: now,
            thumbnailPath: null,
            thumbnailUrl: null,
            thumbnailDraftVersion: null,
            thumbnailStatus: 'queued',
            thumbnailErrorCode: null,
            thumbnailRequestedVersion: null,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            updatedAt: now,
          })
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .returning({ id: projects.id })
        if (!project) return false
        await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, ${now})`,
            updatedAt: now,
          })
          .where(
            and(eq(projectThumbnailArtifacts.projectId, projectId), ne(projectThumbnailArtifacts.status, 'deleted')),
          )
        await tx
          .update(projectPublications)
          .set({ isPublished: false, updatedAt: now })
          .where(eq(projectPublications.projectId, projectId))
        return true
      })
      if (trashed) await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      return trashed
    },
    restoreProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projects)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNotNull(projects.deletedAt)))
          .returning({ id: projects.id })
        return updated ? selectProjectDetail(tx, actorId, projectId) : null
      })
    },
    saveDraft(actorId, projectId, expectedVersion, draftSchema) {
      return withActor(actorId, async tx => {
        const savedAt = new Date()
        const [updated] = await tx
          .update(projects)
          .set({
            draftSchema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: savedAt,
            ...projectMetadata(draftSchema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: savedAt,
          })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              eq(projects.draftVersion, expectedVersion),
              isNull(projects.deletedAt),
            ),
          )
          .returning()
        if (updated) {
          const [latestAuto] = await tx
            .select({ createdAt: projectRevisions.createdAt })
            .from(projectRevisions)
            .where(and(eq(projectRevisions.projectId, projectId), eq(projectRevisions.kind, 'auto')))
            .orderBy(desc(projectRevisions.createdAt))
            .limit(1)
          if (!latestAuto || savedAt.getTime() - latestAuto.createdAt.getTime() >= 5 * 60 * 1000) {
            await insertRevision(tx, {
              actorId,
              projectId,
              schema: draftSchema,
              kind: 'auto',
              sourceDraftVersion: expectedVersion + 1,
            })
          }
          const project = await selectProjectDetail(tx, actorId, projectId)
          if (!project) throw new Error('Saved project could not be read')
          return project
        }
        const [existing] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return existing ? 'conflict' : null
      })
    },
    listRevisions(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [owned] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        if (!owned) return null
        return tx
          .select({
            id: projectRevisions.id,
            projectId: projectRevisions.projectId,
            revisionNumber: projectRevisions.revisionNumber,
            kind: projectRevisions.kind,
            label: projectRevisions.label,
            sourceDraftVersion: projectRevisions.sourceDraftVersion,
            schema: projectRevisions.schema,
            createdAt: projectRevisions.createdAt,
          })
          .from(projectRevisions)
          .where(and(eq(projectRevisions.projectId, projectId), ne(projectRevisions.kind, 'publish')))
          .orderBy(desc(projectRevisions.revisionNumber))
      })
    },
    listReleases(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [visible] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId)))
          .limit(1)
        if (!visible) return null
        return tx
          .select({
            projectId: projectReleases.projectId,
            releaseNumber: projectReleases.releaseNumber,
            revisionId: projectReleases.revisionId,
            revisionNumber: projectRevisions.revisionNumber,
            name: projectReleases.name,
            description: projectReleases.description,
            publishedAt: projectReleases.publishedAt,
            slug: projectPublications.slug,
            isCurrent: sql<boolean>`${projectPublications.revisionId} = ${projectReleases.revisionId}`,
            isPublished: sql<boolean>`coalesce(${projectPublications.isPublished}, false)`,
          })
          .from(projectReleases)
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .leftJoin(projectPublications, eq(projectPublications.projectId, projectReleases.projectId))
          .where(eq(projectReleases.projectId, projectId))
          .orderBy(desc(projectReleases.releaseNumber))
      })
    },
    createRestorePoint(actorId, projectId, kind, label) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            draftSchema: projects.draftSchema,
            draftVersion: projects.draftVersion,
          })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        return insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind,
          sourceDraftVersion: project.draftVersion,
          label,
        })
      })
    },
    restoreRevision(actorId, projectId, revisionId, expectedVersion) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== expectedVersion) return 'conflict'
        const [revision] = await tx
          .select({ schema: projectRevisions.schema })
          .from(projectRevisions)
          .where(
            and(
              eq(projectRevisions.id, revisionId),
              eq(projectRevisions.projectId, projectId),
              ne(projectRevisions.kind, 'publish'),
            ),
          )
          .limit(1)
        if (!revision) return null
        await insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind: 'pre_restore',
          sourceDraftVersion: project.draftVersion,
        })
        const [restored] = await tx
          .update(projects)
          .set({
            draftSchema: revision.schema,
            draftVersion: expectedVersion + 1,
            draftSavedAt: new Date(),
            ...projectMetadata(revision.schema),
            thumbnailStatus: sql`case
              when ${projects.thumbnailMode} = 'auto' then 'queued'
              when ${projects.thumbnailPath} is not null then 'ready'
              else 'failed'
            end`,
            thumbnailRequestedVersion: thumbnailRequestedVersionCase(expectedVersion + 1),
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
            thumbnailErrorCode: sql`case
              when ${projects.thumbnailMode} = 'auto' then null
              when ${projects.thumbnailPath} is not null then null
              else 'draft-version-changed'
            end`,
            updatedAt: new Date(),
          })
          .where(and(eq(projects.id, projectId), eq(projects.draftVersion, expectedVersion)))
          .returning({ id: projects.id })
        if (!restored) return 'conflict'
        const detail = await selectProjectDetail(tx, actorId, projectId)
        if (!detail) throw new Error('Restored project could not be read')
        return detail
      })
    },
    publish(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== input.expectedVersion) return 'conflict'

        const revision = await insertRevision(tx, {
          actorId,
          projectId,
          schema: project.draftSchema,
          kind: 'publish',
          sourceDraftVersion: project.draftVersion,
        })
        const [latestRelease] = await tx
          .select({ value: max(projectReleases.releaseNumber) })
          .from(projectReleases)
          .where(eq(projectReleases.projectId, projectId))
        const releaseNumber = (latestRelease?.value ?? 0) + 1
        const [release] = await tx
          .insert(projectReleases)
          .values({
            projectId,
            releaseNumber,
            revisionId: revision.id,
            name: project.name,
            description: project.description,
            publishedBy: actorId,
          })
          .returning()
        if (!release) throw new Error('Release insert returned no row')

        const [existingPublication] = await tx
          .select({ slug: projectPublications.slug })
          .from(projectPublications)
          .where(eq(projectPublications.projectId, projectId))
          .limit(1)
        const slug = existingPublication?.slug ?? input.slug ?? slugify(project.name, project.id)
        const [publication] = await tx
          .insert(projectPublications)
          .values({ projectId, ownerId: project.ownerId, revisionId: revision.id, slug })
          .onConflictDoUpdate({
            target: projectPublications.projectId,
            set: {
              revisionId: revision.id,
              isPublished: true,
              publishedAt: release.publishedAt,
              updatedAt: release.publishedAt,
            },
          })
          .returning()
        if (!publication) throw new Error('Publication upsert returned no row')
        return toPublicProject({
          slug: publication.slug,
          projectId: project.id,
          name: release.name,
          description: release.description,
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
          releaseNumber: release.releaseNumber,
          schema: revision.schema,
          publishedAt: release.publishedAt,
        })
      })
    },
    rollback(actorId, projectId, revisionId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
          .for('update')
          .limit(1)
        if (!project) return null

        const [row] = await tx
          .select({
            projectId: projects.id,
            name: projectReleases.name,
            description: projectReleases.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            releaseNumber: projectReleases.releaseNumber,
            schema: projectRevisions.schema,
            slug: projectPublications.slug,
          })
          .from(projects)
          .innerJoin(projectRevisions, eq(projectRevisions.projectId, projects.id))
          .innerJoin(projectReleases, eq(projectReleases.revisionId, projectRevisions.id))
          .innerJoin(projectPublications, eq(projectPublications.projectId, projects.id))
          .where(and(eq(projects.id, projectId), canEditProject(actorId), eq(projectRevisions.id, revisionId)))
          .limit(1)
        if (!row) return null
        const [publication] = await tx
          .update(projectPublications)
          .set({ revisionId, isPublished: true, publishedAt: new Date(), updatedAt: new Date() })
          .where(eq(projectPublications.projectId, projectId))
          .returning()
        if (!publication) return null
        return toPublicProject({ ...row, publishedAt: publication.publishedAt })
      })
    },
    unpublish(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), canEditProject(actorId)))
          .for('update')
          .limit(1)
        if (!project) return false

        const removed = await tx
          .update(projectPublications)
          .set({ isPublished: false, updatedAt: new Date() })
          .where(and(eq(projectPublications.projectId, projectId), eq(projectPublications.isPublished, true)))
          .returning({ projectId: projectPublications.projectId })
        return removed.length > 0
      })
    },
    async isPublicProjectAvailable(slug, releaseNumber) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        let query = tx
          .select({ projectId: projects.id })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))

        if (releaseNumber !== undefined) {
          query = query.innerJoin(projectReleases, eq(projectReleases.projectId, projects.id))
        }

        const [row] = await query
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              releaseNumber === undefined ? undefined : eq(projectReleases.releaseNumber, releaseNumber),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return Boolean(row)
      })
    },
    async getPublicProject(slug) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        const [row] = await tx
          .select({
            slug: projectPublications.slug,
            projectId: projects.id,
            name: projectReleases.name,
            description: projectReleases.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            releaseNumber: projectReleases.releaseNumber,
            schema: projectRevisions.schema,
            publishedAt: projectReleases.publishedAt,
          })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectPublications.revisionId))
          .innerJoin(projectReleases, eq(projectReleases.revisionId, projectRevisions.id))
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return row ? toPublicProject(row) : null
      })
    },
    async getPublicProjectVersion(slug, releaseNumber) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        const [row] = await tx
          .select({
            slug: projectPublications.slug,
            projectId: projects.id,
            name: projectReleases.name,
            description: projectReleases.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            releaseNumber: projectReleases.releaseNumber,
            schema: projectRevisions.schema,
            publishedAt: projectReleases.publishedAt,
          })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))
          .innerJoin(projectReleases, eq(projectReleases.projectId, projects.id))
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectReleases.revisionId))
          .where(
            and(
              eq(projectPublications.slug, slug),
              eq(projectPublications.isPublished, true),
              eq(projectReleases.releaseNumber, releaseNumber),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return row ? toPublicProject(row) : null
      })
    },
    async createThumbnailUpload(actorId, accessToken, projectId, input) {
      const validArtifact =
        input.size > 0 &&
        input.size <= MAX_THUMBNAIL_BYTES &&
        ((input.mode === 'auto' &&
          ((input.source === 'renderer' && input.contentType === 'image/webp') ||
            (input.source === 'blueprint' && input.contentType === 'image/svg+xml'))) ||
          (input.mode === 'custom' && input.source === 'custom' && input.contentType === 'image/webp'))
      if (!validArtifact) return null

      const reconciled = await reconcileThumbnailArtifacts(actorId, accessToken, projectId)
      if (!reconciled) return null

      const extension = input.contentType === 'image/webp' ? 'webp' : 'svg'
      const path = `${actorId}/${projectId}/${input.draftVersion}/${randomUUID()}.${extension}`
      // The ledger must exist before Supabase evaluates the signed-upload RLS
      // policy. Use a deliberately long staging deadline, then replace it with
      // the signed token's real expiry after signing completes. If signing or
      // persistence fails, the longer deadline can only delay cleanup; it can
      // never delete an object while a returned upload URL is still valid.
      const expiresAt = new Date(Date.now() + THUMBNAIL_UPLOAD_STAGING_EXPIRES_MS)
      let prepared: true | 'conflict' | null
      try {
        prepared = await withActor(actorId, async tx => {
          const [locked] = await tx
            .select({ id: projects.id, draftVersion: projects.draftVersion })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!locked) return null
          if (locked.draftVersion !== input.draftVersion) return 'conflict'

          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'superseded',
              updatedAt: new Date(),
            })
            .where(
              and(eq(projectThumbnailArtifacts.projectId, projectId), eq(projectThumbnailArtifacts.status, 'pending')),
            )
          await tx.insert(projectThumbnailArtifacts).values({
            projectId,
            path,
            status: 'pending',
            draftVersion: input.draftVersion,
            mode: input.mode,
            source: input.source,
            contentType: input.contentType,
            expectedSize: input.size,
            expiresAt,
            createdBy: actorId,
          })
          const [updated] = await tx
            .update(projects)
            .set({
              thumbnailMode: input.mode,
              thumbnailStatus: 'rendering',
              thumbnailRequestedVersion: input.draftVersion,
              thumbnailPendingPath: path,
              thumbnailPendingContentType: input.contentType,
              thumbnailPendingSize: input.size,
              thumbnailErrorCode: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                isNull(projects.deletedAt),
                eq(projects.draftVersion, input.draftVersion),
              ),
            )
            .returning({ id: projects.id })
          if (!updated) throw new ThumbnailConflictRollback()
          return true
        })
      } catch (error) {
        if (error instanceof ThumbnailConflictRollback) prepared = 'conflict'
        else throw error
      }
      if (prepared !== true) return prepared

      const { data, error } = await thumbnailStorage(accessToken).createSignedUploadUrl(path)
      if (error || !data) {
        await withActor(actorId, async tx => {
          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'upload-signing-failed',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, path),
                eq(projectThumbnailArtifacts.status, 'pending'),
              ),
            )
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-signing-failed',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.thumbnailPendingPath, path),
              ),
            )
        })
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
        throw new Error(error?.message ?? 'Supabase did not return a signed thumbnail upload URL')
      }
      const signedExpiresAt = signedThumbnailUploadCleanupExpiry(data.token)
      const signedExpiryPersisted = await withActor(actorId, async tx => {
        const [updated] = await tx
          .update(projectThumbnailArtifacts)
          .set({
            expiresAt: signedExpiresAt,
            nextCleanupAt: sql`case
              when ${projectThumbnailArtifacts.status} = 'cleanup_pending'
                then greatest(
                  coalesce(${projectThumbnailArtifacts.nextCleanupAt}, ${signedExpiresAt}),
                  ${signedExpiresAt}
                )
              else ${projectThumbnailArtifacts.nextCleanupAt}
            end`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, path),
              or(
                eq(projectThumbnailArtifacts.status, 'pending'),
                eq(projectThumbnailArtifacts.status, 'cleanup_pending'),
              ),
            ),
          )
          .returning({ id: projectThumbnailArtifacts.id })
        return Boolean(updated)
      })
      if (!signedExpiryPersisted) {
        throw new Error('Signed thumbnail upload was invalidated before its expiry could be recorded')
      }
      await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      return {
        bucket: THUMBNAIL_BUCKET,
        path,
        signedUrl: data.signedUrl,
        token: data.token,
        draftVersion: input.draftVersion,
        mode: input.mode,
        contentType: input.contentType,
        maxBytes: MAX_THUMBNAIL_BYTES,
        expiresIn: 7200,
      }
    },
    async completeThumbnailUpload(actorId, accessToken, projectId, input) {
      const pending = await withActor(actorId, async tx => {
        const [artifact] = await tx
          .select({
            draftVersion: projectThumbnailArtifacts.draftVersion,
            path: projectThumbnailArtifacts.path,
            contentType: projectThumbnailArtifacts.contentType,
            size: projectThumbnailArtifacts.expectedSize,
            expiresAt: projectThumbnailArtifacts.expiresAt,
          })
          .from(projectThumbnailArtifacts)
          .innerJoin(projects, eq(projects.id, projectThumbnailArtifacts.projectId))
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, input.path),
              eq(projectThumbnailArtifacts.status, 'pending'),
              canEditProject(actorId),
              isNull(projects.deletedAt),
            ),
          )
          .limit(1)
        return artifact ?? null
      })
      if (!pending) return null
      if (pending.expiresAt.getTime() <= Date.now()) {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
        return 'conflict'
      }
      if (pending.draftVersion !== input.draftVersion || pending.path !== input.path) {
        return 'conflict'
      }

      const { data: info, error } = await thumbnailStorage(accessToken).info(input.path)
      if (
        error ||
        !info ||
        info.size !== pending.size ||
        info.contentType !== pending.contentType ||
        info.size > MAX_THUMBNAIL_BYTES
      ) {
        await withActor(actorId, async tx => {
          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'upload-validation-failed',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, input.path),
                eq(projectThumbnailArtifacts.status, 'pending'),
              ),
            )
          await tx
            .update(projects)
            .set({
              thumbnailStatus: 'failed',
              thumbnailErrorCode: 'upload-validation-failed',
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.thumbnailPendingPath, input.path),
                eq(projects.thumbnailRequestedVersion, input.draftVersion),
              ),
            )
        })
        return 'invalid'
      }

      let completed: Awaited<ReturnType<Repository['completeThumbnailUpload']>>
      try {
        completed = await withActor(actorId, async tx => {
          const [locked] = await tx
            .select({
              id: projects.id,
              draftVersion: projects.draftVersion,
              requestedVersion: projects.thumbnailRequestedVersion,
              pendingPath: projects.thumbnailPendingPath,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .for('update')
            .limit(1)
          if (!locked) return null
          if (
            locked.draftVersion !== input.draftVersion ||
            locked.requestedVersion !== input.draftVersion ||
            locked.pendingPath !== input.path
          ) {
            return 'conflict'
          }

          const [promoted] = await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'current',
              nextCleanupAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.path, input.path),
                eq(projectThumbnailArtifacts.status, 'pending'),
                eq(projectThumbnailArtifacts.draftVersion, input.draftVersion),
              ),
            )
            .returning({ id: projectThumbnailArtifacts.id })
          if (!promoted) return 'conflict'

          await tx
            .update(projectThumbnailArtifacts)
            .set({
              status: 'cleanup_pending',
              nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
              lastError: 'replaced',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projectThumbnailArtifacts.projectId, projectId),
                eq(projectThumbnailArtifacts.status, 'current'),
                ne(projectThumbnailArtifacts.path, input.path),
              ),
            )
          const [updated] = await tx
            .update(projects)
            .set({
              thumbnailStatus: 'ready',
              thumbnailPath: input.path,
              thumbnailUrl: `/api/projects/${projectId}/thumbnail/content`,
              thumbnailDraftVersion: input.draftVersion,
              thumbnailErrorCode: null,
              thumbnailPendingPath: null,
              thumbnailPendingContentType: null,
              thumbnailPendingSize: null,
            })
            .where(
              and(
                eq(projects.id, projectId),
                canEditProject(actorId),
                isNull(projects.deletedAt),
                eq(projects.thumbnailStatus, 'rendering'),
                eq(projects.draftVersion, input.draftVersion),
                eq(projects.thumbnailRequestedVersion, input.draftVersion),
                eq(projects.thumbnailPendingPath, input.path),
              ),
            )
            .returning({ id: projects.id })
          if (!updated) throw new ThumbnailConflictRollback()
          const project = await selectProjectDetail(tx, actorId, projectId)
          if (!project) throw new Error('Completed thumbnail project could not be read')
          return project
        })
      } catch (error) {
        if (error instanceof ThumbnailConflictRollback) completed = 'conflict'
        else throw error
      }
      if (completed && completed !== 'conflict') {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      }
      return completed
    },
    async failThumbnailUpload(actorId, accessToken, projectId, input) {
      const failed = await withActor(actorId, async tx => {
        const [artifact] = await tx
          .update(projectThumbnailArtifacts)
          .set({
            status: 'cleanup_pending',
            nextCleanupAt: sql`greatest(${projectThumbnailArtifacts.expiresAt}, now())`,
            lastError: input.errorCode,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(projectThumbnailArtifacts.projectId, projectId),
              eq(projectThumbnailArtifacts.path, input.path),
              eq(projectThumbnailArtifacts.status, 'pending'),
              eq(projectThumbnailArtifacts.draftVersion, input.draftVersion),
            ),
          )
          .returning({ id: projectThumbnailArtifacts.id })
        if (!artifact) {
          const [existing] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, projectId), canEditProject(actorId), isNull(projects.deletedAt)))
            .limit(1)
          return existing ? 'conflict' : false
        }
        const [updated] = await tx
          .update(projects)
          .set({
            thumbnailStatus: 'failed',
            thumbnailErrorCode: input.errorCode,
            thumbnailPendingPath: null,
            thumbnailPendingContentType: null,
            thumbnailPendingSize: null,
          })
          .where(
            and(
              eq(projects.id, projectId),
              canEditProject(actorId),
              isNull(projects.deletedAt),
              eq(projects.thumbnailStatus, 'rendering'),
              eq(projects.thumbnailRequestedVersion, input.draftVersion),
              eq(projects.thumbnailPendingPath, input.path),
            ),
          )
          .returning({ id: projects.id })
        if (updated) return true
        return 'conflict'
      })
      if (failed === true) {
        await reconcileThumbnailArtifacts(actorId, accessToken, projectId).catch(() => undefined)
      }
      return failed
    },
    reconcileThumbnailArtifacts,
    async getThumbnailDownloadUrl(actorId, accessToken, projectId) {
      const path = await withActor(actorId, async tx => {
        const [project] = await tx
          .select({ thumbnailPath: projects.thumbnailPath })
          .from(projects)
          .where(and(eq(projects.id, projectId), canReadProject(actorId), isNull(projects.deletedAt)))
          .limit(1)
        return project?.thumbnailPath ?? null
      })
      if (!path) return null
      const { data, error } = await thumbnailStorage(accessToken).createSignedUrl(path, 60)
      if (error || !data) throw new Error(error?.message ?? 'Supabase did not return a signed thumbnail URL')
      return data.signedUrl
    },
    async listTemplates() {
      return db.select().from(templates).where(eq(templates.isOfficial, true)).orderBy(asc(templates.name))
    },
    getSettings(actorId) {
      return withActor(actorId, async tx => {
        const [row] = await tx.select().from(userSettings).where(eq(userSettings.userId, actorId)).limit(1)
        return row?.settings ?? {}
      })
    },
    updateSettings(actorId, settings) {
      return withActor(actorId, async tx => {
        const [row] = await tx
          .insert(userSettings)
          .values({ userId: actorId, settings })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { settings, updatedAt: new Date() },
          })
          .returning()
        return row?.settings ?? settings
      })
    },
  }
}
