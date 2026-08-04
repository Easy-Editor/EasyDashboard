import type { Component, ComponentMetadata } from '@easy-editor/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadMaterial = vi.hoisted(() => vi.fn())
const createComponentMeta = vi.hoisted(() => vi.fn())
const refreshComponentMetasMap = vi.hoisted(() => vi.fn())

vi.mock('../../loaders', () => ({
  materialLoader: { loadMaterial },
}))

vi.mock('@easy-editor/core', () => ({
  MaterialSource: { REMOTE: 'remote' },
  materials: {
    createComponentMeta,
    refreshComponentMetasMap,
  },
}))

import { MaterialManagerClass, StaleMaterialLoadError } from '.'

const component = (() => null) as unknown as Component
const meta = { componentName: 'ActualUmdName' } as ComponentMetadata

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

describe('MaterialManagerClass schema package activation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves actual UMD, configured, plain, and versioned component aliases', async () => {
    loadMaterial.mockResolvedValue({ component, meta })
    const manager = new MaterialManagerClass()

    await manager.loadFull({
      package: '@easy-editor/material-text',
      version: '2.4.0',
      globalName: 'EasyEditorMaterialsText',
      componentName: 'SchemaText',
    })

    expect(manager.remoteComponentsMap).toEqual({
      ActualUmdName: component,
      'ActualUmdName@2.4.0': component,
      SchemaText: component,
      'SchemaText@2.4.0': component,
    })
  })

  it('does not expose a prior schema alias when the current package fails to load', async () => {
    loadMaterial.mockResolvedValue({ component, meta })
    const manager = new MaterialManagerClass()

    await manager.loadFull({
      package: '@easy-editor/old-text',
      version: '1.0.0',
      globalName: 'OldText',
      componentName: 'SchemaText',
    })
    expect(manager.remoteComponentsMap.SchemaText).toBe(component)

    manager.activatePackages([
      {
        package: '@easy-editor/current-text',
        version: '2.0.0',
        globalName: 'CurrentText',
        componentName: 'SchemaText',
      },
    ])

    loadMaterial.mockRejectedValueOnce(new Error('current package unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(
      manager.loadFull({
        package: '@easy-editor/current-text',
        version: '2.0.0',
        globalName: 'CurrentText',
        componentName: 'SchemaText',
      }),
    ).rejects.toThrow('current package unavailable')

    expect(manager.remoteComponentsMap).toEqual({})
    consoleError.mockRestore()
  })

  it('does not restore a stale package when an older schema load finishes last', async () => {
    const oldComponent = (() => null) as unknown as Component
    const currentComponent = (() => null) as unknown as Component
    const oldLoad = deferred<{ component: Component; meta: ComponentMetadata }>()
    const currentLoad = deferred<{ component: Component; meta: ComponentMetadata }>()
    loadMaterial.mockImplementation(({ package: packageName }: { package: string }) =>
      packageName === '@easy-editor/old-text' ? oldLoad.promise : currentLoad.promise,
    )
    const manager = new MaterialManagerClass()

    manager.activatePackages([
      {
        package: '@easy-editor/old-text',
        version: '1.0.0',
        globalName: 'OldText',
        componentName: 'SchemaText',
      },
    ])
    const oldRequest = manager.loadMaterialMultiple([
      {
        package: '@easy-editor/old-text',
        version: '1.0.0',
        globalName: 'OldText',
        componentName: 'SchemaText',
      },
    ])

    manager.activatePackages([
      {
        package: '@easy-editor/current-text',
        version: '2.0.0',
        globalName: 'CurrentText',
        componentName: 'SchemaText',
      },
    ])
    const currentRequest = manager.loadMaterialMultiple([
      {
        package: '@easy-editor/current-text',
        version: '2.0.0',
        globalName: 'CurrentText',
        componentName: 'SchemaText',
      },
    ])

    currentLoad.resolve({ component: currentComponent, meta })
    await currentRequest
    oldLoad.resolve({ component: oldComponent, meta })
    const oldResult = await oldRequest

    expect(oldResult).toMatchObject({ succeeded: 0, failed: 1 })
    expect(oldResult.results[0]).toMatchObject({
      status: 'rejected',
      reason: expect.any(StaleMaterialLoadError),
    })

    expect(manager.getLoadedPackages()).toEqual([
      {
        packageName: '@easy-editor/current-text',
        version: '2.0.0',
        componentName: 'ActualUmdName@2.0.0',
        hasComponent: true,
      },
    ])
    expect(manager.remoteComponentsMap.SchemaText).toBe(currentComponent)
    expect(createComponentMeta).toHaveBeenCalledTimes(2)
  })
})
