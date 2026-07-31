import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { PublicProject, Repository } from '../types.js'
import { slugSchema } from '../validation.js'

const settingsSchema = z.record(z.string(), z.unknown())
const LOCAL_VIEWER_ORIGINS = new Set(['http://localhost:5174', 'http://view.localhost:5174'])

function isAllowedViewerOrigin(origin: string | undefined, env: AppEnv): boolean {
  if (!origin) return false
  if (env.PUBLIC_VIEWER_ORIGIN) return origin === env.PUBLIC_VIEWER_ORIGIN
  return env.NODE_ENV === 'development' && LOCAL_VIEWER_ORIGINS.has(origin)
}

function publicProjectPayload(project: PublicProject) {
  return {
    projectId: project.projectId,
    slug: project.slug,
    name: project.name,
    description: project.description,
    releaseNumber: project.releaseNumber,
    document: project.schema,
    publishedAt: project.publishedAt,
  }
}

function publicProjectResponse(c: {
  header(name: string, value: string): void
  body(body: null, status: 204): Response
}) {
  c.header('Cache-Control', 'private, no-store')
  return c.body(null, 204)
}

export function createPrivateMiscRoutes(repository: Repository) {
  const routes = new Hono<{ Variables: AppVariables }>()
  routes.get('/templates', async c => c.json({ templates: await repository.listTemplates() }))
  routes.get('/settings', async c => c.json({ settings: await repository.getSettings(c.get('actorId')) }))
  routes.patch('/settings', async c => {
    const settings = await readJson(c, settingsSchema)
    return c.json({ settings: await repository.updateSettings(c.get('actorId'), settings) })
  })
  return routes
}

export function createPublicRoutes(repository: Repository, env: AppEnv) {
  const routes = new Hono()
  routes.use('*', async (c, next) => {
    const origin = c.req.header('Origin')
    if (isAllowedViewerOrigin(origin, env)) {
      c.header('Access-Control-Allow-Origin', origin)
      c.header('Vary', 'Origin')
    }
    await next()
  })
  routes.get('/projects/:slug', async c => {
    const slug = slugSchema.safeParse(c.req.param('slug'))
    if (!slug.success) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
    if (c.req.query('probe') === '1') {
      const isAvailable = await repository.isPublicProjectAvailable(slug.data)
      if (!isAvailable) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
      return publicProjectResponse(c)
    }
    const project = await repository.getPublicProject(slug.data)
    if (!project) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
    c.header('Cache-Control', 'public, max-age=0, must-revalidate')
    return c.json({ project: publicProjectPayload(project) })
  })
  routes.get('/projects/:slug/versions/:releaseNumber', async c => {
    const slug = slugSchema.safeParse(c.req.param('slug'))
    const releaseNumber = z.coerce.number().int().positive().safeParse(c.req.param('releaseNumber'))
    if (!slug.success || !releaseNumber.success) {
      throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
    }
    if (c.req.query('probe') === '1') {
      const isAvailable = await repository.isPublicProjectAvailable(slug.data, releaseNumber.data)
      if (!isAvailable) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
      return publicProjectResponse(c)
    }
    const project = await repository.getPublicProjectVersion(slug.data, releaseNumber.data)
    if (!project) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
    // Version contents are immutable, but publication visibility is revocable.
    // Revalidation is required so unpublish/trash can make every URL return 404.
    c.header('Cache-Control', 'public, max-age=0, must-revalidate')
    return c.json({ project: publicProjectPayload(project) })
  })
  return routes
}
