import { readFile } from 'node:fs/promises'
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
const installedCjsPath = require.resolve('@easy-editor/core')
const installedEsmPath = path.join(path.dirname(installedCjsPath), 'index.js')

describe('patched editor setting reads', () => {
  it.each([
    {
      artifact: 'committed pnpm patch',
      read: async () => addedPatchSource(await readFile(patchPath, 'utf8')),
    },
    {
      artifact: 'installed CommonJS bundle',
      read: async () => readFile(installedCjsPath, 'utf8'),
    },
    {
      artifact: 'installed ESM bundle',
      read: async () => readFile(installedEsmPath, 'utf8'),
    },
  ])('$artifact keeps getPropValue free of render-time writes', async ({ read }) => {
    assertReadOnlySettingGetter(await read())
  })

  it('fails when the setting getter creates a missing property', async () => {
    const installedBundle = await readFile(installedCjsPath, 'utf8')
    const mutatedBundle = installedBundle.replace(
      'this.first.getProp(propName.toString(), false)?.getValue()',
      'this.first.getProp(propName.toString(), true)?.getValue()',
    )

    expect(mutatedBundle).not.toBe(installedBundle)
    expect(() => assertReadOnlySettingGetter(mutatedBundle)).toThrow()
  })
})
