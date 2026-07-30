import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { ProjectSchema } from '../validation.js'

export const appSchema = pgSchema('app')

export const spaces = appSchema.table(
  'spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    personalOwnerId: uuid('personal_owner_id'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [uniqueIndex('spaces_personal_owner_uidx').on(table.personalOwnerId)],
)

export const spaceMembers = appSchema.table(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.spaceId, table.userId], name: 'space_members_pkey' })],
)

export const projects = appSchema.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    draftSchema: jsonb('draft_schema').$type<ProjectSchema>().notNull(),
    draftVersion: integer('draft_version').notNull().default(1),
    pageCount: integer('page_count').notNull().default(1),
    canvasWidth: integer('canvas_width').notNull().default(1920),
    canvasHeight: integer('canvas_height').notNull().default(1080),
    startPageId: text('start_page_id'),
    draftSavedAt: timestamp('draft_saved_at', { withTimezone: true }).notNull().defaultNow(),
    thumbnailMode: text('thumbnail_mode').$type<'auto' | 'custom'>().notNull().default('auto'),
    thumbnailStatus: text('thumbnail_status')
      .$type<'queued' | 'rendering' | 'ready' | 'failed'>()
      .notNull()
      .default('queued'),
    thumbnailPath: text('thumbnail_path'),
    thumbnailUrl: text('thumbnail_url'),
    thumbnailDraftVersion: integer('thumbnail_draft_version'),
    thumbnailErrorCode: text('thumbnail_error_code'),
    thumbnailRequestedVersion: integer('thumbnail_requested_version'),
    thumbnailPendingPath: text('thumbnail_pending_path'),
    thumbnailPendingContentType: text('thumbnail_pending_content_type'),
    thumbnailPendingSize: integer('thumbnail_pending_size'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    index('projects_owner_updated_idx').on(table.ownerId, table.updatedAt),
    index('projects_space_updated_idx').on(table.spaceId, table.updatedAt),
  ],
)

export const projectFavorites = appSchema.table(
  'project_favorites',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.projectId, table.userId], name: 'project_favorites_pkey' })],
)

export const projectThumbnailArtifacts = appSchema.table(
  'project_thumbnail_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    path: text('path').notNull(),
    status: text('status').$type<'pending' | 'current' | 'cleanup_pending' | 'deleted'>().notNull(),
    draftVersion: integer('draft_version').notNull(),
    mode: text('mode').$type<'auto' | 'custom'>().notNull(),
    source: text('source').$type<'renderer' | 'blueprint' | 'custom'>().notNull(),
    contentType: text('content_type').$type<'image/webp' | 'image/svg+xml'>().notNull(),
    expectedSize: integer('expected_size').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    cleanupAttempts: integer('cleanup_attempts').notNull().default(0),
    nextCleanupAt: timestamp('next_cleanup_at', { withTimezone: true }),
    cleanupLeaseToken: uuid('cleanup_lease_token'),
    cleanupLeaseUntil: timestamp('cleanup_lease_until', { withTimezone: true }),
    lastError: text('last_error'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    uniqueIndex('project_thumbnail_artifacts_path_uidx').on(table.path),
    index('project_thumbnail_artifacts_cleanup_idx').on(table.projectId, table.status, table.nextCleanupAt),
    index('project_thumbnail_artifacts_global_cleanup_idx').on(
      table.status,
      table.nextCleanupAt,
      table.expiresAt,
      table.cleanupLeaseUntil,
    ),
  ],
)

export const projectRevisions = appSchema.table(
  'project_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    kind: text('kind').$type<'auto' | 'manual' | 'pre_restore' | 'publish'>().notNull(),
    label: text('label'),
    sourceDraftVersion: integer('source_draft_version').notNull(),
    schema: jsonb('schema').$type<ProjectSchema>().notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('project_revisions_project_number_uidx').on(table.projectId, table.revisionNumber),
    index('project_revisions_project_created_idx').on(table.projectId, table.createdAt),
  ],
)

export const projectPublications = appSchema.table(
  'project_publications',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull(),
    slug: text('slug').notNull(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => projectRevisions.id, { onDelete: 'restrict' }),
    isPublished: boolean('is_published').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.projectId], name: 'project_publications_pkey' }),
    uniqueIndex('project_publications_slug_uidx').on(table.slug),
  ],
)

export const projectReleases = appSchema.table(
  'project_releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    releaseNumber: integer('release_number').notNull(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => projectRevisions.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    publishedBy: uuid('published_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('project_releases_project_number_uidx').on(table.projectId, table.releaseNumber),
    uniqueIndex('project_releases_revision_uidx').on(table.revisionId),
  ],
)

export const templates = appSchema.table(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    schema: jsonb('schema').$type<ProjectSchema>().notNull(),
    isOfficial: boolean('is_official').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [uniqueIndex('templates_slug_uidx').on(table.slug)],
)

export const userSettings = appSchema.table('user_settings', {
  userId: uuid('user_id').primaryKey(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const schema = {
  spaces,
  spaceMembers,
  projects,
  projectFavorites,
  projectThumbnailArtifacts,
  projectRevisions,
  projectPublications,
  projectReleases,
  templates,
  userSettings,
}
