import { describe, expect, it } from 'vitest'
import { resolveEditorPageRoute, selectEditorRouteProjectState, withEditorPage } from './editor-page-route'

const pages = [
  { pageId: 'page-home', fileName: 'home' },
  { pageId: 'page-details', fileName: 'details' },
]

describe('editor page route helpers', () => {
  it('projects only lightweight page metadata and the canonical start page', () => {
    expect(
      selectEditorRouteProjectState(
        [
          { fileName: 'home', meta: { easyDashboard: { pageId: 'page-home' } }, children: [{ huge: 'ignored' }] },
          { fileName: 'details', docId: 'page-details' },
        ],
        { easyDashboard: { startPageId: 'page-details' } },
      ),
    ).toEqual({
      pages,
      startPageId: 'page-details',
    })
  })

  it('normalizes duplicate page ids and file names exactly like the canonical document decoder', () => {
    expect(
      selectEditorRouteProjectState(
        [
          { fileName: 'home', meta: { easyDashboard: { pageId: 'page-home' } } },
          { fileName: 'home', meta: { easyDashboard: { pageId: 'page-home' } } },
          { fileName: 'home-2', meta: { easyDashboard: { pageId: 'page-home-2' } } },
        ],
        { easyDashboard: { startPageId: 'page-home' } },
      ),
    ).toEqual({
      pages: [
        { pageId: 'page-home', fileName: 'home' },
        { pageId: 'page-home-2', fileName: 'home-2' },
        { pageId: 'page-home-2-2', fileName: 'home-2-2' },
      ],
      startPageId: 'page-home',
    })
  })

  it('opens a valid page requested by the route without rewriting it', () => {
    expect(
      resolveEditorPageRoute({
        pages,
        requestedPageId: 'page-details',
        currentFileName: 'home',
        startPageId: 'page-home',
      }),
    ).toEqual({
      pageId: 'page-details',
      fileName: 'details',
      shouldOpen: true,
      shouldReplace: false,
    })
  })

  it('replaces an invalid route page with the current page', () => {
    expect(
      resolveEditorPageRoute({
        pages,
        requestedPageId: 'missing',
        currentFileName: 'details',
        startPageId: 'page-home',
      }),
    ).toEqual({
      pageId: 'page-details',
      fileName: 'details',
      shouldOpen: false,
      shouldReplace: true,
    })
  })

  it('falls back to the start page when there is no valid current page', () => {
    expect(
      resolveEditorPageRoute({
        pages,
        requestedPageId: null,
        currentFileName: undefined,
        startPageId: 'page-details',
      }),
    ).toEqual({
      pageId: 'page-details',
      fileName: 'details',
      shouldOpen: true,
      shouldReplace: true,
    })
  })

  it('preserves unrelated query parameters when canonicalizing the page', () => {
    const next = withEditorPage(new URLSearchParams('mode=code&page=missing&panel=layers'), 'page-home')

    expect(next.toString()).toBe('mode=code&page=page-home&panel=layers')
  })
})
