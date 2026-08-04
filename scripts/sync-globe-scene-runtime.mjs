import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(projectRoot, '../EasyEditor/examples/dashboard/src/editor/materials/inner/globe-scene')
const targetDirectory = resolve(projectRoot, 'src/editor/materials/globe-scene')
const runtimeFiles = [
  'component.tsx',
  'component.css',
  'configure.ts',
  'spec.ts',
  'webgl.ts',
  'world.geo.json',
  'assets/earth-blue-marble.jpg',
  'assets/2mass-galactic-plane.jpg',
  'assets/SOURCES.md',
]

await mkdir(targetDirectory, { recursive: true })
for (const file of runtimeFiles) {
  const source = await readFile(resolve(sourceDirectory, file))
  const target = resolve(targetDirectory, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, source)
}

process.stdout.write(`Synchronized GlobeScene runtime files: ${runtimeFiles.join(', ')}\n`)
