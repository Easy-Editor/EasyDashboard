import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../env.js'
import { ApiError, readJson } from '../http.js'
import type { AppVariables } from '../middleware/auth.js'
import type { Repository } from '../types.js'
import { slugSchema } from '../validation.js'

const settingsSchema = z.record(z.string(), z.unknown())

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
    if (env.PUBLIC_VIEWER_ORIGIN && origin === env.PUBLIC_VIEWER_ORIGIN) {
      c.header('Access-Control-Allow-Origin', env.PUBLIC_VIEWER_ORIGIN)
      c.header('Vary', 'Origin')
    }
    await next()
  })
  routes.get('/projects/:slug', async c => {
    const slug = slugSchema.safeParse(c.req.param('slug'))
    if (!slug.success) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
    const project = await repository.getPublicProject(slug.data)
    if (!project) throw new ApiError(404, 'PUBLICATION_NOT_FOUND', 'Published project not found')
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
    return c.json({ project })
  })
  return routes
}
