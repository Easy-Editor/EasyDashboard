import { readFile } from 'node:fs/promises'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'

const repositoryRoot = path.resolve(__dirname, '..')
const viewerFonts = ['AlibabaSans-Regular.woff2', 'AlibabaPuHuiTi-3-55-Regular.woff2']

function cookieLessViewerBuild(): Plugin {
  let isBuild = false

  return {
    name: 'cookie-less-viewer-build',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const font = request.url?.match(/^\/fonts\/([^/?]+)(?:\?.*)?$/)?.[1]
        if (!font || !viewerFonts.includes(font)) {
          next()
          return
        }

        void readFile(path.resolve(repositoryRoot, 'public/fonts', font))
          .then(source => {
            response.statusCode = 200
            response.setHeader('Content-Type', 'font/woff2')
            response.end(source)
          })
          .catch(next)
      })
    },
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    async buildStart() {
      if (!isBuild) return
      for (const font of viewerFonts) {
        this.emitFile({
          type: 'asset',
          fileName: `fonts/${font}`,
          source: await readFile(path.resolve(repositoryRoot, 'public/fonts', font)),
        })
      }
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue

        if (/\/api\/projects\/|\/api\/auth\//i.test(output.code)) {
          this.error(`Private application logic leaked into Viewer chunk: ${output.fileName}`)
        }
      }
    },
  }
}

export default defineConfig({
  publicDir: false,
  plugins: [
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
    cookieLessViewerBuild(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(repositoryRoot, 'src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: {
      allow: [repositoryRoot],
    },
  },
  build: {
    target: 'esnext',
    modulePreload: {
      polyfill: false,
    },
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
