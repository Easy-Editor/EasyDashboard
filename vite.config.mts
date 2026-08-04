import { readFile } from 'node:fs/promises'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import ReactComponentName from 'react-scan/react-component-name/vite'
import { type Plugin, loadEnv } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { LINKED_MATERIALS_ROUTE_PREFIX, resolveLinkedMaterialRequest } from './src/editor/remote/linked-materials'

function linkedMaterialsDevPlugin(enabled: boolean): Plugin {
  const linkedMaterialDistDirectories = {
    'scroll-list': path.resolve(__dirname, '../EasyMaterials/packages/dashboard/display/scroll-list/dist'),
    'pie-chart': path.resolve(__dirname, '../EasyMaterials/packages/dashboard/chart/pie-chart/dist'),
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

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const useLinkedMaterials = command === 'serve' && env.VITE_EASY_DASHBOARD_USE_LINKED_MATERIALS === 'true'

  return {
    plugins: [
      linkedMaterialsDevPlugin(useLinkedMaterials),
      react({
        babel: {
          exclude: 'node_modules/**',
          babelrc: false,
          presets: [
            [
              '@babel/preset-typescript',
              {
                allowDeclareFields: true,
              },
            ],
          ],
          plugins: [
            [
              '@babel/plugin-proposal-decorators',
              {
                version: '2023-11',
              },
            ],
          ],
        },
      }),
      tailwindcss(),
      ReactComponentName({}),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: false,
        },
      },
    },
    build: {
      target: 'esnext',
    },
    test: {
      exclude: [...configDefaults.exclude, '**/dist/**'],
    },
  }
})
