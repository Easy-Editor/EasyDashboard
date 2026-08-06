import type { ComponentMeta, Snippet } from '@easy-editor/core'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testContext = vi.hoisted(() => ({
  addComponent: vi.fn(),
  hasComponent: vi.fn(),
  insertNode: vi.fn(),
  selectNode: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()

  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useEffect: vi.fn(),
    useRef: <T,>(initialValue: T) => ({ current: initialValue }),
    useState: <T,>(initialValue: T) => [initialValue, vi.fn()] as const,
  }
})

vi.mock('mobx-react', () => ({
  observer: <T,>(component: T) => component,
}))

vi.mock('@/editor/remote', () => ({
  materialManager: {
    addComponent: testContext.addComponent,
    hasComponent: testContext.hasComponent,
  },
}))

vi.mock('@easy-editor/core', () => ({
  project: {
    currentDocument: {
      insertNode: testContext.insertNode,
      root: { id: 'root' },
    },
    simulator: {
      viewport: {
        height: 1080,
        width: 1920,
      },
    },
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: testContext.toastError,
  },
}))

import { RemoteSnippet } from './RemoteSnippet'

const snippet = {
  schema: {
    componentName: 'RemoteChart',
    $dashboard: {
      rect: {
        height: 100,
        width: 200,
      },
    },
  },
  title: '远程图表',
} as Snippet

const componentMeta = {
  getMetadata: () => ({
    componentName: 'RemoteChart',
    npm: {
      componentName: 'RemoteChart',
      globalName: 'RemoteChartLibrary',
      package: '@example/remote-chart',
      version: '1.2.3',
    },
  }),
} as ComponentMeta

function renderSnippet(meta = componentMeta) {
  const component = RemoteSnippet as unknown as (props: {
    componentMeta: ComponentMeta
    snippet: Snippet
  }) => ReactElement<{ onDoubleClick: () => Promise<void> }>

  return component({ componentMeta: meta, snippet })
}

function createDeferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

describe('RemoteSnippet', () => {
  beforeEach(() => {
    testContext.addComponent.mockReset()
    testContext.hasComponent.mockReset()
    testContext.hasComponent.mockReturnValue(false)
    testContext.insertNode.mockReset()
    testContext.selectNode.mockReset()
    testContext.toastError.mockReset()
    testContext.insertNode.mockReturnValue({
      select: testContext.selectNode,
    })
  })

  it('waits for the remote component to load before inserting its node', async () => {
    const deferred = createDeferred()
    testContext.addComponent.mockReturnValue(deferred.promise)
    const addSnippet = renderSnippet().props.onDoubleClick()

    await Promise.resolve()

    expect(testContext.addComponent).toHaveBeenCalledWith('@example/remote-chart', '1.2.3')
    expect(testContext.insertNode).not.toHaveBeenCalled()

    deferred.resolve()
    await addSnippet

    expect(testContext.insertNode).toHaveBeenCalledOnce()
  })

  it('inserts immediately when the package component finished loading after the sidebar rendered', async () => {
    testContext.hasComponent.mockReturnValue(true)

    await renderSnippet().props.onDoubleClick()

    expect(testContext.hasComponent).toHaveBeenCalledWith('@example/remote-chart', '1.2.3')
    expect(testContext.addComponent).not.toHaveBeenCalled()
    expect(testContext.insertNode).toHaveBeenCalledOnce()
  })

  it('loads the version registered by the material manager when package metadata reports a newer linked build', async () => {
    const linkedComponentMeta = {
      getMetadata: () => ({
        componentName: 'RemoteChart@1.2.3',
        npm: {
          componentName: 'RemoteChart',
          globalName: 'RemoteChartLibrary',
          package: '@example/remote-chart',
          version: '1.2.4',
        },
      }),
    } as ComponentMeta

    await renderSnippet(linkedComponentMeta).props.onDoubleClick()

    expect(testContext.addComponent).toHaveBeenCalledWith('@example/remote-chart', '1.2.3')
    expect(testContext.insertNode).toHaveBeenCalledOnce()
  })

  it('does not insert a node when the remote component fails to load', async () => {
    const loadError = new Error('remote bundle unavailable')
    testContext.addComponent.mockRejectedValue(loadError)

    await renderSnippet().props.onDoubleClick()

    expect(testContext.insertNode).not.toHaveBeenCalled()
  })

  it('shows the remote loading failure to the user', async () => {
    const loadError = new Error('remote bundle unavailable')
    testContext.addComponent.mockRejectedValue(loadError)

    await renderSnippet().props.onDoubleClick()

    expect(testContext.toastError).toHaveBeenCalledWith('添加组件失败', {
      description: 'remote bundle unavailable',
      position: 'top-center',
    })
  })
})
