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

export const projects = appSchema.table(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    draftSchema: jsonb('draft_schema').$type<ProjectSchema>().notNull(),
    draftVersion: integer('draft_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index('projects_owner_updated_idx').on(table.ownerId, table.updatedAt)],
)

export const projectRevisions = appSchema.table(
  'project_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
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
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.projectId], name: 'project_publications_pkey' }),
    uniqueIndex('project_publications_slug_uidx').on(table.slug),
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
  projects,
  projectRevisions,
  projectPublications,
  templates,
  userSettings,
}
