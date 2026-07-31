import { describe, expect, it } from 'vitest'

import { getDraftPreviewHref, getHomePreviewLink } from './project-navigation'

describe('getHomePreviewLink', () => {
  it('opens an unpublished project preview in a separate tab without an opener', () => {
    expect(getHomePreviewLink({ id: 'project-1', slug: null })).toEqual({
      href: '/projects/project-1/preview',
      label: '打开预览',
      target: '_blank',
      rel: 'noreferrer',
    })
  })

  it('can deep-link the editor preview to the current project page', () => {
    expect(getDraftPreviewHref('project / 1', 'page / details')).toBe(
      '/projects/project%20%2F%201/preview?page=page%20%2F%20details',
    )
  })
})
