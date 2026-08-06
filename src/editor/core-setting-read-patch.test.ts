import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readOnlySettingGetter = /return this\.first\.getProp\(propName\.toString\(\), false\)\?\.getValue\(\);/

function assertReadOnlySettingGetter(source: string) {
  expect(source).toMatch(readOnlySettingGetter)
  expect(source).not.toMatch(/return this\.first\.getProp\(propName\.toString\(\), true\)\?\.getValue\(\);/)
}

function addedPatchSource(patch: string) {
  return patch
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1))
    .join('\n')
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(currentDirectory, '../..')
const patchPath = path.join(repositoryRoot, 'patches/@easy-editor__core@1.0.3.patch')
const require = createRequire(import.meta.url)
const installedEntryPath = require.resolve('@easy-editor/core')
const installedArtifactDirectory = installedEntryPath.includes(`${path.sep}src${path.sep}`)
  ? path.join(path.dirname(installedEntryPath), '..', 'dist')
  : path.dirname(installedEntryPath)

async function readInstalledArtifact(extension: '.cjs' | '.js') {
  const files: string[] = []
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(entryPath)
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push(entryPath)
    }
  }
  await visit(installedArtifactDirectory)
  return (await Promise.all(files.sort().map(file => readFile(file, 'utf8')))).join('\n')
}

describe('patched editor setting reads', () => {
  it.each([
    {
      artifact: 'committed pnpm patch',
      read: async () => addedPatchSource(await readFile(patchPath, 'utf8')),
    },
    {
      artifact: 'installed CommonJS bundle',
      read: async () => readInstalledArtifact('.cjs'),
    },
    {
      artifact: 'installed ESM bundle',
      read: async () => readInstalledArtifact('.js'),
    },
  ])('$artifact keeps getPropValue free of render-time writes', async ({ read }) => {
    assertReadOnlySettingGetter(await read())
  })

  it('fails when the setting getter creates a missing property', async () => {
    const installedBundle = await readInstalledArtifact('.cjs')
    const mutatedBundle = installedBundle.replace(
      'this.first.getProp(propName.toString(), false)?.getValue()',
      'this.first.getProp(propName.toString(), true)?.getValue()',
    )

    expect(mutatedBundle).not.toBe(installedBundle)
    expect(() => assertReadOnlySettingGetter(mutatedBundle)).toThrow()
  })
})
