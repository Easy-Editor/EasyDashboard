import { describe, expect, it } from 'vitest'

import { defaultProjectSchema } from './const'

describe('defaultProjectSchema', () => {
  it('creates one clean dashboard page without demo behavior or data', () => {
    expect(defaultProjectSchema.componentsTree).toHaveLength(1)

    const [page] = defaultProjectSchema.componentsTree
    expect(page).toMatchObject({
      componentName: 'Root',
      fileName: 'home',
      fileDesc: '首页',
      meta: {
        easyDashboard: {
          pageId: 'page-home',
        },
      },
      $dashboard: {
        rect: {
          width: 1920,
          height: 1080,
        },
      },
      children: [],
    })
    expect(page).not.toHaveProperty('dataSource')
    expect(page).not.toHaveProperty('state')
    expect(page).not.toHaveProperty('lifeCycles')
    expect(page).not.toHaveProperty('methods')
  })

  it('stores the project start page and default visual theme in schema metadata', () => {
    expect(defaultProjectSchema.meta?.easyDashboard).toMatchObject({
      documentVersion: 1,
      startPageId: 'page-home',
      theme: {
        mode: 'dark',
      },
    })
  })

  it('pins the remote materials that a blank-project Agent run may insert', () => {
    expect(defaultProjectSchema.componentsMap).toEqual([
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'Text',
        package: '@easy-editor/materials-dashboard-text',
        version: '0.0.22',
        globalName: 'EasyEditorMaterialsText',
      }),
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'BarChart',
        package: '@easy-editor/materials-dashboard-bar-chart',
        version: '0.0.7',
        globalName: 'EasyEditorMaterialsBarChart',
      }),
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'LineChart',
        package: '@easy-editor/materials-dashboard-line-chart',
        version: '0.0.7',
        globalName: 'EasyEditorMaterialsLineChart',
      }),
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'PieChart',
        package: '@easy-editor/materials-dashboard-pie-chart',
        version: '0.0.7',
        globalName: 'EasyEditorMaterialsPieChart',
      }),
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'NumberFlip',
        package: '@easy-editor/materials-dashboard-number-flip',
        version: '0.0.7',
        globalName: 'EasyEditorMaterialsNumberFlip',
      }),
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'Progress',
        package: '@easy-editor/materials-dashboard-progress',
        version: '0.0.7',
        globalName: 'EasyEditorMaterialsProgress',
      }),
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'ScrollList',
        package: '@easy-editor/materials-dashboard-scroll-list',
        version: '0.0.7',
        globalName: 'EasyEditorMaterialsScrollList',
      }),
      expect.objectContaining({
        devMode: 'proCode',
        componentName: 'GeoMap',
        package: '@easy-editor/materials-dashboard-geo-map',
        version: '0.0.6',
        globalName: 'EasyEditorMaterialsGeoMap',
      }),
    ])
  })
})
