import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type LifecycleContract = {
  name: string
  patterns: RegExp[]
}

const lifecycleContracts: LifecycleContract[] = [
  {
    name: 'a renderer instance owned by each Canvas mount',
    patterns: [/useState\(\(\) => new SimulatorRendererContainer\(\)\)/],
  },
  {
    name: 'Canvas disposal after the parent React root finishes unmounting',
    patterns: [/return \(\) => setTimeout\(\(\) => renderer\.dispose\(\), 0\)/],
  },
  {
    name: 'React root disposal and reusable renderer state',
    patterns: [
      /this\._root = (?:client\.)?createRoot\(container\)/,
      /this\._root\?\.unmount\(\)/,
      /this\._root = undefined/,
      /this\._running = false/,
      /(?:mobx\.)?runInAction\(\(\) =>/,
      /this\.host\.purge\(\)/,
      /this\.host\.project\.isRendererReady = false/,
    ],
  },
]

function assertLifecycleContracts(source: string) {
  const missing = lifecycleContracts
    .filter(contract => contract.patterns.some(pattern => !pattern.test(source)))
    .map(contract => contract.name)

  if (missing.length > 0) {
    throw new Error(`Missing simulator renderer lifecycle contract: ${missing.join(', ')}`)
  }
}

function addedPatchSource(patch: string) {
  return patch
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1))
    .join('\n')
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(currentDirectory, '../../..')
const patchPath = path.join(repositoryRoot, 'patches/@easy-editor__react-renderer-dashboard@1.0.4.patch')
const require = createRequire(import.meta.url)
const installedCjsPath = require.resolve('@easy-editor/react-renderer-dashboard')
const installedEsmPath = path.join(path.dirname(installedCjsPath), 'index.js')

describe('patched simulator renderer lifecycle', () => {
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
  ])('$artifact contains every remount lifecycle contract', async ({ read }) => {
    const source = await read()

    expect(() => assertLifecycleContracts(source)).not.toThrow()
  })

  it.each([
    {
      contract: 'per-mount renderer ownership',
      remove: /const \[renderer\] = React3\.useState\(\(\) => new SimulatorRendererContainer\(\)\);/,
    },
    {
      contract: 'effect cleanup',
      remove: /return \(\) => setTimeout\(\(\) => renderer\.dispose\(\), 0\);/,
    },
    {
      contract: 'React root unmount',
      remove: /this\._root\?\.unmount\(\);/,
    },
  ])('fails when $contract is removed from the installed bundle', async ({ remove }) => {
    const installedBundle = await readFile(installedCjsPath, 'utf8')
    const mutatedBundle = installedBundle.replace(remove, '')

    expect(mutatedBundle).not.toBe(installedBundle)
    expect(() => assertLifecycleContracts(mutatedBundle)).toThrow(/Missing simulator renderer lifecycle contract/)
  })
})
