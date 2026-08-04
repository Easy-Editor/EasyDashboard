import { describe, expect, it } from 'vitest'
import { createDashboardPreviewAriaLabel, createDashboardRenderModel } from './dashboard-render-adapter'

const document = {
  formatVersion: 1,
  editorSchema: {
    version: '1.0.0',
    componentsTree: [
      {
        componentName: 'Root',
        fileName: 'overview',
        meta: { easyDashboard: { pageId: 'page-overview' } },
        $dashboard: { rect: { width: 1600, height: 900 } },
      },
      {
        componentName: 'Root',
        fileName: 'details',
        meta: {
          easyDashboard: {
            pageId: 'page-details',
            theme: { mode: 'light', tokens: { '--dashboard-accent': '#ff6600' } },
          },
        },
        $dashboard: { rect: { width: 1280, height: 720 } },
      },
    ],
  },
  presentation: {
    startPageId: 'page-overview',
    theme: {
      mode: 'dark',
      tokens: {
        '--dashboard-surface': '#101820',
      },
    },
  },
}

describe('createDashboardRenderModel', () => {
  it('normalizes a project document and resolves page-id deep links to renderer file names', () => {
    const model = createDashboardRenderModel(document, 'page-details')

    expect(model.initialPage).toBe('details')
    expect(model.viewport).toEqual({ width: 1280, height: 720 })
    expect(model.rootAttributes).toEqual({
      'data-dashboard-root': '',
      'data-project-root': '',
      'data-project-theme': 'light',
    })
    expect(model.rootStyle).toMatchObject({
      colorScheme: 'light',
      '--background': '#ffffff',
      '--foreground': '#111827',
      '--dashboard-default-bg': '#e5e5e5',
      '--dashboard-surface': '#101820',
      '--dashboard-accent': '#ff6600',
    })
  })

  it('falls back to the configured start page for an unknown deep link', () => {
    const model = createDashboardRenderModel(document, 'missing')

    expect(model.initialPage).toBe('overview')
    expect(model.rootAttributes['data-project-theme']).toBe('dark')
    expect(model.rootStyle).toMatchObject({
      colorScheme: 'dark',
      '--background': '#000000',
      '--foreground': '#ffffff',
    })
  })

  it('keeps the route entry page stable while an internal navigation updates the active page presentation', () => {
    const detailsModel = createDashboardRenderModel(document, 'page-overview', 'details')

    expect(detailsModel.initialPage).toBe('overview')
    expect(detailsModel.viewport).toEqual({ width: 1280, height: 720 })
    expect(detailsModel.rootAttributes['data-project-theme']).toBe('light')
    expect(detailsModel.rootStyle).toMatchObject({
      colorScheme: 'light',
      '--dashboard-default-bg': '#e5e5e5',
      '--dashboard-accent': '#ff6600',
    })
    expect(createDashboardPreviewAriaLabel('内部导航回归')).toBe('内部导航回归 预览')

    const overviewModel = createDashboardRenderModel(document, 'page-overview', 'overview')

    expect(overviewModel.initialPage).toBe('overview')
    expect(overviewModel.viewport).toEqual({ width: 1600, height: 900 })
    expect(overviewModel.rootAttributes['data-project-theme']).toBe('dark')
    expect(overviewModel.rootStyle).toMatchObject({
      colorScheme: 'dark',
      '--dashboard-default-bg': '#0A1017',
      '--dashboard-accent': '#67C6D9',
    })
    expect(createDashboardPreviewAriaLabel('内部导航回归')).toBe('内部导航回归 预览')
  })

  it('accepts a legacy raw ProjectSchema', () => {
    const model = createDashboardRenderModel({
      version: '1.0.0',
      componentsTree: [
        {
          id: 'legacy-page',
          componentName: 'Root',
          fileName: 'legacy',
          $dashboard: { rect: { width: 1920, height: 1080 } },
        },
      ],
    })

    expect(model.initialPage).toBe('legacy')
    expect(model.projectSchema.componentsTree).toHaveLength(1)
  })
})
