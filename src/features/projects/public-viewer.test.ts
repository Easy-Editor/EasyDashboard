import { describe, expect, it } from 'vitest'
import {
  evaluatePublicViewerAccess,
  getPublishedProjectUrl,
  normalizePublicViewerOrigin,
  resolvePublicViewerOrigin,
} from './public-viewer'

describe('public viewer origin isolation', () => {
  it('fails closed when the production viewer origin is missing or invalid', () => {
    expect(resolvePublicViewerOrigin(undefined, true)).toBeNull()
    expect(resolvePublicViewerOrigin('javascript:alert(1)', true)).toBeNull()
    expect(resolvePublicViewerOrigin('https://viewer.example.com/path', true)).toBeNull()
  })

  it('uses the dedicated local viewer port only during development', () => {
    expect(resolvePublicViewerOrigin(undefined, false)).toBe('http://view.localhost:5174')
  })

  it('normalizes a valid viewer origin and rejects credentials', () => {
    expect(normalizePublicViewerOrigin('https://viewer.example.com/')).toBe('https://viewer.example.com')
    expect(normalizePublicViewerOrigin('https://user:secret@viewer.example.com')).toBeNull()
  })

  it('builds an absolute, encoded published URL', () => {
    expect(getPublishedProjectUrl('sales / 2026', 'https://viewer.example.com')).toBe(
      'https://viewer.example.com/view/sales%20%2F%202026',
    )
  })

  it('only allows rendering on the exact viewer origin', () => {
    expect(evaluatePublicViewerAccess('sales', 'https://app.example.com', 'https://viewer.example.com')).toEqual({
      status: 'redirect',
      viewerUrl: 'https://viewer.example.com/view/sales',
    })
    expect(evaluatePublicViewerAccess('sales', 'https://viewer.example.com', 'https://viewer.example.com')).toEqual({
      status: 'ready',
      viewerUrl: 'https://viewer.example.com/view/sales',
    })
  })
})
