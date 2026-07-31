import { describe, expect, it } from 'vitest'
import { buildViewerRedirectUrl, parseViewerLocation } from './viewer-route'

describe('parseViewerLocation', () => {
  it('parses stable and versioned publication routes', () => {
    expect(parseViewerLocation('/view/sales', '')).toEqual({
      slug: 'sales',
      releaseNumber: null,
      pageId: null,
    })
    expect(parseViewerLocation('/view/sales/versions/12', '')).toEqual({
      slug: 'sales',
      releaseNumber: 12,
      pageId: null,
    })
  })

  it('accepts an encoded page id through the shared page query deep link', () => {
    expect(parseViewerLocation('/view/sales%20board', '?page=page%2Foverview')).toEqual({
      slug: 'sales board',
      releaseNumber: null,
      pageId: 'page/overview',
    })
  })

  it('rejects malformed paths and release numbers', () => {
    expect(parseViewerLocation('/view/sales/versions/latest', '')).toBeNull()
    expect(parseViewerLocation('/view/sales/versions/0', '')).toBeNull()
    expect(parseViewerLocation('/login', '')).toBeNull()
  })
})

describe('buildViewerRedirectUrl', () => {
  it('preserves immutable version paths and selected page query during canonical-origin redirects', () => {
    expect(
      buildViewerRedirectUrl(
        'https://viewer.example.com/view/city-operations',
        '/view/city-operations/versions/7',
        '?page=page-detail',
      ),
    ).toBe('https://viewer.example.com/view/city-operations/versions/7?page=page-detail')
  })
})
