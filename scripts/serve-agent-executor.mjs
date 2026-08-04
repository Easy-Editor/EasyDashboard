import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const easyEditorRoot = process.env.EASY_EDITOR_WORKSPACE_DIR
  ? resolve(process.env.EASY_EDITOR_WORKSPACE_DIR)
  : resolve(projectRoot, '../EasyEditor')
const executorRoot = resolve(easyEditorRoot, 'spikes/document-executor')
const artifactDirectory = resolve(executorRoot, '.browser-dist')

await access(resolve(artifactDirectory, 'index.html')).catch(() => {
  throw new Error('Document Executor artifact is missing. Run pnpm setup:agent-executor first.')
})

const child = spawn(
  'pnpm',
  ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort', '--outDir', artifactDirectory],
  { cwd: executorRoot, stdio: 'inherit' },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', code => {
  process.exitCode = code ?? 1
})
