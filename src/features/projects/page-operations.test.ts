import { describe, expect, it } from 'vitest'

import {
  DashboardPageConflictError,
  createDashboardPage,
  deleteDashboardPage,
  duplicateDashboardPage,
  renameDashboardPage,
  reorderDashboardPage,
  setDashboardStartPage,
} from './page-operations'
import { decodeDashboardProjectDocument } from './project-document'

function projectWithThreePages() {
  return decodeDashboardProjectDocument({
    version: '1.0.0',
    meta: {
      easyDashboard: {
        startPageId: 'page-b',
        theme: {
          mode: 'dark',
          tokens: {
            '--dashboard-background': '#080A0D',
            '--dashboard-foreground': '#F1F5F7',
            '--dashboard-accent': '#67C6D9',
          },
        },
      },
    },
    componentsTree: [
      {
        docId: 'page-a',
        componentName: 'Root',
        fileName: 'a',
        fileDesc: '页面 A',
        meta: { easyDashboard: { pageId: 'page-a' } },
      },
      {
        docId: 'page-b',
        componentName: 'Root',
        fileName: 'b',
        fileDesc: '页面 B',
        meta: { easyDashboard: { pageId: 'page-b' } },
      },
      {
        docId: 'page-c',
        componentName: 'Root',
        fileName: 'c',
        fileDesc: '页面 C',
        meta: { easyDashboard: { pageId: 'page-c' } },
      },
    ],
  })
}

describe('dashboard page operations', () => {
  it('creates a page with a unique technical path and stable page id', () => {
    const document = createDashboardPage(projectWithThreePages(), {
      pageId: 'page-d',
      fileName: 'reports/d',
      fileDesc: '页面 D',
    })

    expect(document.editorSchema.componentsTree.at(-1)).toMatchObject({
      docId: 'page-d',
      fileName: 'reports/d',
      fileDesc: '页面 D',
      meta: { easyDashboard: { pageId: 'page-d' } },
    })
  })

  it('rejects duplicate page ids and technical paths on creation', () => {
    const document = projectWithThreePages()

    expect(() =>
      createDashboardPage(document, {
        pageId: 'page-a',
        fileName: 'new-path',
        fileDesc: '重复 ID',
      }),
    ).toThrow(DashboardPageConflictError)
    expect(() =>
      createDashboardPage(document, {
        pageId: 'page-new',
        fileName: 'a',
        fileDesc: '重复路径',
      }),
    ).toThrow(DashboardPageConflictError)
  })

  it('renames only the product label and keeps the technical path stable', () => {
    const document = renameDashboardPage(projectWithThreePages(), 'page-b', '经营驾驶舱')

    expect(document.editorSchema.componentsTree[1]).toMatchObject({
      fileName: 'b',
      fileDesc: '经营驾驶舱',
    })
  })

  it('duplicates a page next to its source with independent nested schema data', () => {
    const source = projectWithThreePages()
    source.editorSchema.componentsTree[1].children = [
      { id: 'child', componentName: 'Text', props: { content: 'original' } },
    ]

    const document = duplicateDashboardPage(source, 'page-b', {
      pageId: 'page-b-copy',
    })
    const duplicate = document.editorSchema.componentsTree[2]

    expect(duplicate).toMatchObject({
      docId: 'page-b-copy',
      fileName: 'b-copy',
      fileDesc: '页面 B 副本',
      meta: { easyDashboard: { pageId: 'page-b-copy' } },
    })
    duplicate.children?.[0] && (duplicate.children[0].props = { content: 'changed' })
    expect(source.editorSchema.componentsTree[1].children?.[0]?.props).toEqual({ content: 'original' })
  })

  it('deletes an unloaded page from componentsTree and preserves page order', () => {
    const document = deleteDashboardPage(projectWithThreePages(), 'page-c')

    expect(document.editorSchema.componentsTree.map(page => page.meta.easyDashboard.pageId)).toEqual([
      'page-a',
      'page-b',
    ])
  })

  it('selects the first remaining page as start page when deleting the start page', () => {
    const document = deleteDashboardPage(projectWithThreePages(), 'page-b')

    expect(document.presentation.startPageId).toBe('page-a')
  })

  it('keeps at least one page', () => {
    const document = decodeDashboardProjectDocument({
      version: '1.0.0',
      componentsTree: [{ componentName: 'Root', fileName: 'home' }],
    })

    expect(() => deleteDashboardPage(document, document.presentation.startPageId)).toThrow(
      'A dashboard project must contain at least one page',
    )
  })

  it('reorders pages without changing their identities', () => {
    const document = reorderDashboardPage(projectWithThreePages(), 'page-c', 0)

    expect(document.editorSchema.componentsTree.map(page => page.meta.easyDashboard.pageId)).toEqual([
      'page-c',
      'page-a',
      'page-b',
    ])
  })

  it('sets a valid start page and rejects an unknown one', () => {
    const document = setDashboardStartPage(projectWithThreePages(), 'page-c')

    expect(document.presentation.startPageId).toBe('page-c')
    expect(() => setDashboardStartPage(document, 'missing')).toThrow('Unknown dashboard page: missing')
  })
})
