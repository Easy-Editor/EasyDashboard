import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
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
    name: 'Canvas cleanup releases its renderer instance',
    patterns: [/return \(\) => (?:setTimeout\(\(\) => renderer\.dispose\(\), 0\)|renderer\.dispose\(\))/],
  },
  {
    name: 'React root disposal and reusable renderer state',
    patterns: [
      /(?:this\._root = (?:client\.)?createRoot\(container\)|const root = (?:client\.)?createRoot\(container\))/,
      /(?:this\._root\?\.unmount\(\)|root\.unmount\(\))/,
      /(?:this\._root = undefined|resources\.root = undefined)/,
      /(?:this\._running = false|this\.#renderState = ['"]idle['"])/,
      /(?:mobx\.)?runInAction\(\(\) =>/,
      /(?:this\.host\.purge\(\)|this\.#releaseRenderResources\(renderResources\))/,
      /(?:this\.host\.project\.isRendererReady = false|this\._host = undefined)/,
    ],
  },
  {
    name: 'document instances follow live Document identities',
    patterns: [
      /const staleDocumentInstances = \[\]/,
      /const nextDocumentInstanceMap = new Map\(\)/,
      /const cachedInstance = documentInstanceMap\.get\(document\.id\)/,
      /cachedInstance\?\.document === document/,
      /staleDocumentInstances\.push\(cachedInstance\)/,
      /!nextDocumentInstanceMap\.has\(documentId\)/,
      /documentInstanceMap\.clear\(\)/,
      /staleDocumentInstances\.forEach\(documentInstance => documentInstance\.dispose\(\)\)/,
    ],
  },
  {
    name: 'a stable document route with visible stale-path fallback',
    patterns: [
      /path: ['"]\*['"]/,
      /const DocumentRoute = (?:mobxReact\.)?observer/,
      /const currentDocumentId = host\.currentDocument\?\.id/,
      /documentInstances\.find\(instance => instance\.path === pathname\)/,
      /documentInstances\.find\(instance => instance\.document\.id === currentDocumentId\)/,
      /documentInstances\[0\]/,
    ],
  },
  {
    name: 'internal document route synchronization replaces history',
    patterns: [/this\.history\.replace\(path\)/],
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

const require = createRequire(import.meta.url)
const installedEntryPath = require.resolve('@easy-editor/react-renderer-dashboard')
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

describe('patched simulator renderer lifecycle', () => {
  it.each([
    {
      artifact: 'installed CommonJS bundle',
      read: async () => readInstalledArtifact('.cjs'),
    },
    {
      artifact: 'installed ESM bundle',
      read: async () => readInstalledArtifact('.js'),
    },
  ])('$artifact contains every remount lifecycle contract', async ({ read }) => {
    const source = await read()

    expect(() => assertLifecycleContracts(source)).not.toThrow()
  })

  it.each([
    {
      contract: 'per-mount renderer ownership',
      remove: /const \[renderer\] = (?:React3|React)\.useState\(\(\) => new SimulatorRendererContainer\(\)\);/,
    },
    {
      contract: 'effect cleanup',
      remove: /return \(\) => (?:setTimeout\(\(\) => renderer\.dispose\(\), 0\)|renderer\.dispose\(\));/,
    },
    {
      contract: 'React root unmount',
      remove: /(?:this\._root\?\.unmount\(\)|root\.unmount\(\));/,
    },
    {
      contract: 'Document identity replacement',
      remove: /cachedInstance\?\.document === document/,
    },
    {
      contract: 'removed Document instance cleanup',
      remove: /!nextDocumentInstanceMap\.has\(documentId\)/,
    },
    {
      contract: 'visible stale-path fallback',
      remove: /documentInstances\.find\(instance => instance\.document\.id === currentDocumentId\)/,
    },
    {
      contract: 'history replacement',
      remove: /this\.history\.replace\(path\)/,
    },
  ])('fails when $contract is removed from the installed bundle', async ({ remove }) => {
    const installedBundle = await readInstalledArtifact('.cjs')
    const mutatedBundle = installedBundle.replace(remove, '')

    expect(mutatedBundle).not.toBe(installedBundle)
    expect(() => assertLifecycleContracts(mutatedBundle)).toThrow(/Missing simulator renderer lifecycle contract/)
  })
})
