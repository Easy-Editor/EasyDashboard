import type { ComponentsMap } from '@easy-editor/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const materialManagerMock = vi.hoisted(() => ({
  activatePackages: vi.fn(),
  loadMaterialMultiple: vi.fn(),
  remoteComponentsMap: {},
}))

vi.mock('./managers', () => ({ materialManager: materialManagerMock }))

import { loadRemoteMaterialsFromComponentsMap } from './util'

const componentsMap = [
  {
    componentName: 'CurrentText',
    package: '@easy-editor/material-text',
    version: '2.4.0',
    globalName: 'EasyEditorMaterialsText',
  },
] as unknown as ComponentsMap

describe('loadRemoteMaterialsFromComponentsMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears prior schema packages when the current schema has no remote materials', async () => {
    await loadRemoteMaterialsFromComponentsMap([])

    expect(materialManagerMock.activatePackages).toHaveBeenCalledWith([])
    expect(materialManagerMock.loadMaterialMultiple).not.toHaveBeenCalled()
  })

  it('clears prior schema packages when the current schema contains only local components', async () => {
    await loadRemoteMaterialsFromComponentsMap([{ componentName: 'Root' }] as unknown as ComponentsMap)

    expect(materialManagerMock.activatePackages).toHaveBeenCalledWith([])
    expect(materialManagerMock.loadMaterialMultiple).not.toHaveBeenCalled()
  })

  it('rejects required package failures with package and version evidence', async () => {
    materialManagerMock.loadMaterialMultiple.mockResolvedValue({
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [{ status: 'rejected', reason: new Error('network unavailable') }],
    })

    await expect(loadRemoteMaterialsFromComponentsMap(componentsMap)).rejects.toThrow(
      '@easy-editor/material-text@2.4.0: network unavailable',
    )
    expect(materialManagerMock.activatePackages).toHaveBeenCalledWith([
      expect.objectContaining({
        package: '@easy-editor/material-text',
        version: '2.4.0',
        componentName: 'CurrentText',
      }),
    ])
  })
})
