import { defaultProjectSchema } from '@/editor/const'
import { describe, expect, it } from 'vitest'
import { getPreviewPages, resolvePreviewPageSelection, withPreviewPage } from './preview-page-selector'

describe('preview page selector helpers', () => {
  it('lists every canonical page with its product-facing name', () => {
    const schema = structuredClone(defaultProjectSchema)
    schema.componentsTree.push({
      ...structuredClone(schema.componentsTree[0]),
      id: 'page-details-root',
      docId: 'page-details',
      fileName: 'details',
      fileDesc: '详情页',
      meta: { easyDashboard: { pageId: 'page-details' } },
    })

    expect(getPreviewPages(schema)).toEqual([
      { id: 'page-home', label: '首页' },
      { id: 'page-details', label: '详情页' },
    ])
  })

  it('uses a requested page and selects the configured start page when the query is absent', () => {
    const schema = structuredClone(defaultProjectSchema)

    expect(resolvePreviewPageSelection(schema, 'page-home')).toMatchObject({
      status: 'selected',
      activePageId: 'page-home',
      source: 'requested',
    })
    expect(resolvePreviewPageSelection(schema, null)).toMatchObject({
      status: 'selected',
      activePageId: 'page-home',
      source: 'start',
    })
  })

  it('retains an invalid deep link instead of silently replacing it with the start page', () => {
    const schema = structuredClone(defaultProjectSchema)

    expect(resolvePreviewPageSelection(schema, 'missing-page')).toEqual({
      status: 'invalid',
      requestedPageId: 'missing-page',
      activePageId: null,
      startPageId: 'page-home',
    })
  })

  it('updates only the page query', () => {
    const next = withPreviewPage(new URLSearchParams('mode=inspect&page=page-home'), 'page-details')

    expect(next.toString()).toBe('mode=inspect&page=page-details')
  })
})
