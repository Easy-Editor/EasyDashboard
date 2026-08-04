import type { ProjectSchema } from '@easy-editor/core'
import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_PROJECT_DOCUMENT_VERSION,
  DEFAULT_DASHBOARD_THEME,
  decodeDashboardProjectDocument,
  resolvePageFileName,
  resolveStartPageFileName,
  serializeDashboardProjectDocument,
} from './project-document'

describe('decodeDashboardProjectDocument', () => {
  it('upgrades a legacy one-page ProjectSchema without replacing its stable document identity', () => {
    const legacy: ProjectSchema = {
      version: '0.0.1',
      componentsTree: [
        {
          id: 'root-node',
          docId: 'legacy-document',
          componentName: 'Root',
          fileName: 'home',
          fileDesc: '首页',
          children: [],
        },
      ],
    }

    const document = decodeDashboardProjectDocument(legacy)

    expect(document.formatVersion).toBe(DASHBOARD_PROJECT_DOCUMENT_VERSION)
    expect(document.editorSchema.version).toBe('0.0.1')
    expect(document.presentation).toEqual({
      startPageId: 'legacy-document',
      theme: DEFAULT_DASHBOARD_THEME,
    })
    expect(document.editorSchema.componentsTree[0]).toMatchObject({
      id: 'root-node',
      docId: 'legacy-document',
      fileName: 'home',
      meta: {
        easyDashboard: {
          pageId: 'legacy-document',
        },
      },
    })
  })

  it('repairs duplicate page ids and technical paths without changing their order', () => {
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      meta: {
        easyDashboard: {
          startPageId: 'page-shared',
          theme: DEFAULT_DASHBOARD_THEME,
        },
      },
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'reports/overview',
          meta: { easyDashboard: { pageId: 'page-shared' } },
        },
        {
          componentName: 'Root',
          fileName: 'reports/overview',
          meta: { easyDashboard: { pageId: 'page-shared' } },
        },
      ],
    })

    expect(
      document.editorSchema.componentsTree.map(page => ({
        pageId: page.meta.easyDashboard.pageId,
        fileName: page.fileName,
      })),
    ).toEqual([
      { pageId: 'page-shared', fileName: 'reports/overview' },
      { pageId: 'page-shared-2', fileName: 'reports/overview-2' },
    ])
    expect(document.presentation.startPageId).toBe('page-shared')
  })

  it('round-trips the versioned document through the ProjectSchema save boundary', () => {
    const initial = decodeDashboardProjectDocument({
      version: '1.0.0',
      componentsTree: [
        {
          docId: 'page-home',
          componentName: 'Root',
          fileName: 'home',
          meta: {
            easyDashboard: {
              pageId: 'page-home',
              theme: { tokens: { '--dashboard-background': '#112233' } },
            },
          },
        },
      ],
    })

    const saved = JSON.parse(JSON.stringify(serializeDashboardProjectDocument(initial))) as ProjectSchema
    const reloaded = decodeDashboardProjectDocument(saved)

    expect(reloaded).toEqual(initial)
  })

  it('resolves page ids to renderer paths and falls back to the first page for an invalid start page', () => {
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      meta: {
        easyDashboard: {
          startPageId: 'missing',
          theme: DEFAULT_DASHBOARD_THEME,
        },
      },
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'home',
          meta: { easyDashboard: { pageId: 'page-home' } },
        },
        {
          componentName: 'Root',
          fileName: 'details',
          meta: { easyDashboard: { pageId: 'page-details' } },
        },
      ],
    })

    expect(resolvePageFileName(document, 'page-details')).toBe('details')
    expect(resolvePageFileName(document, 'missing')).toBeUndefined()
    expect(resolveStartPageFileName(document)).toBe('home')
    expect(document.presentation.startPageId).toBe('page-home')
  })

  it('hydrates Agent-inserted remote nodes from the pinned component map', () => {
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      componentsMap: [
        {
          devMode: 'proCode',
          componentName: 'Text',
          package: '@easy-editor/materials-dashboard-text',
          version: '0.0.22',
          globalName: 'EasyEditorMaterialsText',
        },
      ],
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'home',
          children: [{ id: 'agent-title', componentName: 'Text', props: { text: 'Agent 标题' } }],
        },
      ],
    })

    expect(document.editorSchema.componentsTree[0]?.children?.[0]).toMatchObject({
      id: 'agent-title',
      componentName: 'Text',
      npm: {
        componentName: 'Text',
        package: '@easy-editor/materials-dashboard-text',
        version: '0.0.22',
        globalName: 'EasyEditorMaterialsText',
      },
    })
  })

  it('restores pinned Agent materials after the isolated Host exports low-code placeholders', () => {
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      componentsMap: [
        { devMode: 'lowCode', componentName: 'Root' },
        { devMode: 'lowCode', componentName: 'Text' },
        { devMode: 'lowCode', componentName: 'CustomCard' },
      ],
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'home',
          children: [
            { id: 'agent-title', componentName: 'Text', props: { text: 'Agent 标题' } },
            { id: 'agent-chart', componentName: 'BarChart', props: { data: [] } },
          ],
        },
      ],
    })

    expect(document.editorSchema.componentsMap).toEqual([
      { devMode: 'lowCode', componentName: 'Root' },
      {
        devMode: 'proCode',
        componentName: 'Text',
        package: '@easy-editor/materials-dashboard-text',
        version: '0.0.22',
        globalName: 'EasyEditorMaterialsText',
      },
      { devMode: 'lowCode', componentName: 'CustomCard' },
      {
        devMode: 'proCode',
        componentName: 'BarChart',
        package: '@easy-editor/materials-dashboard-bar-chart',
        version: '0.0.7',
        globalName: 'EasyEditorMaterialsBarChart',
      },
    ])
    expect(document.editorSchema.componentsTree[0]?.children).toMatchObject([
      {
        componentName: 'Text',
        props: {
          $data: {
            sourceType: 'static',
            staticData: [{ text: 'Agent 标题' }],
            fieldMappings: [{ componentField: 'text', sourceField: 'text' }],
          },
        },
        npm: {
          package: '@easy-editor/materials-dashboard-text',
          version: '0.0.22',
        },
      },
      {
        componentName: 'BarChart',
        npm: {
          package: '@easy-editor/materials-dashboard-bar-chart',
          version: '0.0.7',
        },
      },
    ])
  })

  it('restores pinned Agent materials when the isolated Host exports their runtime global names', () => {
    const textData = {
      sourceType: 'static',
      staticData: [{ text: '银行2022年度可视化财报' }],
      fieldMappings: [{ componentField: 'text', sourceField: 'text' }],
    }
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      componentsMap: [
        { devMode: 'lowCode', componentName: 'Root' },
        { devMode: 'lowCode', componentName: 'EasyEditorMaterialsText' },
      ],
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'home',
          children: [
            {
              id: 'agent-title',
              componentName: 'EasyEditorMaterialsText',
              props: { $data: textData, fontSize: 46 },
            },
          ],
        },
      ],
    })

    expect(document.editorSchema.componentsMap).toContainEqual({
      devMode: 'proCode',
      componentName: 'EasyEditorMaterialsText',
      package: '@easy-editor/materials-dashboard-text',
      version: '0.0.22',
      globalName: 'EasyEditorMaterialsText',
    })
    expect(document.editorSchema.componentsTree[0]?.children?.[0]).toMatchObject({
      id: 'agent-title',
      componentName: 'EasyEditorMaterialsText',
      props: { $data: textData, fontSize: 46 },
      npm: {
        componentName: 'EasyEditorMaterialsText',
        package: '@easy-editor/materials-dashboard-text',
        version: '0.0.22',
        globalName: 'EasyEditorMaterialsText',
      },
    })
  })

  it('projects Agent chart fields into the pinned remote material data contract', () => {
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      componentsMap: [{ devMode: 'lowCode', componentName: 'LineChart' }],
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'home',
          children: [
            {
              componentName: 'LineChart',
              props: {
                data: [
                  { month: '1月', sales: 42 },
                  { month: '2月', sales: 57 },
                ],
                xKey: 'month',
                series: [{ dataKey: 'sales', name: '销售额', color: '#38bdf8' }],
              },
            },
          ],
        },
      ],
    })

    expect(document.editorSchema.componentsTree[0]?.children?.[0]?.props).toMatchObject({
      xField: 'month',
      yFields: ['sales'],
      colors: ['#38bdf8'],
      $data: {
        sourceType: 'static',
        staticData: [
          { month: '1月', sales: 42 },
          { month: '2月', sales: 57 },
        ],
        fieldMappings: [
          { componentField: 'month', sourceField: 'month' },
          { componentField: 'sales', sourceField: 'sales' },
        ],
      },
    })
  })

  it('adapts Agent bar data to the pinned 0.0.7 material and supplies dashboard visual hierarchy', () => {
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      componentsMap: [
        { devMode: 'lowCode', componentName: 'Text' },
        { devMode: 'lowCode', componentName: 'BarChart' },
      ],
      componentsTree: [
        {
          componentName: 'Root',
          fileName: 'home',
          children: [
            {
              componentName: 'Text',
              title: '主标题',
              props: { text: '销售经营驾驶舱' },
              $dashboard: { rect: { x: 48, y: 32, width: 900, height: 72 } },
            },
            {
              componentName: 'BarChart',
              props: {
                data: [
                  { category: '华东', sales: 82 },
                  { category: '华南', sales: 68 },
                ],
                xKey: 'category',
                series: [{ dataKey: 'sales', name: '销售额', color: '#38bdf8' }],
              },
            },
          ],
        },
      ],
    })

    expect(document.editorSchema.componentsTree[0]?.children?.[0]?.props).toMatchObject({
      fontSize: 38,
      fontWeight: 'bold',
      glowEnable: true,
    })
    expect(document.editorSchema.componentsTree[0]?.children?.[1]?.props).toMatchObject({
      xField: 'name',
      yFields: ['value1'],
      showLegend: false,
      $data: {
        staticData: [
          { name: '华东', value1: 82, value2: 82 },
          { name: '华南', value1: 68, value2: 68 },
        ],
      },
    })
  })
})
