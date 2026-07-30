import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindDashboardProjectLifecycle } from './project-lifecycle'

describe('dashboard project lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores the dashboard theme after the renderer replaces simulator props during mount', () => {
    vi.useFakeTimers()
    const callbacks: {
      simulatorReady?: (simulator: FakeSimulator) => void
      documentChange?: (document: { fileName: string }) => void
      rendererReady?: () => void
    } = {}
    const simulator: FakeSimulator = {
      deviceStyle: undefined,
      set(_key, value) {
        this.deviceStyle = value as FakeSimulator['deviceStyle']
      },
    }
    const select = vi.fn()
    const schema = {
      version: '1.0.0',
      meta: {
        easyDashboard: {
          theme: {
            mode: 'dark',
            tokens: {
              '--dashboard-background': '#071018',
              '--dashboard-accent': '#22D3EE',
            },
          },
        },
      },
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'home',
          meta: { easyDashboard: { pageId: 'page-home' } },
        },
      ],
    }
    const project = {
      simulator,
      currentDocument: { fileName: 'home' },
      documents: [{ rootNode: { select } }],
      export: () => schema,
      onSimulatorReady: (listener: (value: FakeSimulator) => void) => {
        callbacks.simulatorReady = listener
        return () => undefined
      },
      onCurrentDocumentChange: (listener: (document: { fileName: string }) => void) => {
        callbacks.documentChange = listener
        return () => undefined
      },
      onRendererReady: (listener: () => void) => {
        callbacks.rendererReady = listener
        return () => undefined
      },
    }

    bindDashboardProjectLifecycle(project, () => ({ width: 1920, height: 1080 }))
    callbacks.simulatorReady?.(simulator)
    expect(simulator.deviceStyle?.canvas?.['--dashboard-background']).toBe('#071018')

    callbacks.rendererReady?.()
    // ProjectView reacts to renderer-ready, then SimulatorView.setProps()
    // replaces the whole prop bag during that follow-up render.
    simulator.deviceStyle = { viewport: { width: 1920, height: 1080 }, canvas: {} }
    vi.runAllTimers()

    expect(simulator.deviceStyle?.canvas?.['--dashboard-background']).toBe('#071018')
    expect(select).toHaveBeenCalledTimes(1)
  })
})

type FakeSimulator = {
  deviceStyle:
    | {
        viewport?: { width?: number; height?: number }
        canvas?: Record<string, unknown>
      }
    | undefined
  set: (key: string, value: unknown) => void
}
