import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(
  projectRoot,
  '../EasyEditor/examples/dashboard/src/editor/materials/inner/dashboard-scene',
)
const targetDirectory = resolve(projectRoot, 'src/editor/materials/dashboard-scene')
const runtimeFiles = ['component.tsx', 'component.css', 'spec.ts']

await mkdir(targetDirectory, { recursive: true })
for (const file of runtimeFiles) {
  const source = await readFile(resolve(sourceDirectory, file), 'utf8')
  await writeFile(resolve(targetDirectory, file), source, 'utf8')
}

process.stdout.write(`Synchronized DashboardScene runtime files: ${runtimeFiles.join(', ')}\n`)
