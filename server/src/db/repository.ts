import { and, asc, desc, eq, max, sql } from 'drizzle-orm'
import type { AppEnv } from '../env.js'
import type { PublicProject, Repository } from '../types.js'
import type { ProjectSchema } from '../validation.js'
import { createDatabase } from './client.js'
import { projectPublications, projectRevisions, projects, templates, userSettings } from './schema.js'

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

  const toPublicProject = (row: {
    slug: string
    projectId: string
    name: string
    description: string | null
    revisionId: string
    revisionNumber: number
    schema: ProjectSchema
    publishedAt: Date
  }): PublicProject => row

  return {
    async ping() {
      await pool.query('select 1')
    },
    listProjects(actorId) {
      return withActor(actorId, tx =>
        tx
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            draftSchema: projects.draftSchema,
            draftVersion: projects.draftVersion,
            publicationSlug: projectPublications.slug,
            publishedRevisionId: projectPublications.revisionId,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .leftJoin(projectPublications, eq(projectPublications.projectId, projects.id))
          .where(eq(projects.ownerId, actorId))
          .orderBy(desc(projects.updatedAt)),
      )
    },
    createProject(actorId, input) {
      return withActor(actorId, async tx => {
        const [created] = await tx
          .insert(projects)
          .values({
            ownerId: actorId,
            name: input.name,
            description: input.description ?? null,
            draftSchema: input.schema,
          })
          .returning()
        if (!created) throw new Error('Project insert returned no row')
        return created
      })
    },
    getProject(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            draftSchema: projects.draftSchema,
            draftVersion: projects.draftVersion,
            publicationSlug: projectPublications.slug,
            publishedRevisionId: projectPublications.revisionId,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .leftJoin(projectPublications, eq(projectPublications.projectId, projects.id))
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
          .limit(1)
        return project ?? null
      })
    },
    updateProject(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .update(projects)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
          .returning()
        return project ?? null
      })
    },
    saveDraft(actorId, projectId, expectedVersion, draftSchema) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .update(projects)
          .set({
            draftSchema,
            draftVersion: expectedVersion + 1,
            updatedAt: new Date(),
          })
          .where(
            and(eq(projects.id, projectId), eq(projects.ownerId, actorId), eq(projects.draftVersion, expectedVersion)),
          )
          .returning()
        if (project) return project
        const [existing] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
          .limit(1)
        return existing ? 'conflict' : null
      })
    },
    listRevisions(actorId, projectId) {
      return withActor(actorId, async tx => {
        const [owned] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
          .limit(1)
        if (!owned) return null
        return tx
          .select({
            id: projectRevisions.id,
            projectId: projectRevisions.projectId,
            revisionNumber: projectRevisions.revisionNumber,
            schema: projectRevisions.schema,
            createdAt: projectRevisions.createdAt,
          })
          .from(projectRevisions)
          .where(eq(projectRevisions.projectId, projectId))
          .orderBy(desc(projectRevisions.revisionNumber))
      })
    },
    publish(actorId, projectId, input) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select()
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
          .for('update')
          .limit(1)
        if (!project) return null
        if (project.draftVersion !== input.expectedVersion) return 'conflict'

        const [latest] = await tx
          .select({ value: max(projectRevisions.revisionNumber) })
          .from(projectRevisions)
          .where(eq(projectRevisions.projectId, projectId))
        const [revision] = await tx
          .insert(projectRevisions)
          .values({
            projectId,
            revisionNumber: (latest?.value ?? 0) + 1,
            schema: project.draftSchema,
            createdBy: actorId,
          })
          .returning()
        if (!revision) throw new Error('Revision insert returned no row')

        const slug = input.slug ?? slugify(project.name, project.id)
        const [publication] = await tx
          .insert(projectPublications)
          .values({ projectId, ownerId: actorId, revisionId: revision.id, slug })
          .onConflictDoUpdate({
            target: projectPublications.projectId,
            set: { revisionId: revision.id, slug, publishedAt: new Date(), updatedAt: new Date() },
          })
          .returning()
        if (!publication) throw new Error('Publication upsert returned no row')
        return toPublicProject({
          slug: publication.slug,
          projectId: project.id,
          name: project.name,
          description: project.description,
          revisionId: revision.id,
          revisionNumber: revision.revisionNumber,
          schema: revision.schema,
          publishedAt: publication.publishedAt,
        })
      })
    },
    rollback(actorId, projectId, revisionId) {
      return withActor(actorId, async tx => {
        const [project] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
          .for('update')
          .limit(1)
        if (!project) return null

        const [row] = await tx
          .select({
            projectId: projects.id,
            name: projects.name,
            description: projects.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            schema: projectRevisions.schema,
            slug: projectPublications.slug,
          })
          .from(projects)
          .innerJoin(projectRevisions, eq(projectRevisions.projectId, projects.id))
          .innerJoin(projectPublications, eq(projectPublications.projectId, projects.id))
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId), eq(projectRevisions.id, revisionId)))
          .limit(1)
        if (!row) return null
        const [publication] = await tx
          .update(projectPublications)
          .set({ revisionId, publishedAt: new Date(), updatedAt: new Date() })
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
          .where(and(eq(projects.id, projectId), eq(projects.ownerId, actorId)))
          .for('update')
          .limit(1)
        if (!project) return false

        const removed = await tx
          .delete(projectPublications)
          .where(eq(projectPublications.projectId, projectId))
          .returning({ projectId: projectPublications.projectId })
        return removed.length > 0
      })
    },
    async getPublicProject(slug) {
      return db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.public_slug', ${slug}, true)`)
        const [row] = await tx
          .select({
            slug: projectPublications.slug,
            projectId: projects.id,
            name: projects.name,
            description: projects.description,
            revisionId: projectRevisions.id,
            revisionNumber: projectRevisions.revisionNumber,
            schema: projectRevisions.schema,
            publishedAt: projectPublications.publishedAt,
          })
          .from(projectPublications)
          .innerJoin(projects, eq(projects.id, projectPublications.projectId))
          .innerJoin(projectRevisions, eq(projectRevisions.id, projectPublications.revisionId))
          .where(eq(projectPublications.slug, slug))
          .limit(1)
        return row ? toPublicProject(row) : null
      })
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
