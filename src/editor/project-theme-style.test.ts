import { describe, expect, it, vi } from 'vitest'
import { applyDashboardSimulatorTheme, createDashboardSimulatorDeviceStyle } from './project-theme-style'

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
      fileName: 'overview',
      meta: { easyDashboard: { pageId: 'page-overview' } },
    },
    {
      componentName: 'Root',
      fileName: 'details',
      meta: {
        easyDashboard: {
          pageId: 'page-details',
          theme: {
            mode: 'light',
            tokens: {
              '--dashboard-background': '#F2FBFC',
              '--dashboard-accent': '#087EA4',
            },
          },
        },
      },
    },
  ],
}

describe('dashboard simulator theme style', () => {
  it('applies the current page render model to canvas while preserving device style fields', () => {
    const next = createDashboardSimulatorDeviceStyle(
      schema,
      'details',
      {
        viewport: { width: 1920, height: 1080 },
        content: { overflow: 'hidden' },
        canvas: { display: 'grid', '--legacy-token': '#123456' },
        customField: 'preserved',
      },
      {
        viewport: { width: 1600, height: 900 },
      },
    )

    expect(next).toMatchObject({
      viewport: { width: 1600, height: 900 },
      content: { overflow: 'hidden' },
      customField: 'preserved',
      canvas: {
        display: 'grid',
        '--legacy-token': '#123456',
        colorScheme: 'light',
        '--dashboard-background': '#F2FBFC',
        '--dashboard-accent': '#087EA4',
      },
    })
  })

  it('uses the start page when no current file is available and updates the simulator once', () => {
    const set = vi.fn()
    applyDashboardSimulatorTheme(
      {
        deviceStyle: {
          viewport: { width: 1280, height: 720 },
          canvas: { isolation: 'isolate' },
        },
        set,
      },
      schema,
    )

    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(
      'deviceStyle',
      expect.objectContaining({
        viewport: { width: 1280, height: 720 },
        canvas: expect.objectContaining({
          isolation: 'isolate',
          colorScheme: 'dark',
          '--dashboard-background': '#071018',
          '--dashboard-accent': '#22D3EE',
        }),
      }),
    )
  })
})
