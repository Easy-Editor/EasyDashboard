import { describe, expect, it } from 'vitest'
import {
  type InvalidDashboardDocumentError,
  canonicalizeDashboardDocument,
  resolveDashboardActiveDocumentId,
  resolveDashboardActiveRootNodeId,
  resolveDashboardStartPageId,
} from './canonical-dashboard-document.js'

function page(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${id}-root`,
    docId: id,
    fileName: id,
    componentName: 'Root',
    isRoot: true,
    meta: { easyDashboard: { pageId: id } },
    $dashboard: { rect: { x: 0, y: 0, width: 1920, height: 1080 } },
    children: [],
    ...overrides,
  }
}

describe('canonical dashboard document', () => {
  it('preserves an existing canonical envelope without rewriting it', () => {
    const document = {
      formatVersion: 1,
      editorSchema: { version: '1.0.0', componentsTree: [page('page-home')] },
      presentation: { startPageId: 'page-home', theme: { mode: 'light', tokens: { '--accent': '#fff' } } },
      extension: { keep: true },
    }

    expect(canonicalizeDashboardDocument(document)).toBe(document)
  })

  it('wraps a legacy editor schema and derives the first page identity', () => {
    const legacy = { version: '1.0.0', componentsTree: [page('page-overview'), page('page-detail')] }

    expect(canonicalizeDashboardDocument(legacy)).toEqual({
      formatVersion: 1,
      editorSchema: legacy,
      presentation: {
        startPageId: 'page-overview',
        theme: expect.objectContaining({ mode: 'dark' }),
      },
    })
  })

  it('honors a valid legacy project start page and theme', () => {
    const legacy = {
      version: '1.0.0',
      meta: { easyDashboard: { startPageId: 'page-detail', theme: { mode: 'light', tokens: {} } } },
      componentsTree: [page('page-overview'), page('page-detail')],
    }

    expect(canonicalizeDashboardDocument(legacy)).toMatchObject({
      presentation: { startPageId: 'page-detail', theme: { mode: 'light' } },
    })
    expect(resolveDashboardStartPageId(legacy)).toBe('page-detail')
    expect(resolveDashboardActiveDocumentId(legacy)).toBe('page-detail')
  })

  it('maps the presentation page identity to the editor document identity', () => {
    const document = {
      formatVersion: 1,
      editorSchema: {
        componentsTree: [page('doc-home', { meta: { easyDashboard: { pageId: 'page-home' } } })],
      },
      presentation: { startPageId: 'page-home', theme: { mode: 'dark', tokens: {} } },
    }

    expect(resolveDashboardActiveDocumentId(document)).toBe('doc-home')
    expect(resolveDashboardActiveRootNodeId(document)).toBe('doc-home-root')
  })

  it.each([
    [{ componentsTree: [] }, 'at least one page'],
    [{ componentsTree: [{ componentName: 'Root' }] }, 'cannot be derived'],
    [{ meta: { easyDashboard: { startPageId: 'missing' } }, componentsTree: [page('page-home')] }, 'does not exist'],
    [{ formatVersion: 2, editorSchema: {}, presentation: {} }, 'Unsupported'],
  ])('rejects an invalid or non-derivable document %#', (schema, message) => {
    expect(() => canonicalizeDashboardDocument(schema)).toThrowError(
      expect.objectContaining<Partial<InvalidDashboardDocumentError>>({ message: expect.stringContaining(message) }),
    )
  })
})
