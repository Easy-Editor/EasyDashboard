import { Hono } from 'hono'
import { z } from 'zod'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { ValidationError, assertSchemaBudget, projectIdSchema, projectSchemaSchema, slugSchema } from '../validation.js'

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  schema: projectSchemaSchema,
})

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .refine(value => Object.keys(value).length > 0, 'At least one field is required')

const draftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  schema: projectSchemaSchema,
})

const publishSchema = z.object({
  expectedVersion: z.number().int().positive(),
  slug: slugSchema.optional(),
})

const rollbackSchema = z.object({ revisionId: z.uuid() })

function idFrom(c: { req: { param(name: string): string } }): string {
  const result = projectIdSchema.safeParse(c.req.param('projectId'))
  if (!result.success) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return result.data
}

function assertBudget(schema: Record<string, unknown>): void {
  try {
    assertSchemaBudget(schema)
  } catch (error) {
    if (error instanceof ValidationError) throw new ApiError(413, error.code, error.message)
    throw error
  }
}

export function createProjectRoutes(repository: Repository) {
  const routes = new Hono<{ Variables: AppVariables }>()

  routes.get('/', async c => c.json({ projects: await repository.listProjects(c.get('actorId')) }))

  routes.post('/', async c => {
    const input = await readJson(c, createProjectSchema)
    assertBudget(input.schema)
    const project = await repository.createProject(c.get('actorId'), input)
    return c.json({ project }, 201)
  })

  routes.get('/:projectId', async c => {
    const project = await repository.getProject(c.get('actorId'), idFrom(c))
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project })
  })

  routes.patch('/:projectId', async c => {
    const input = await readJson(c, updateProjectSchema)
    const project = await repository.updateProject(c.get('actorId'), idFrom(c), input)
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project })
  })

  routes.put('/:projectId/draft', async c => {
    const input = await readJson(c, draftSchema)
    assertBudget(input.schema)
    const result = await repository.saveDraft(c.get('actorId'), idFrom(c), input.expectedVersion, input.schema)
    if (result === 'conflict') throw new ApiError(409, 'DRAFT_CONFLICT', 'The saved draft has changed')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ project: result })
  })

  routes.get('/:projectId/revisions', async c => {
    const revisions = await repository.listRevisions(c.get('actorId'), idFrom(c))
    if (!revisions) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ revisions })
  })

  routes.post('/:projectId/publish', async c => {
    const input = await readJson(c, publishSchema)
    const result = await repository.publish(c.get('actorId'), idFrom(c), input)
    if (result === 'conflict') throw new ApiError(409, 'DRAFT_CONFLICT', 'Publish requires the current saved draft')
    if (!result) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found')
    return c.json({ publication: result }, 201)
  })

  routes.post('/:projectId/rollback', async c => {
    const input = await readJson(c, rollbackSchema)
    const publication = await repository.rollback(c.get('actorId'), idFrom(c), input.revisionId)
    if (!publication) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Published project or revision not found')
    return c.json({ publication })
  })

  routes.post('/:projectId/unpublish', async c => {
    const removed = await repository.unpublish(c.get('actorId'), idFrom(c))
    if (!removed) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Publication not found')
    return c.body(null, 204)
  })

  return routes
}
