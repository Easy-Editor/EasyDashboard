import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'
import { LINKED_MATERIALS_ROUTE_PREFIX, resolveLinkedMaterialRequest } from './linked-materials'

export function linkedMaterialsDevPlugin(enabled: boolean, dashboardRoot: string): Plugin {
  const linkedMaterialDistDirectories = {
    'scroll-list': path.resolve(dashboardRoot, '../EasyMaterials/packages/dashboard/display/scroll-list/dist'),
    'pie-chart': path.resolve(dashboardRoot, '../EasyMaterials/packages/dashboard/chart/pie-chart/dist'),
  } as const

  return {
    name: 'easy-dashboard-linked-materials',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return

      server.middlewares.use(LINKED_MATERIALS_ROUTE_PREFIX, async (request, response, next) => {
        const linkedRequest = resolveLinkedMaterialRequest(request.originalUrl ?? request.url)
        if (!linkedRequest) {
          response.statusCode = 404
          response.end('Linked material is not allowlisted')
          return
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405
          response.setHeader('Allow', 'GET, HEAD')
          response.end()
          return
        }

        const filePath = path.join(
          linkedMaterialDistDirectories[linkedRequest.material],
          linkedRequest.file.slice('dist/'.length),
        )

        try {
          const contents = await readFile(filePath)
          response.statusCode = 200
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('X-Content-Type-Options', 'nosniff')
          response.end(request.method === 'HEAD' ? undefined : contents)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            response.statusCode = 404
            response.end('Linked material has not been built')
            return
          }
          next(error as Error)
        }
      })
    },
  }
}
