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
})
