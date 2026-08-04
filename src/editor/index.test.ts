import type { ProjectSchema } from '@easy-editor/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const init = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const projectLoad = vi.hoisted(() => vi.fn())
const loadRemoteMaterialsFromComponentsMap = vi.hoisted(() => vi.fn())

vi.mock('@easy-editor/core', () => ({
  init,
  materials: { buildComponentMetasMap: vi.fn() },
  plugins: { registerPlugins: vi.fn() },
  project: {
    currentDocument: null,
    load: projectLoad,
    simulator: null,
    unload: vi.fn(),
  },
  setters: { registerSetter: vi.fn() },
}))

vi.mock('@easy-editor/plugin-dashboard', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@easy-editor/plugin-datasource', () => ({ default: vi.fn(() => ({})) }))
vi.mock('./materials', () => ({ componentMetaMap: {} }))
vi.mock('./persistence/schema-viewport', () => ({ getViewportFromSchema: vi.fn() }))
vi.mock('./plugins', () => ({ pluginList: [] }))
vi.mock('./project-lifecycle', () => ({ bindDashboardProjectLifecycle: vi.fn() }))
vi.mock('./project-theme-style', () => ({ applyDashboardSimulatorTheme: vi.fn() }))
vi.mock('./remote', () => ({ loadAllRemoteResources: vi.fn(() => Promise.resolve()) }))
vi.mock('./remote/util', () => ({ loadRemoteMaterialsFromComponentsMap }))
vi.mock('./setters', () => ({ setterMap: {}, setterOverrides: {} }))

import { initializeEditorProject } from '.'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('initializeEditorProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not let an older project commit when its material load finishes last', async () => {
    const olderComponentsMap = [] as NonNullable<ProjectSchema['componentsMap']>
    const latestComponentsMap = [] as NonNullable<ProjectSchema['componentsMap']>
    const olderSchema = { componentsMap: olderComponentsMap, id: 'older' } as unknown as ProjectSchema
    const latestSchema = { componentsMap: latestComponentsMap, id: 'latest' } as unknown as ProjectSchema
    const olderLoad = deferred()
    const latestLoad = deferred()

    loadRemoteMaterialsFromComponentsMap.mockImplementation(componentsMap =>
      componentsMap === olderComponentsMap ? olderLoad.promise : latestLoad.promise,
    )

    const olderRequest = initializeEditorProject(olderSchema)
    const latestRequest = initializeEditorProject(latestSchema)
    await vi.waitFor(() => expect(loadRemoteMaterialsFromComponentsMap).toHaveBeenCalledTimes(2))

    latestLoad.resolve()
    await latestRequest
    olderLoad.resolve()

    await expect(olderRequest).rejects.toThrow('superseded')
    expect(projectLoad).toHaveBeenCalledTimes(1)
    expect(projectLoad).toHaveBeenCalledWith(latestSchema, true)
  })
})
