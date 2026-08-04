import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import ReactComponentName from 'react-scan/react-component-name/vite'
import { loadEnv } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'
import { linkedMaterialsDevPlugin } from './src/editor/remote/linked-materials-vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const useLinkedMaterials = command === 'serve' && env.VITE_EASY_DASHBOARD_USE_LINKED_MATERIALS === 'true'

  return {
    plugins: [
      linkedMaterialsDevPlugin(useLinkedMaterials, __dirname),
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
